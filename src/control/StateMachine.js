import { EventEmitter } from 'events';

/**
 * Robot state constants.
 */
export const RobotState = {
  DISABLED: 'DISABLED',
  ENABLED: 'ENABLED',
  DRIVING: 'DRIVING',
  E_STOP: 'E_STOP',
  FAULT: 'FAULT',
};

/**
 * State transition definitions.
 * Each state defines which transitions are allowed and what conditions must be met.
 */
const transitions = {
  [RobotState.DISABLED]: {
    ENABLED: () => true, // Can always enable from disabled
    E_STOP: () => true,  // Can emergency stop from disabled (e.g., button press)
    FAULT: () => true,   // Can always fault
  },
  [RobotState.ENABLED]: {
    DISABLED: () => true,           // Can disable
    DRIVING: () => true,            // Can start driving when input received
    E_STOP: () => true,             // Can emergency stop
    FAULT: () => true,              // Can fault
  },
  [RobotState.DRIVING]: {
    ENABLED: () => true,            // Stop driving but stay enabled
    E_STOP: () => true,             // Emergency stop
    FAULT: () => true,              // Fault condition
  },
  [RobotState.E_STOP]: {
    DISABLED: () => true,           // Reset to disabled after E-stop
    FAULT: () => true,              // Can fault
    // Note: Can't go directly to ENABLED - must reset E-stop first
  },
  [RobotState.FAULT]: {
    DISABLED: () => true,           // Reset to disabled after fault cleared
  },
};

/**
 * StateMachine for K9 robot safety-critical state management.
 *
 * States:
 * - DISABLED: Initial state, motors off, waiting for enable
 * - ENABLED: Motors powered, waiting for input
 * - DRIVING: Actively processing input and driving
 * - E_STOP: Emergency stop triggered, requires explicit reset
 * - FAULT: System fault detected, requires manual intervention
 *
 * @extends EventEmitter
 * @fires StateMachine#stateChanged - When state changes
 */
