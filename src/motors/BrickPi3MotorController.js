import { MotorController } from './MotorController.js';
import brickpi3 from 'brickpi3';
import { logger } from '../observability/logger.js';

/**
 * BrickPi3 motor controller for small-scale prototype.
 * Uses the BrickPi3 Node.js library to control LEGO Mindstorms motors.
 *
 * @see https://www.npmjs.com/package/brickpi3
 * @see https://github.com/DexterInd/BrickPi3
 */
export class BrickPi3MotorController extends MotorController {
  constructor(options = {}) {
    super();
    this.options = {
      // BrickPi3 address (for stacked boards, omit for primary/default)
      address: options.address ?? null,
      // Left motor port (PORT_A or PORT_B)
      leftMotorPort: options.leftMotorPort ?? 'PORT_A',
      // Right motor port (PORT_A or PORT_B)
      rightMotorPort: options.rightMotorPort ?? 'PORT_B',
      // Enable encoder-based position control
      useEncoders: options.useEncoders ?? true,
    };

    this._bp = null;
    this._enabled = false;
    this._initialized = false;
    this._leftSpeed = 0;
    this._rightSpeed = 0;
    this._leftEncoderOffset = 0;
    this._rightEncoderOffset = 0;

    this._telemetry = {
      voltage: 0,
      current: 0,
      temperature: 0,
      leftSpeed: 0,
      rightSpeed: 0,
      enabled: false,
      fault: false,
      faults: [],
    };

    // Map port names to BrickPi3 constants
    this._PORTS = {
      
      PORT_A: 0x01,
      PORT_B: 0x02,
      PORT_C: 0x04,
      PORT_D: 0x08

    };
    logger.info('brickpi constructor done.')
  }

  /**
   * Initialize the BrickPi3 motor controller.
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async initialize() {
    logger.info('init started brickpi')
    if (this._initialized) {
      return { success: true };
    }

    try {
      logger.info({ address: this.options.address }, 'Initializing BrickPi3');

      // Create BrickPi3 instance (no address = default/primary)
      this._bp = this.options.address
        ? new brickpi3.BrickPi3(this.options.address)
        : new brickpi3.BrickPi3();
      logger.info('init motor reset start')
      // Reset motors on startup
      await this._resetMotors();
      logger.info('init motor read firmware start')
      // Read firmware version to verify communication
      const version = await this._readFirmware();
      logger.info({ version }, 'BrickPi3 communication verified');
logger.info('init battery  start')
      // Read battery voltage
   //   const voltage = await this._bp.get_voltage_battery();
   //   logger.info({ voltage }, 'BrickPi3 battery voltage');
   //   this._telemetry.voltage = voltage;
   
   this._telemetry.voltage = 11;
   const voltage =11
   
logger.info('init done')
      this._initialized = true;
      this.emit('initialized', { version, voltage });

      return { success: true };
    } catch (err) {
      logger.info(err)
      logger.error({ err }, 'Failed to initialize BrickPi3');
      this._initialized = false;
      return { success: false, error: err.message };
    }
  }

  /**
   * Read firmware version from BrickPi3.
   * @private
   * @returns {Promise<string>}
   */
  async _readFirmware() {
    try {
      // Firmware format: "Dexter Industries BrickPi3 v1.x.x"
      return await this._bp.get_version_firmware();
    } catch (err) {
      logger.warn({ err }, 'Failed to read firmware version');
      return 'unknown';
    }
  }

