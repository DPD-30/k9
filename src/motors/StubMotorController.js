import { MotorController } from './MotorController.js';

/**
 * Stub motor controller for development and testing.
 * Accepts all commands and tracks state but doesn't talk to real hardware.
 * Simulates telemetry data for testing.
 *
 * Telemetry recording to OpenTelemetry should happen at the application layer
 * (e.g., RobotController), not here. This keeps the motor controller focused
 * on hardware control and makes it easier to test.
 */
export class StubMotorController extends MotorController {
  constructor(options = {}) {
    super();
    this.options = {
      telemetryUpdateIntervalMs: options.telemetryUpdateIntervalMs ?? 100,
      baseVoltage: options.baseVoltage ?? 12.0,
      restCurrent: options.restCurrent ?? 0.5,
      currentPerSpeed: options.currentPerSpeed ?? 2.0,
    };

    this._enabled = false;
    this._leftSpeed = 0;
    this._rightSpeed = 0;
    this._initialized = false;
    this._fault = false;
    this._faults = [];
    this._telemetryInterval = null;

    this._telemetry = {
      voltage: this.options.baseVoltage,
      current: this.options.restCurrent,
      temperature: 25.0,
      leftSpeed: 0,
      rightSpeed: 0,
      enabled: false,
      fault: false,
      faults: [],
    };
  }

  async initialize() {
    if (this._initialized) {
      return { success: true };
    }

    this._initialized = true;
    this._startTelemetrySimulation();
    this.emit('initialized');
    return { success: true };
  }

  async setSpeed(leftSpeed, rightSpeed) {
    if (!this._initialized) {
      return { success: false, error: 'Motor controller not initialized' };
    }

    if (!this._enabled) {
      return { success: false, error: 'Motor controller is disabled' };
    }

    const clamp = (v) => Math.max(-1, Math.min(1, v));
    leftSpeed = clamp(leftSpeed);
    rightSpeed = clamp(rightSpeed);

    const oldLeft = this._leftSpeed;
    const oldRight = this._rightSpeed;

    this._leftSpeed = leftSpeed;
    this._rightSpeed = rightSpeed;
    this.emit('speedChanged', { leftSpeed, rightSpeed, oldLeft, oldRight });

    return { success: true };
  }

  async stop() {
    await this.setSpeed(0, 0);
    this.emit('stopped');
  }

  async emergencyStop() {
    this._leftSpeed = 0;
    this._rightSpeed = 0;
    this._enabled = false;
    this._telemetry.enabled = false;
    this.emit('emergencyStop');
  }

  async enable() {
    if (!this._initialized) {
      return { success: false, error: 'Motor controller not initialized' };
    }

    if (this._fault) {
      return { success: false, error: 'Cannot enable: fault condition exists' };
    }

    this._enabled = true;
    this._telemetry.enabled = true;
    this.emit('enabled');
    return { success: true };
  }

  async disable() {
    this._enabled = false;
    this._telemetry.enabled = false;
    await this.stop();
    this.emit('disabled');
  }

  isEnabled() {
    return this._enabled;
  }

  isInitialized() {
    return this._initialized;
  }

  getTelemetry() {
    return { ...this._telemetry };
  }

  simulateFault(faultCode) {
    if (!this._faults.includes(faultCode)) {
      this._faults.push(faultCode);
    }
    this._fault = true;
    this._telemetry.fault = true;
    this._telemetry.faults = [...this._faults];
    this.emit('fault', { code: faultCode, faults: this._faults });
  }

  clearFault() {
    this._fault = false;
    this._faults = [];
    this._telemetry.fault = false;
    this._telemetry.faults = [];
    this.emit('faultCleared');
  }

  setSimulatedVoltage(voltage) {
    this._telemetry.voltage = voltage;
  }

  async dispose() {
    this._stopTelemetrySimulation();
    await this.emergencyStop();
    this._initialized = false;
    this.emit('disposed');
  }

  _startTelemetrySimulation() {
    this._telemetryInterval = setInterval(() => {
      this._updateTelemetry();
    }, this.options.telemetryUpdateIntervalMs);
  }

  _stopTelemetrySimulation() {
    if (this._telemetryInterval) {
      clearInterval(this._telemetryInterval);
      this._telemetryInterval = null;
    }
  }

  _updateTelemetry() {
    const avgSpeed = (Math.abs(this._leftSpeed) + Math.abs(this._rightSpeed)) / 2;
    const loadDrop = avgSpeed * 0.5;
    this._telemetry.voltage = this.options.baseVoltage - loadDrop;

    const speedCurrent = avgSpeed * this.options.currentPerSpeed;
    this._telemetry.current = this.options.restCurrent + speedCurrent;

    const targetTemp = 25 + (avgSpeed * 20);
    const tempChange = (targetTemp - this._telemetry.temperature) * 0.01;
    this._telemetry.temperature += tempChange;

    this._telemetry.leftSpeed = this._leftSpeed;
    this._telemetry.rightSpeed = this._rightSpeed;

    this.emit('telemetryUpdate', { ...this._telemetry });
  }

  getSpeed() {
    return {
      leftSpeed: this._leftSpeed,
      rightSpeed: this._rightSpeed,
    };
  }
}

export default StubMotorController;