export class StateMachine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      // Require explicit E-stop reset (can't just re-enable)
      requireEStopReset: options.requireEStopReset ?? true,
      // Auto-transition to DRIVING when input received in ENABLED
      autoDriveOnInput: options.autoDriveOnInput ?? true,
    };

    this._state = RobotState.DISABLED;
    this._previousState = null;
    this._stateHistory = [];
  }

  /**
   * Get current state.
   * @returns {RobotState}
   */
  getState() {
    return this._state;
  }

  /**
   * Get previous state.
   * @returns {RobotState|null}
   */
  getPreviousState() {
    return this._previousState;
  }

  /**
   * Get state history (last N states).
   * @param {number} limit - Max history entries to return
   * @returns {Array<{state: RobotState, timestamp: Date}>}
   */
  getHistory(limit = 10) {
    return this._stateHistory.slice(-limit);
  }

  /**
   * Check if in a specific state.
   * @param {RobotState} state - State to check
   * @returns {boolean}
   */
  isInState(state) {
    return this._state === state;
  }

  /**
   * Check if robot is in an active (driving or ready) state.
   * @returns {boolean}
   */
  isActive() {
    return this._state === RobotState.ENABLED || this._state === RobotState.DRIVING;
  }

  /**
   * Check if robot is stopped (disabled, E-stop, or fault).
   * @returns {boolean}
   */
  isStopped() {
    return this._state === RobotState.DISABLED ||
           this._state === RobotState.E_STOP ||
           this._state === RobotState.FAULT;
  }

  /**
   * Check if a transition is allowed.
   * @param {RobotState} toState - Target state
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canTransition(toState) {
    const fromState = this._state;

    if (!transitions[fromState]) {
      return { allowed: false, reason: `Unknown state: ${fromState}` };
    }

    const transition = transitions[fromState][toState];
    if (!transition) {
      return { allowed: false, reason: `Cannot transition from ${fromState} to ${toState}` };
    }

    // Check transition condition
    if (typeof transition === 'function' && !transition()) {
      return { allowed: false, reason: 'Transition condition not met' };
    }

    return { allowed: true };
  }

  /**
   * Attempt to transition to a new state.
   * @param {RobotState} toState - Target state
   * @param {object} context - Optional context for the transition
   * @returns {{ success: boolean, error?: string }}
   */
  transition(toState, context = {}) {
    const check = this.canTransition(toState);

    if (!check.allowed) {
      this.emit('transitionDenied', { from: this._state, to: toState, reason: check.reason });
      return { success: false, error: check.reason };
    }

    this._previousState = this._state;
    this._state = toState;

    // Record in history
    this._stateHistory.push({
      state: toState,
      timestamp: new Date(),
      context,
    });

    // Keep history bounded
    if (this._stateHistory.length > 100) {
      this._stateHistory.shift();
    }

    this.emit('stateChanged', {
      from: this._previousState,
      to: toState,
      context,
    });

    return { success: true };
  }

  /**
   * Initialize the state machine (start in DISABLED).
   * @returns {void}
   */
  initialize() {
    this._state = RobotState.DISABLED;
    this._previousState = null;
    this._stateHistory = [];
    this.emit('initialized', { state: this._state });
  }

  /**
   * Enable the robot (transition to ENABLED).
   * @param {object} context - Optional context
   * @returns {{ success: boolean, error?: string }}
   */
  enable(context = {}) {
    return this.transition(RobotState.ENABLED, { ...context, action: 'enable' });
  }

  /**
   * Disable the robot (transition to DISABLED).
   * @param {object} context - Optional context
   * @returns {{ success: boolean, error?: string }}
   */
  disable(context = {}) {
    return this.transition(RobotState.DISABLED, { ...context, action: 'disable' });
  }

  /**
   * Start driving (transition to DRIVING).
   * @param {object} context - Optional context
   * @returns {{ success: boolean, error?: string }}
   */
  startDriving(context = {}) {
    return this.transition(RobotState.DRIVING, { ...context, action: 'startDriving' });
  }

  /**
   * Stop driving but stay enabled (transition to ENABLED).
   * @param {object} context - Optional context
   * @returns {{ success: boolean, error?: string }}
   */
  stopDriving(context = {}) {
    if (this._state === RobotState.DRIVING) {
      return this.transition(RobotState.ENABLED, { ...context, action: 'stopDriving' });
    }
    return { success: true }; // Already not driving
  }

  /**
   * Trigger emergency stop.
   * @param {object} context - Optional context (e.g., { source: 'button' | 'timeout' | 'battery' })
   * @returns {{ success: boolean, error?: string }}
   */
  emergencyStop(context = {}) {
    return this.transition(RobotState.E_STOP, { ...context, action: 'emergencyStop' });
  }

  /**
   * Reset emergency stop (go to DISABLED, ready to re-enable).
   * @param {object} context - Optional context
   * @returns {{ success: boolean, error?: string }}
   */
  resetEStop(context = {}) {
    if (this._state !== RobotState.E_STOP) {
      return { success: false, error: 'Not in E_STOP state' };
    }
    return this.transition(RobotState.DISABLED, { ...context, action: 'resetEStop' });
  }

  /**
   * Trigger fault state.
   * @param {string} faultCode - Fault code/reason
   * @param {object} context - Optional context
   * @returns {{ success: boolean, error?: string }}
   */
  fault(faultCode, context = {}) {
    return this.transition(RobotState.FAULT, { ...context, action: 'fault', faultCode });
  }

  /**
   * Clear fault and return to DISABLED.
   * @param {object} context - Optional context
   * @returns {{ success: boolean, error?: string }}
   */
  clearFault(context = {}) {
    if (this._state !== RobotState.FAULT) {
      return { success: false, error: 'Not in FAULT state' };
    }
    return this.transition(RobotState.DISABLED, { ...context, action: 'clearFault' });
  }

  /**
   * Handle input received - may auto-transition to DRIVING.
   * @param {object} inputState - Current input state
   * @returns {{ success: boolean, transitioned?: boolean }}
   */
  handleInput(inputState) {
    if (this.options.autoDriveOnInput && this._state === RobotState.ENABLED) {
      const result = this.startDriving({ inputReceived: true });
      return { success: result.success, transitioned: result.success };
    }
    return { success: true, transitioned: false };
  }

  /**
   * Handle input timeout - stop driving but stay enabled.
   * @returns {{ success: boolean }}
   */
  handleInputTimeout() {
    if (this._state === RobotState.DRIVING) {
      return this.stopDriving({ reason: 'inputTimeout' });
    }
    return { success: true };
  }
}

export default StateMachine;
