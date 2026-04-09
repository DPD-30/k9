import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { StubMotorController } from '../motors/StubMotorController.js';

describe('StubMotorController', () => {
  let controller;

  before(() => {
    controller = new StubMotorController({
      telemetryUpdateIntervalMs: 50,
      baseVoltage: 12.0,
    });
  });

  after(async () => {
    await controller.dispose();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const result = await controller.initialize();
      assert.strictEqual(result.success, true);
      assert.strictEqual(controller.isInitialized(), true);
    });

    it('should return success if already initialized', async () => {
      const result = await controller.initialize();
      assert.strictEqual(result.success, true);
    });

    it('should emit initialized event', async () => {
      const newController = new StubMotorController();
      const promise = new Promise((resolve) => {
        newController.once('initialized', resolve);
      });
      await newController.initialize();
      await promise;
      await newController.dispose();
    });
  });

  describe('enable/disable', () => {
    it('should enable when not faulted', async () => {
      const result = await controller.enable();
      assert.strictEqual(result.success, true);
      assert.strictEqual(controller.isEnabled(), true);
    });

    it('should disable motors', async () => {
      await controller.enable();
      await controller.disable();
      assert.strictEqual(controller.isEnabled(), false);
    });

    it('should not enable when faulted', async () => {
      const faultedController = new StubMotorController();
      await faultedController.initialize();
      faultedController.simulateFault('TEST_FAULT');

      const result = await faultedController.enable();
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('fault'));

      await faultedController.dispose();
    });
  });

  describe('setSpeed', () => {
    it('should set motor speeds', async () => {
      await controller.initialize();
      await controller.enable();

      const result = await controller.setSpeed(0.5, 0.5);
      assert.strictEqual(result.success, true);

      const speed = controller.getSpeed();
      assert.strictEqual(speed.leftSpeed, 0.5);
      assert.strictEqual(speed.rightSpeed, 0.5);
    });

    it('should clamp speeds to valid range', async () => {
      await controller.enable();

      await controller.setSpeed(1.5, -1.5);
      const speed = controller.getSpeed();
      assert.strictEqual(speed.leftSpeed, 1.0);
      assert.strictEqual(speed.rightSpeed, -1.0);
    });

    it('should fail when not initialized', async () => {
      const uninitController = new StubMotorController();
      const result = await uninitController.setSpeed(0.5, 0.5);
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('initialized'));
    });

    it('should fail when disabled', async () => {
      const disabledController = new StubMotorController();
      await disabledController.initialize();
      // Don't enable

      const result = await disabledController.setSpeed(0.5, 0.5);
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('disabled'));

      await disabledController.dispose();
    });

    it('should emit speedChanged event', async () => {
      await controller.initialize();
      await controller.enable();

      const promise = new Promise((resolve) => {
        controller.once('speedChanged', resolve);
      });
      await controller.setSpeed(0.3, 0.3);
      const event = await promise;
      assert.strictEqual(event.leftSpeed, 0.3);
      assert.strictEqual(event.rightSpeed, 0.3);
    });
  });

  describe('stop', () => {
    it('should stop both motors', async () => {
      await controller.initialize();
      await controller.enable();
      await controller.setSpeed(0.5, 0.5);

      await controller.stop();

      const speed = controller.getSpeed();
      assert.strictEqual(speed.leftSpeed, 0);
      assert.strictEqual(speed.rightSpeed, 0);
    });

    it('should emit stopped event', async () => {
      await controller.initialize();
      await controller.enable();

      const promise = new Promise((resolve) => {
        controller.once('stopped', resolve);
      });
      await controller.stop();
      await promise;
    });
  });

  describe('emergencyStop', () => {
    it('should stop motors and disable', async () => {
      await controller.initialize();
      await controller.enable();
      await controller.setSpeed(0.5, 0.5);

      await controller.emergencyStop();

      assert.strictEqual(controller.isEnabled(), false);
      const speed = controller.getSpeed();
      assert.strictEqual(speed.leftSpeed, 0);
      assert.strictEqual(speed.rightSpeed, 0);
    });

    it('should emit emergencyStop event', async () => {
      await controller.initialize();
      await controller.enable();

      const promise = new Promise((resolve) => {
        controller.once('emergencyStop', resolve);
      });
      await controller.emergencyStop();
      await promise;
    });
  });

  describe('telemetry', () => {
    it('should return telemetry object', async () => {
      await controller.initialize();

      const telemetry = controller.getTelemetry();
      assert.ok(typeof telemetry.voltage === 'number');
      assert.ok(typeof telemetry.current === 'number');
      assert.ok(typeof telemetry.temperature === 'number');
      assert.ok(typeof telemetry.leftSpeed === 'number');
      assert.ok(typeof telemetry.rightSpeed === 'number');
      assert.ok(typeof telemetry.enabled === 'boolean');
      assert.ok(typeof telemetry.fault === 'boolean');
      assert.ok(Array.isArray(telemetry.faults));
    });

    it('should emit telemetryUpdate events', async () => {
      await controller.initialize();
      await controller.enable();
      await controller.setSpeed(0.5, 0.5);

      const promise = new Promise((resolve) => {
        controller.once('telemetryUpdate', resolve);
      });
      const telemetry = await promise;
      assert.ok(telemetry.voltage > 0);
    });

    it('should allow setting simulated voltage', async () => {
      await controller.initialize();
      controller.setSimulatedVoltage(11.5);

      const telemetry = controller.getTelemetry();
      assert.strictEqual(telemetry.voltage, 11.5);
    });
  });

  describe('fault handling', () => {
    it('should simulate fault', async () => {
      const faultController = new StubMotorController();
      await faultController.initialize();

      const promise = new Promise((resolve) => {
        faultController.once('fault', resolve);
      });

      faultController.simulateFault('TEST');
      const event = await promise;

      assert.strictEqual(event.code, 'TEST');
      assert.ok(event.faults.includes('TEST'));

      const telemetry = faultController.getTelemetry();
      assert.strictEqual(telemetry.fault, true);

      await faultController.dispose();
    });

    it('should clear fault', async () => {
      const faultController = new StubMotorController();
      await faultController.initialize();
      faultController.simulateFault('TEST');

      const promise = new Promise((resolve) => {
        faultController.once('faultCleared', resolve);
      });

      faultController.clearFault();
      await promise;

      const telemetry = faultController.getTelemetry();
      assert.strictEqual(telemetry.fault, false);
      assert.strictEqual(telemetry.faults.length, 0);

      await faultController.dispose();
    });
  });

  describe('dispose', () => {
    it('should clean up resources', async () => {
      const disposeController = new StubMotorController();
      await disposeController.initialize();
      await disposeController.enable();

      const promise = new Promise((resolve) => {
        disposeController.once('disposed', resolve);
      });

      await disposeController.dispose();
      await promise;

      assert.strictEqual(disposeController.isInitialized(), false);
    });
  });
});
