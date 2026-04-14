import { EventEmitter } from 'events';
import { StateMachine, RobotState } from './StateMachine.js';
import { logger } from '../observability/logger.js';

/**
 * Main robot controller with control loop, safety checks, and speed ramping.
 *
 * Responsibilities:
 * - Run control loop at configured interval (default 33ms = 30Hz)
 * - Monitor safety conditions (E-stop, battery, input timeout)
 * - Apply speed ramping (acceleration/deceleration)
 * - Process input and command motors
 */
export class RobotController extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      // Control loop interval in ms (33ms = ~30Hz)
      loopIntervalMs: options.loopIntervalMs ?? 33,
      // Input timeout in ms (trigger safe stop if no input)
      inputTimeoutMs: options.inputTimeoutMs ?? 2000,
      // Speed ramping: acceleration rate (0-1 per second)
      accelRate: options.accelRate ?? 0.5,
      // Speed ramping: deceleration rate (0-1 per second)
      decelRate: options.decelRate ?? 0.8,
      // Emergency stop deceleration (much faster)
      eStopDecelRate: options.eStopDecelRate ?? 2.0,
      // Deadband for input (values below this are treated as 0)
      deadband: options.deadband ?? 0.1,
      // Minimum speed to move after deadband applied
      minMovementSpeed: options.minMovementSpeed ?? 0.15,
    };

    this._stateMachine = new StateMachine();
    this._motorController = null;
    this._inputProvider = null;

    this._loopInterval = null;
    this._running = false;

    // Current command speeds (after ramping)
    this._currentLeftSpeed = 0;
    this._currentRightSpeed = 0;

    // Target speeds (from input)
    this._targetLeftSpeed = 0;
    this._targetRightSpeed = 0;

    // Input tracking
    this._lastInputTime = null;
    this._inputTimeoutActive = false;

    // E-stop tracking
    this._eStopActive = false;

    // Battery tracking
    this._batteryVoltage = 0;
    this._batteryWarningLevel = 'ok'; // ok, warning, critical
  }

  /**
   * Initialize the controller with dependencies.
   * @param {MotorController} motorController - Motor controller instance
   * @param {EventEmitter|object} inputProvider - Input provider (Wiimote, etc.)
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async initialize(motorController, inputProvider) {
    try {
      this._motorController = motorController;
      this._inputProvider = inputProvider;

      // Initialize state machine
      this._stateMachine.initialize();
      this._setupStateMachineListeners();

      // Initialize motor controller
      const motorResult = await this._motorController.initialize();
      if (!motorResult.success) {
        logger.error({ error: motorResult.error }, 'Motor controller initialization failed');
        return { success: false, error: motorResult.error };
      }

      // Setup input listeners if provider available
      if (this._inputProvider) {
        this._setupInputListeners();
      }

      logger.info('Robot controller initialized');

      return { success: true };
    } catch (err) {
      logger.error({ err }, 'Failed to initialize robot controller');
      return { success: false, error: err.message };
    }
  }

  /**
   * Set up state machine event listeners.
   * @private
   */
  _setupStateMachineListeners() {
    this._stateMachine.on('stateChanged', (event) => {
      logger.info({ from: event.from, to: event.to, context: event.context }, 'Robot state changed');
      this.emit('stateChanged', event);

      // Handle state-specific actions
      switch (event.to) {
        case RobotState.ENABLED:
          this._handleEnabled();
          break;
        case RobotState.DISABLED:
          this._handleDisabled();
          break;
        case RobotState.E_STOP:
          this._handleEStop(event.context);
          break;
        case RobotState.FAULT:
          this._handleFault(event.context);
          break;
      }
    });
  }

  /**
   * Set up input provider event listeners.
   * @private
   */
  _setupInputListeners() {
    logger.debug('Setting up input listeners');

    // E-stop from input (Z button on Nunchuk, Home button on Wiimote)
    this._inputProvider.on('nunchuk-z', (data) => {
      logger.debug({ data }, 'nunchuk-z event received');
      this._triggerEStop({ source: 'nunchuk-z-button' });
    });

    this._inputProvider.on('home', (data) => {
      logger.debug({ data }, 'home event received');
      this._triggerEStop({ source: 'home-button' });
    });

    // General input received
    this._inputProvider.on('button', (event) => {
      logger.debug({ event }, 'button event received');
      this._handleInputReceived();
    });

    // Nunchuk stick motion
    this._inputProvider.on('stick', (data) => {
      logger.debug({ data }, 'stick event received');
      this._handleInputReceived();
    });

    // Input provider disconnect
    this._inputProvider.on('disconnected', () => {
      logger.warn('Input provider disconnected');
      this._handleInputLost();
    });
  }

  /**
   * Handle ENABLED state entry.
   * @private
   */
  _handleEnabled() {
    this._motorController.enable();
  }

  /**
   * Handle DISABLED state entry.
   * @private
   */
  _handleDisabled() {
    this._motorController.disable();
    this._targetLeftSpeed = 0;
    this._targetRightSpeed = 0;
    this._inputTimeoutActive = false;
  }

  /**
   * Handle E_STOP state entry.
   * @private
   * @param {object} context - Transition context
   */
  _handleEStop(context) {
    logger.warn({ context }, 'Emergency stop triggered');
    this._eStopActive = true;
    this._targetLeftSpeed = 0;
    this._targetRightSpeed = 0;
    this._currentLeftSpeed = 0;
    this._currentRightSpeed = 0;
    // Hard emergency stop - immediate cut to motors
    this._motorController.emergencyStop();
    this.emit('emergencyStop', context);
  }

  /**
   * Handle FAULT state entry.
   * @private
   * @param {object} context - Transition context
   */
  _handleFault(context) {
    logger.error({ context }, 'Fault state entered');
    this._targetLeftSpeed = 0;
    this._targetRightSpeed = 0;
    this.emit('fault', context);
  }

  /**
   * Handle input received from provider.
   * @private
   */
  _handleInputReceived() {
    const currentState = this._stateMachine.getState();
    logger.debug({ currentState }, 'Input received');
    this._lastInputTime = Date.now();
    this._inputTimeoutActive = false;

    // Auto-transition to DRIVING if enabled
    if (this._stateMachine.isInState(RobotState.ENABLED)) {
      logger.debug('Transitioning to DRIVING state');
      const result = this._stateMachine.handleInput({});
      logger.debug({ result }, 'handleInput result');
    }
  }

  /**
   * Handle input provider lost/disconnected.
   * Triggers emergency stop - loss of control is a safety-critical event.
   * @private
   */
  _handleInputLost() {
    logger.warn('Input provider lost - triggering emergency stop');
    this._triggerEStop({ source: 'input-lost' });
  }

  /**
   * Trigger emergency stop.
   * @private
   * @param {object} context - E-stop context
   */
  _triggerEStop(context) {
    this._stateMachine.emergencyStop(context);
  }

  /**
   * Start the main control loop.
   * @returns {void}
   */
  start() {
    if (this._running) {
      return;
    }

    this._running = true;
    this._lastInputTime = Date.now();

    this._loopInterval = setInterval(() => {
      this._controlLoop();
    }, this.options.loopIntervalMs);

    logger.info({ intervalMs: this.options.loopIntervalMs }, 'Control loop started');
  }

  /**
   * Stop the main control loop.
   * @returns {Promise<void>}
   */
  async stop() {
    this._running = false;

    if (this._loopInterval) {
      clearInterval(this._loopInterval);
      this._loopInterval = null;
    }

    // Stop motors
    if (this._motorController && typeof this._motorController.stop === 'function') {
      await this._motorController.stop();
    }

    logger.info('Control loop stopped');
  }

  /**
   * Main control loop - runs at fixed interval.
   * @private
   */
  async _controlLoop() {
    // Check input timeout
    this._checkInputTimeout();

    // Get current state
    const state = this._stateMachine.getState();

    // Update battery voltage if motor controller provides it
    await this._updateBatteryStatus();
    // Process based on state
    switch (state) {
      case RobotState.DISABLED:
        // Motors disabled, just monitor
        break;

      case RobotState.ENABLED:
        // Enabled but not driving - apply any ramping down
        await this._applySpeedRamping();
        break;

      case RobotState.DRIVING:
        // Actively driving - process input and apply ramping
        logger.info({state},'in control loop driving')
        await this._processDriving();
        break;

      case RobotState.E_STOP:
      case RobotState.FAULT:
        // Ensure motors are stopped
        if (this._currentLeftSpeed !== 0 || this._currentRightSpeed !== 0) {
          this._currentLeftSpeed = 0;
          this._currentRightSpeed = 0;
          await this._motorController.setSpeed(0, 0);
        }
        break;
    }
  }

  /**
   * Check for input timeout - only triggers on actual signal loss,
   * not when stick is held steady.
   * @private
   */
  _checkInputTimeout() {
    // Check if there's active input (stick being held)
    const activeInput = this._getActiveInputState();
    const hasActiveInput = activeInput && (activeInput.stickX !== 0 || activeInput.stickY !== 0);

    // If stick is being held, refresh the input timer
    if (hasActiveInput) {
      this._lastInputTime = Date.now();
      this._inputTimeoutActive = false;
      return;
    }

    // No active input - check for timeout
    if (!this._lastInputTime) {
      return;
    }

    const elapsed = Date.now() - this._lastInputTime;
    if (elapsed > this.options.inputTimeoutMs && !this._inputTimeoutActive) {
      logger.warn({ elapsed }, 'Input timeout detected');
      this._inputTimeoutActive = true;

      if (this._stateMachine.isInState(RobotState.DRIVING)) {
        this._stateMachine.handleInputTimeout();
        this._targetLeftSpeed = 0;
        this._targetRightSpeed = 0;
      }
    }
  }

  /**
   * Get current input state from provider.
   * @private
   * @returns {object|null}
   */
  _getActiveInputState() {
    if (!this._inputProvider) {
      return null;
    }
    return this._inputProvider.getState?.() || this._inputProvider.state;
  }

  /**
   * Update battery status from motor controller telemetry.
   * @private
   */
  async _updateBatteryStatus() {
    if (!this._motorController) {
      return;
    }

    const telemetry = this._motorController.getTelemetry();
    this._batteryVoltage = telemetry.voltage;

    // Determine warning level (defaults, could be configured)
    const lowThreshold = 11.0;
    const criticalThreshold = 10.0;

    if (this._batteryVoltage < criticalThreshold && this._batteryVoltage > 0) {
      this._batteryWarningLevel = 'critical';
      // Trigger E-stop on critical battery
      if (!this._stateMachine.isInState(RobotState.E_STOP)) {
        this._triggerEStop({ source: 'battery-critical', voltage: this._batteryVoltage });
      }
    } else if (this._batteryVoltage < lowThreshold) {
      this._batteryWarningLevel = 'warning';
      if (this._batteryWarningLevel !== 'warning') {
        this.emit('batteryWarning', { voltage: this._batteryVoltage });
      }
    } else {
      this._batteryWarningLevel = 'ok';
    }
  }

  /**
   * Apply speed ramping to reach target speeds.
   * @private
   * @returns {Promise<void>}
   */
  async _applySpeedRamping() {
    const dt = this.options.loopIntervalMs / 1000; // Delta time in seconds

    // Calculate ramp step - use accelRate when increasing speed, decelRate when decreasing
    const isAccelerating = Math.abs(this._targetLeftSpeed) > Math.abs(this._currentLeftSpeed) ||
                           Math.abs(this._targetRightSpeed) > Math.abs(this._currentRightSpeed);
    const rampRate = isAccelerating ? this.options.accelRate : this.options.decelRate;
    const rampStep = rampRate * dt;

    // Ramp left speed
    if (this._currentLeftSpeed > this._targetLeftSpeed) {
      this._currentLeftSpeed = Math.max(this._targetLeftSpeed, this._currentLeftSpeed - rampStep);
    } else if (this._currentLeftSpeed < this._targetLeftSpeed) {
      this._currentLeftSpeed = Math.min(this._targetLeftSpeed, this._currentLeftSpeed + rampStep);
    }

    // Ramp right speed
    if (this._currentRightSpeed > this._targetRightSpeed) {
      this._currentRightSpeed = Math.max(this._targetRightSpeed, this._currentRightSpeed - rampStep);
    } else if (this._currentRightSpeed < this._targetRightSpeed) {
      this._currentRightSpeed = Math.min(this._targetRightSpeed, this._currentRightSpeed + rampStep);
    }
    logger.trace({motorenabled:this._motorController.isEnabled(),left:this._targetLeftSpeed,right:this._targetRightSpeed,currentleft:this._currentLeftSpeed,currentright:this._currentRightSpeed},'update speed data')
    // Command motors
    if (this._motorController && this._motorController.isEnabled()) {
      const speedChangedStatus = await this._motorController.setSpeed( this._currentLeftSpeed, this._currentRightSpeed);
      logger.trace({speedChangedStatus},'applySpeedramping setspeed result.')
    }
   
  }

  /**
   * Process driving - get input, apply ramping, command motors.
   * @private
   */
  async _processDriving() {
    // Get target speeds from input
    this._updateTargetSpeeds();

    // Apply ramping and command motors
    await this._applySpeedRamping();
  }

  /**
   * Update target speeds from input provider.
   * @private
   */
  _updateTargetSpeeds() {
    if (!this._inputProvider) {
      this._targetLeftSpeed = 0;
      this._targetRightSpeed = 0;
      return;
    }

    const state = this._inputProvider.getState?.() || this._inputProvider.state;
    if (!state) {
      this._targetLeftSpeed = 0;
      this._targetRightSpeed = 0;
      return;
    }

    // Get stick input (normalized -1 to 1)
    const stickY = state.stickY || 0; // Forward/back
    const stickX = state.stickX || 0; // Left/right

    // Check for boost mode (C button)
    const boost = state.c === true;
    const maxSpeed = boost ? 1.0 : 0.5; // Could be configured

    // Tank-style differential drive
    // Stick Y controls base speed, Stick X controls differential (turn rate)
    let leftSpeed = stickY + stickX;
    let rightSpeed = stickY - stickX;

    // Clamp to max speed
    const clamp = (v) => Math.max(-maxSpeed, Math.min(maxSpeed, v));
    leftSpeed = clamp(leftSpeed);
    rightSpeed = clamp(rightSpeed);

    // Apply minimum movement threshold
    const minMove = this.options.minMovementSpeed;
    if (Math.abs(leftSpeed) < minMove && leftSpeed !== 0) {
      leftSpeed = 0;
    }
    if (Math.abs(rightSpeed) < minMove && rightSpeed !== 0) {
      rightSpeed = 0;
    }

    this._targetLeftSpeed = leftSpeed;
    this._targetRightSpeed = rightSpeed;
  }

  /**
   * Enable the robot.
   * @returns {{ success: boolean, error?: string }}
   */
  enable() {
    if (this._eStopActive) {
      return { success: false, error: 'E-stop must be reset first' };
    }
    return this._stateMachine.enable({ source: 'api' });
  }

  /**
   * Disable the robot.
   * @returns {{ success: boolean, error?: string }}
   */
  disable() {
    return this._stateMachine.disable({ source: 'api' });
  }

  /**
   * Reset emergency stop.
   * @returns {{ success: boolean, error?: string }}
   */
  resetEStop() {
    this._eStopActive = false;
    return this._stateMachine.resetEStop({ source: 'api' });
  }

  /**
   * Trigger emergency stop via API.
   * @param {object} context - E-stop context
   * @returns {{ success: boolean, error?: string }}
   */
  emergencyStop(context = {}) {
    return this._stateMachine.emergencyStop({ source: 'api', ...context });
  }

  /**
   * Get current robot state.
   * @returns {{ state: RobotState, batteryVoltage: number, batteryWarning: string, inputTimeout: boolean }}
   */
  getStatus() {
    return {
      state: this._stateMachine.getState(),
      batteryVoltage: this._batteryVoltage,
      batteryWarning: this._batteryWarningLevel,
      inputTimeout: this._inputTimeoutActive,
      eStopActive: this._eStopActive,
      motorSpeeds: {
        left: this._currentLeftSpeed,
        right: this._currentRightSpeed,
      },
    };
  }

  /**
   * Get the state machine instance.
   * @returns {StateMachine}
   */
  getStateMachine() {
    return this._stateMachine;
  }

  /**
   * Clean up resources.
   * @returns {Promise<void>}
   */
  async dispose() {
    await this.stop();

    if (this._motorController) {
      await this._motorController.dispose();
      this._motorController = null;
    }

    this._inputProvider = null;
    this.emit('disposed');
  }
}

export default RobotController;
