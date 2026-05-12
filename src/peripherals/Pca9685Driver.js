import i2c from "i2c-bus";
import { Pca9685Driver as BasePcaDriver } from "pca9685";
import { logger } from "../observability/logger.js";

/**
 * Pca9685Driver provides a clean wrapper around the pca9685 library.
 * It manages the I2C connection and low-level PWM pulse lengths.
 */
export class Pca9685Driver {
  constructor(config = {}) {
    this.address = config.address || 0x40;
    this.frequency = config.frequency || 50;
    this.pwm = null;
    this.i2cBus = null;
  }

  /**
   * Initializes the PCA9685 hardware.
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.i2cBus = i2c.openSync(1);

      return new Promise((resolve, reject) => {
        const options = {
          i2c: this.i2cBus,
          address: this.address,
          frequency: this.frequency,
          debug: false
        };

        this.pwm = new BasePcaDriver(options, (err) => {
          if (err) {
            logger.error({ err }, "Failed to initialize PCA9685 hardware");
            reject(err);
          } else {
            logger.info("PCA9685 hardware initialized successfully");
            resolve();
          }
        });
      });
    } catch (error) {
      logger.error({ error }, "I2C bus open failure");
      throw error;
    }
  }

  /**
   * Sets the pulse length for a specific channel.
   * @param {number} channel - The PCA9685 channel (0-15)
   * @param {number} pulseLength - Pulse length in microseconds
   */
  setPulseLength(channel, pulseLength) {
    if (!this.pwm) throw new Error("PCA9685 not initialized");
    this.pwm.setPulseLength(channel, pulseLength);
  }

  /**
   * Disables a specific channel.
   * @param {number} channel - The PCA9685 channel (0-15)
   */
  channelOff(channel) {
    if (!this.pwm) throw new Error("PCA9685 not initialized");
    this.pwm.channelOff(channel);
  }

  /**
   * Shuts down the I2C connection.
   */
  dispose() {
    if (this.i2cBus) {
      this.i2cBus.closeSync();
      this.i2cBus = null;
      logger.info("PCA9685 I2C bus closed");
    }
  }
}
