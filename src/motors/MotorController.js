import { EventEmitter } from 'events';

/**
 * @typedef {Object} MotorTelemetry
 * @property {number} voltage - Supply voltage in volts
 * @property {number} current - Current draw in amps
 * @property {number} temperature - Motor/controller temperature in Celsius
 * @property {number} leftSpeed - Left motor speed (0.0 to 1.0)
 * @property {number} rightSpeed - Right motor speed (0.0 to 1.0)
 * @property {boolean} enabled - Whether motors are enabled
 * @property {boolean} fault - Whether a fault condition exists
 * @property {string[]} faults - List of fault codes/messages
 */

/**
 * MotorController base class for K9 robot drive system.
 * All implementations should extend this class.
 * Emits: initialized, speedChanged, stopped, emergencyStop, enabled, disabled, fault, faultCleared, telemetryUpdate, disposed
 */
export class MotorController extends EventEmitter {
  /**
   * Initialize the motor controller.
   * Must be called before any other methods.
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async initialize() {
    throw new Error('MotorController.initialize() must be implemented');
  }

  /**
   * Set motor speeds for tank-style differential drive.
   * @param {number} leftSpeed - Left motor speed (-1.0 to 1.0, negative = reverse)
   * @param {number} rightSpeed - Right motor speed (-1.0 to 1.0, negative = reverse)
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async setSpeed(leftSpeed, rightSpeed) {
    throw new Error('MotorController.setSpeed() must be implemented');
  }

  /**
   * Stop both motors with controlled deceleration.
   * @returns {Promise<void>}
   */
  async stop() {
    throw new Error('MotorController.stop() must be implemented');
  }

  /**
   * Emergency stop - immediate hard cut to motors.
   * @returns {Promise<void>}
   */
  async emergencyStop() {
    throw new Error('MotorController.emergencyStop() must be implemented');
  }

  /**
   * Enable motor output.
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async enable() {
    throw new Error('MotorController.enable() must be implemented');
  }

  /**
   * Disable motor output.
   * @returns {Promise<void>}
   */
  async disable() {
    throw new Error('MotorController.disable() must be implemented');
  }

  /**
   * Check if motors are currently enabled.
   * @returns {boolean}
   */
  isEnabled() {
    throw new Error('MotorController.isEnabled() must be implemented');
  }

  /**
   * Get current motor telemetry data.
   * @returns {MotorTelemetry}
   */
  getTelemetry() {
    throw new Error('MotorController.getTelemetry() must be implemented');
  }

  /**
   * Clean up resources and close connections.
   * @returns {Promise<void>}
   */
  async dispose() {
    throw new Error('MotorController.dispose() must be implemented');
  }
}

export default MotorController;
