import { logger } from "../observability/logger.js";

/**
 * ServoController manages the mapping and safety limits for all robot servos.
 * It prevents mechanical over-extension using calibrated min/max/trim values.
 */
export class ServoController {
  constructor(driver, config) {
    this.driver = driver;
    this.config = config;

    // Mapping logical servo names to PCA9685 channels
    this.servoMap = {
      headPitch: 0,
      earLeft: 1,
      earRight: 2,
      tailPan: 3,
      tailTilt: 4
    };

    // Default calibration if config is missing (Safety defaults)
    this.calibration = config.servos || {
      headPitch: { min: 500, max: 2500, trim: 0 },
      earLeft:   { min: 500, max: 2500, trim: 0 },
      earRight:  { min: 500, max: 2500, trim: 0 },
      tailPan:   { min: 500, max: 2500, trim: 0 },
      tailTilt:  { min: 500, max: 2500, trim: 0 },
    };
  }

  /**
   * Moves a servo to a specific angle.
   * @param {string} servoName - Name from servoMap (e.g., 'headPitch')
   * @param {number} angle - Target angle in degrees (-180 to 180)
   * @throws {Error} If the servo name is not mapped, triggering a system FAULT.
   */
  setPosition(servoName, angle) {
    const channel = this.servoMap[servoName];
    const cal = this.calibration[servoName];

    if (channel === undefined || !cal) {
      throw new Error(`CRITICAL_CONFIG_ERROR: Unknown servo identifier '${servoName}'. Hardware mapping failed.`);
    }

    // 1. Calculate raw pulse based on angle
    const pulseRange = cal.max - cal.min;
    let pulse = cal.min + (angle / 180) * pulseRange;

    // 2. Apply trim (offset in microseconds)
    pulse += cal.trim;

    // 3. HARD SAFETY CLAMP
    const finalPulse = Math.max(cal.min, Math.min(cal.max, pulse));

    if (finalPulse !== pulse) {
      logger.warn(`Servo ${servoName} angle ${angle} clamped to ${finalPulse}µs`);
    }

    this.driver.setPulseLength(channel, Math.round(finalPulse));
  }

  /**
   * Immediately stops all servo signals.
   * Required for E-Stop safety.
   */
  stopAll() {
    Object.values(this.servoMap).forEach(channel => {
      this.driver.channelOff(channel);
    });
    logger.info("All servos halted (stopAll)");
  }

  /**
   * Updates calibration for a specific servo.
   * Used by the Web UI calibration page.
   */
  updateCalibration(servoName, newCal) {
    if (!this.calibration[servoName]) throw new Error(`Unknown servo ${servoName}`);

    this.calibration[servoName] = { ...this.calibration[servoName], ...newCal };
    logger.info(`Calibrated ${servoName}: ${JSON.stringify(this.calibration[servoName])}`);
  }
}