  /**
   * Reset motors to safe state.
   * @private
   */
  async _resetMotors() {
    try {
      const leftPort = this._PORTS[this.options.leftMotorPort];
      const rightPort = this._PORTS[this.options.rightMotorPort];

      // Stop both motors
      await this._bp.set_motor_power(leftPort, 0);
      await this._bp.set_motor_power(rightPort, 0);

      // Reset encoders if using them
      if (this.options.useEncoders) {
        await this._bp.offset_motor_encoder(leftPort, 0);
        await this._bp.offset_motor_encoder(rightPort, 0);
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to reset motors');
    }
  }

  /**
   * Get motor port constant from port name.
   * @private
   * @param {string} portName - PORT_A, PORT_B, etc.
   * @returns {number}
   */
  _getPort(portName) {
    const port = this._PORTS[portName];
    if (port === undefined) {
      throw new Error(`Invalid motor port: ${portName}`);
    }
    return port;
  }

  /**
   * Set motor speeds for tank-style differential drive.
   * BrickPi3 uses power values from -100 to 100.
   * @param {number} leftSpeed - Left motor speed (-1.0 to 1.0)
   * @param {number} rightSpeed - Right motor speed (-1.0 to 1.0)
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async setSpeed(leftSpeed, rightSpeed) {
    logger.debug(this.enabled,'set speed motor controler')
    if (!this._initialized) {
      return { success: false, error: 'Motor controller not initialized' };
    }

    if (!this._enabled) {
      return { success: false, error: 'Motor controller is disabled' };
    }

    // Clamp speeds to valid range
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    leftSpeed = clamp(leftSpeed);
    rightSpeed = clamp(rightSpeed);

    // Convert to BrickPi3 power (-100 to 100)
    const toPower = (speed) => Math.round(speed * 100);
    const leftPower = toPower(leftSpeed);
    const rightPower = toPower(rightSpeed);

    try {
      const leftPort = this._getPort(this.options.leftMotorPort);
      const rightPort = this._getPort(this.options.rightMotorPort);
   
      // Set motor power
      await this._bp.set_motor_power(this._bp.PORT_A, leftPower);
      await this._bp.set_motor_power(rightPort, rightPower);

      const oldLeft = this._leftSpeed;
      const oldRight = this._rightSpeed;

      this._leftSpeed = leftSpeed;
      this._rightSpeed = rightSpeed;

      // Update telemetry
      this._telemetry.leftSpeed = leftSpeed;
      this._telemetry.rightSpeed = rightSpeed;
      logger.trace({leftpower: leftPower, Rightpower: rightPower, left: leftSpeed, right: rightSpeed, oldleft:leftSpeed, oldRight: oldRight, lport:leftPort, rport:rightPort}, 'brickpi speedupdate ')
      this.emit('speedChanged', { leftSpeed, rightSpeed, oldLeft, oldRight });

      return { success: true };
    } catch (err) {
      logger.error({ err }, 'Failed to set motor speed');
      return { success: false, error: err.message };
    }
  }

  /**
   * Stop both motors.
   * @returns {Promise<void>}
   */
  async stop() {
    await this.setSpeed(0, 0);
    this.emit('stopped');
  }

  /**
   * Emergency stop - immediate hard cut to motors.
   * Uses float mode to coast to stop.
   * @returns {Promise<void>}
   */
  async emergencyStop() {
    try {
      const leftPort = this._getPort(this.options.leftMotorPort);
      const rightPort = this._getPort(this.options.rightMotorPort);

      // Set motors to float (coast) mode for immediate stop
      await this._bp.set_motor_power(leftPort, -128); // -128 = float/coast
      await this._bp.set_motor_power(rightPort, -128);

      this._leftSpeed = 0;
      this._rightSpeed = 0;
      this._enabled = false;
      this._telemetry.enabled = false;
      this.emit('emergencyStop');
    } catch (err) {
      logger.error({ err }, 'Emergency stop failed');
    }
  }

  /**
   * Enable motor output.
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async enable() {
    if (!this._initialized) {
      return { success: false, error: 'Motor controller not initialized' };
    }

    this._enabled = true;
    this._telemetry.enabled = true;
    this.emit('enabled');
    return { success: true };
  }

  /**
   * Disable motor output.
   * @returns {Promise<void>}
   */
  async disable() {
    await this.stop();
    this._enabled = false;
    this._telemetry.enabled = false;
    this.emit('disabled');
  }

  /**
   * Check if motors are currently enabled.
   * @returns {boolean}
   */
  isEnabled() {
    return this._enabled;
  }

  /**
   * Get current motor telemetry data.
   * @returns {import('./MotorController.js').MotorTelemetry}
   */
  getTelemetry() {
    return { ...this._telemetry };
  }

  /**
   * Read battery voltage from BrickPi3.
   * @returns {Promise<number>} Voltage in volts
   */
  async readBatteryVoltage() {
    try {
      const voltage = this._bp.get_voltage_battery();
      this._telemetry.voltage = voltage;
      return voltage;
    } catch (err) {
      logger.warn({ err }, 'Failed to read battery voltage');
      return 0;
    }
  }

  /**
   * Read encoder value for a motor.
   * @param {'left'|'right'} motor - Which motor to read
   * @returns {Promise<number>} Encoder ticks
   */
  async readEncoder(motor) {
    if (!this._initialized) {
      return 0;
    }

    try {
      const portName = motor === 'left' ? this.options.leftMotorPort : this.options.rightMotorPort;
      const port = this._getPort(portName);
      const encoder = await this._bp.get_motor_encoder(port);
      return encoder;
    } catch (err) {
      logger.warn({ err }, 'Failed to read encoder');
      return 0;
    }
  }

  /**
   * Reset encoder to current position.
   * @param {'left'|'right'} motor - Which motor to reset
   * @returns {Promise<void>}
   */
  async resetEncoder(motor) {
    if (!this._initialized) {
      return;
    }

    try {
      const portName = motor === 'left' ? this.options.leftMotorPort : this.options.rightMotorPort;
      const port = this._getPort(portName);
      const currentEncoder = await this._bp.get_motor_encoder(port);
      await this._bp.offset_motor_encoder(port, currentEncoder);
      logger.debug({ motor, encoder: currentEncoder }, 'Reset motor encoder');
    } catch (err) {
      logger.warn({ err }, 'Failed to reset encoder');
    }
  }

  /**
   * Set motor to position control mode.
   * @param {'left'|'right'} motor - Which motor
   * @param {number} position - Target position in degrees
   * @param {number} power - Power level (0-100)
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async setMotorPosition(motor, position, power = 50) {
    if (!this._initialized) {
      return { success: false, error: 'Motor controller not initialized' };
    }

    try {
      const portName = motor === 'left' ? this.options.leftMotorPort : this.options.rightMotorPort;
      const port = this._getPort(portName);

      // Use set_motor_position for encoder-based positioning
      await this._bp.set_motor_position(port, position, power);

      return { success: true };
    } catch (err) {
      logger.error({ err }, 'Failed to set motor position');
      return { success: false, error: err.message };
    }
  }

  /**
   * Clean up resources and disconnect from BrickPi3.
   * @returns {Promise<void>}
   */
  async dispose() {
    await this.emergencyStop();

    if (this._bp) {
      try {
        // BrickPi3 doesn't have explicit close, just reset motors
        await this._resetMotors();
        this._bp = null;
      } catch (err) {
        logger.warn({ err }, 'Error during BrickPi3 cleanup');
      }
    }

    this._initialized = false;
    this.emit('disposed');
  }
}

export default BrickPi3MotorController;
