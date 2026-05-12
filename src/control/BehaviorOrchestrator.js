import { logger } from "../observability/logger.js";

/**
 * BehaviorOrchestrator manages high-level Moods and a Sequence Player.
 * It handles LERP interpolation for smooth servo movement and coordinates
 * the ServoController and BackPanelLeds.
 */
export class BehaviorOrchestrator {
  constructor(servoController, ledController, config = {}) {
    this.servoController = servoController;
    this.ledController = ledController;
    this.config = config;

    // Current state for all servos: { servoName: currentAngle }
    this.servoStates = {};

    // Active sequences currently playing: { servoName: { targetAngle, startTime, duration, startAngle } }
    this.activeAnimations = {};

    // Current Mood
    this.currentMood = 'IDLE';

    // Mood Definitions: Map of Mood -> { servoSequences, ledPattern }
    this.moods = {
      'IDLE': {
        ledPattern: 'RANDOM',
        sequences: [
          { servo: 'tailPan', angle: 10, duration: 1000, loop: true, mirror: -10 }
        ]
      },
      'EXCITED': {
        ledPattern: 'SNAKE',
        sequences: [
          { servo: 'tailPan', angle: 30, duration: 300, loop: true, mirror: -30 },
          { servo: 'headPitch', angle: -20, duration: 200, loop: true, mirror: 0 }
        ]
      },
      'THINKING': {
        ledPattern: 'SNAKE',
        sequences: [
          { servo: 'earLeft', angle: 30, duration: 800, loop: true, mirror: -30 },
          { servo: 'earRight', angle: -30, duration: 800, loop: true, mirror: 30 }
        ]
      },
      'FAULT': {
        ledPattern: 'FAULT',
        sequences: [] // Servos should be stopped by the Controller
      }
    };
  }

  /**
   * Main update loop called every 33ms.
   * Calculates LERP values and updates hardware.
   */
  update(deltaTime) {
    const now = Date.now();

    // 1. Update all active LERP animations
    for (const servoName in this.activeAnimations) {
      const anim = this.activeAnimations[servoName];
      const elapsed = now - anim.startTime;
      const progress = Math.min(elapsed / anim.duration, 1);

      // Linear Interpolation: current = start + (end - start) * progress
      const currentAngle = anim.startAngle + (anim.targetAngle - anim.startAngle) * progress;

      this.servoController.setPosition(servoName, currentAngle);
      this.servoStates[servoName] = currentAngle;

      // If animation finished and is not looping, remove it
      if (progress >= 1) {
        if (anim.loop) {
          this._restartAnimation(servoName, anim);
        } else {
          delete this.activeAnimations[servoName];
        }
      }
    }
  }

  /**
   * Transitions the robot to a new mood.
   * @param {string} moodId - The ID of the mood to enter
   */
  setMood(moodId) {
    if (this.currentMood === moodId) return;

    const mood = this.moods[moodId];
    if (!mood) {
      logger.error(`Attempted to set unknown mood: ${moodId}`);
      return;
    }

    logger.info(`Transitioning mood: ${this.currentMood} -> ${moodId}`);
    this.currentMood = moodId;

    // 1. Update LEDs
    this.ledController.setPattern(mood.ledPattern);

    // 2. Trigger Servo Sequences
    this.activeAnimations = {}; // Clear previous mood animations
    mood.sequences.forEach(seq => this.playSequence(seq));
  }

  /**
   * Plays a specific servo sequence with blending.
   */
  playSequence(seq, priority = 'LOW') {
    // Preemption: If a HIGH priority animation is running, LOW cannot interrupt
    if (this.activeAnimations[seq.servo]?.priority === 'HIGH' && priority === 'LOW') {
      return;
    }

    const startAngle = this.servoStates[seq.servo] || 0;

    this.activeAnimations[seq.servo] = {
      startAngle: startAngle,
      targetAngle: seq.angle,
      startTime: Date.now(),
      duration: seq.duration,
      loop: seq.loop,
      mirror: seq.mirror,
      priority: priority
    };
  }

  _restartAnimation(servoName, anim) {
    const newTarget = anim.mirror !== undefined ? anim.mirror : anim.startAngle;
    const newStart = anim.targetAngle;

    this.activeAnimations[servoName] = {
      ...anim,
      startAngle: newStart,
      targetAngle: newTarget,
      startTime: Date.now()
    };
  }

  /**
   * Immediate override for manual control.
   * Suppresses automated animations for the specified servo.
   */
  overrideServo(servoName, angle) {
    // Remove from active animations to stop the LERP engine from fighting manual input
    delete this.activeAnimations[servoName];
    this.servoController.setPosition(servoName, angle);
    this.servoStates[servoName] = angle;
  }
}
