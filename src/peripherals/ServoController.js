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
      headPitch: { min: 500, max: 2500, trim: 0, limitMin: -30, limitMax: 20 },
      earLeft:   { min: 500, max: 2500, trim: 0, limitMin: -90, limitMax: 90 },
      earRight:  { min: 500, max: 2500, trim: 0, limitMin: -90, limitMax: 90 },
      tailPan:   { min: 500, max: 2500, trim: 0, limitMin: -45, limitMax: 45 },
      tailTilt:  { min: 500, max: 2500, trim: 0, limitMin: -45, limitMax: 45 },
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

    // 1. Logical Clamp: Limit the range of motion for the specific body part
    let clampedAngle = angle;
    if (cal.limitMin !== undefined && cal.limitMax !== undefined) {
      clampedAngle = Math.max(cal.limitMin, Math.min(cal.limitMax, angle));
    }

    if (clampedAngle !== angle) {
      logger.debug(`Servo ${servoName} angle ${angle} logically clamped to ${clampedAngle}`);
    }

    // 2. Calculate raw pulse based on the (clamped) angle
    const pulseRange = cal.max - cal.min;
    let pulse = cal.min + (clampedAngle / 180) * pulseRange;

    // 3. Apply trim (offset in microseconds)
    pulse += cal.trim;

    // 4. HARD SAFETY CLAMP: Final check against absolute hardware limits
    const finalPulse = Math.max(cal.min, Math.min(cal.max, pulse));

    if (finalPulse !== pulse) {
      logger.warn(`Servo ${servoName} pulse ${pulse}µs hard-clamped to ${finalPulse}µs`);
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
