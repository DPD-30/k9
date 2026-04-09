import { MotorController } from './MotorController.js';
import { SerialPort } from 'serialport';
import { logger } from '../observability/logger.js';

/**
 * RoboClaw motor controller implementation.
 * Communicates via UART using packet serial protocol.
 * Supports RoboClaw 2x15A, 2x30A, and compatible controllers.
 */
export class RoboClawMotorController extends MotorController {
  constructor(options = {}) {
    super();
    this.options = {
      // Serial port path (e.g., '/dev/ttyAMA0' on Pi)
      portPath: options.portPath ?? '/dev/ttyAMA0',
      // Baud rate (default 9600 for RoboClaw)
      baudRate: options.baudRate ?? 9600,
      // RoboClaw address (0-127, default 128 in packet serial mode uses 0x80)
      address: options.address ?? 128,
      // Timeout for serial commands in ms
      timeout: options.timeout ?? 1000,
      // Encoder ticks per revolution (if using encoders)
      encoderTicksPerRevolution: options.encoderTicksPerRevolution ?? null,
    };

    this._port = null;
    this._enabled = false;
    this._initialized = false;
    this._leftSpeed = 0;
    this._rightSpeed = 0;

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
  }

  /**
   * Initialize the RoboClaw motor controller.
   * Opens serial port and verifies communication.
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async initialize() {
    if (this._initialized) {
      return { success: true };
    }

    try {
      logger.info({ port: this.options.portPath, baud: this.options.baudRate }, 'Opening RoboClaw serial port');

      this._port = new SerialPort({
        path: this.options.portPath,
        baudRate: this.options.baudRate,
        autoOpen: false,
      });

      await this._openPort();

      // Verify communication by reading firmware version
      const version = await this._readVersion();
      logger.info({ version }, 'RoboClaw communication verified');

      this._initialized = true;
      this.emit('initialized', { version });

      return { success: true };
    } catch (err) {
      logger.error({ err }, 'Failed to initialize RoboClaw');
      this._initialized = false;
      return { success: false, error: err.message };
    }
  }

  /**
   * Open serial port with timeout handling.
   * @private
   */
  _openPort() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Serial port open timeout'));
      }, this.options.timeout);

      this._port.open((err) => {
        clearTimeout(timeout);
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Read firmware version from RoboClaw.
   * @private
   * @returns {Promise<string>}
   */
  async _readVersion() {
    // Command 21: Read Firmware Version
    const response = await this._sendCommand(21, 0, 2);
    if (response) {
      const major = response[0];
      const minor = response[1];
      return `${major}.${minor}`;
    }
    return 'unknown';
  }

  /**
   * Send a command to RoboClaw and optionally read response.
   * @private
   * @param {number} command - Command byte
   * @param {number} value - Value to send (if any)
   * @param {number} responseBytes - Number of bytes to read back
   * @returns {Promise<Buffer|null>}
   */
  async _sendCommand(command, value = null, responseBytes = 0) {
    if (!this._port || !this._port.isOpen) {
      throw new Error('Serial port not open');
    }

    const addr = this.options.address;
    let crc = addr + command;

    // Build command buffer
    let cmdBytes;
    if (value !== null && value !== undefined) {
      // Value is 0-255, single byte
      cmdBytes = Buffer.from([addr, command, value & 0xFF]);
    } else {
      cmdBytes = Buffer.from([addr, command]);
    }

    // Write command
    await this._write(cmdBytes);

    // Read response if expected
    if (responseBytes > 0) {
      return this._read(responseBytes);
    }

    return null;
  }

  /**
   * Write bytes to serial port.
   * @private
   */
  _write(buffer) {
    return new Promise((resolve, reject) => {
      this._port.write(buffer, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Read bytes from serial port.
   * @private
   */
  _read(byteCount) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Serial read timeout'));
      }, this.options.timeout);

      const chunks = [];
      let totalBytes = 0;

      const onData = (data) => {
        chunks.push(data);
        totalBytes += data.length;

        if (totalBytes >= byteCount) {
          this._port.removeListener('data', onData);
          clearTimeout(timeout);
          resolve(Buffer.concat(chunks, byteCount));
        }
      };

      this._port.on('data', onData);
    });
  }

  /**
   * Set motor speeds for tank-style differential drive.
   * Uses M1 and M2 duty cycle commands (commands 34 and 35).
   * @param {number} leftSpeed - Left motor speed (-1.0 to 1.0)
   * @param {number} rightSpeed - Right motor speed (-1.0 to 1.0)
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async setSpeed(leftSpeed, rightSpeed) {
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

    // Convert to 127-bit duty cycle (RoboClaw uses 0-127 for forward, 128-255 for reverse)
    const toDutyCycle = (speed) => {
      if (speed >= 0) {
        return Math.round(speed * 127);
      } else {
        return Math.round(128 + (speed * 127));
      }
    };

    const leftDuty = toDutyCycle(leftSpeed);
    const rightDuty = toDutyCycle(rightSpeed);

    try {
      // Command 34: Set M1 Duty Cycle (0-255, 128=stop, 0-127=forward, 129-255=reverse)
      await this._sendCommand(34, leftDuty);
      // Command 35: Set M2 Duty Cycle
      await this._sendCommand(35, rightDuty);

      this._leftSpeed = leftSpeed;
      this._rightSpeed = rightSpeed;
      this.emit('speedChanged', { leftSpeed, rightSpeed, oldLeft: 0, oldRight: 0 });

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
   * @returns {Promise<void>}
   */
  async emergencyStop() {
    try {
      // Send stop commands to both motors immediately
      await this._sendCommand(34, 128); // M1 stop (128 = neutral)
      await this._sendCommand(35, 128); // M2 stop

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
    this._enabled = false;
    this._telemetry.enabled = false;
    await this.stop();
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
   * For RoboClaw, this returns cached values.
   * To get live voltage, use readMainVoltage().
   * @returns {import('./MotorController.js').MotorTelemetry}
   */
  getTelemetry() {
    return { ...this._telemetry };
  }

  /**
   * Read main battery voltage from RoboClaw.
   * Command 24: Read Main Battery Level
   * @returns {Promise<number>} Voltage in volts (scaled by 10)
   */
  async readMainVoltage() {
    try {
      // Command 24 returns voltage * 10 as a 16-bit value
      const response = await this._sendCommand(24, null, 2);
      if (response) {
        const voltage10 = (response[0] << 8) | response[1];
        return voltage10 / 10;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read main voltage');
    }
    return 0;
  }

  /**
   * Read logic battery level from RoboClaw.
   * Command 26: Read Logic Battery Level
   * @returns {Promise<number>} Voltage in volts (scaled by 10)
   */
  async readLogicVoltage() {
    try {
      const response = await this._sendCommand(26, null, 2);
      if (response) {
        const voltage10 = (response[0] << 8) | response[1];
        return voltage10 / 10;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read logic voltage');
    }
    return 0;
  }

  /**
   * Clean up resources and close serial port.
   * @returns {Promise<void>}
   */
  async dispose() {
    await this.emergencyStop();

    if (this._port) {
      return new Promise((resolve) => {
        this._port.close(() => {
          this._port = null;
          this._initialized = false;
          this.emit('disposed');
          resolve();
        });
      });
    }
  }
}

export default RoboClawMotorController;
