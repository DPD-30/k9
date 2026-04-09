import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BrickPi3MotorController } from '../motors/BrickPi3MotorController.js';

describe('BrickPi3MotorController', () => {
  describe('constructor', () => {
    it('should create with default options', () => {
      const controller = new BrickPi3MotorController();
      assert.strictEqual(controller.options.address, 0);
      assert.strictEqual(controller.options.leftMotorPort, 'PORT_A');
      assert.strictEqual(controller.options.rightMotorPort, 'PORT_B');
      assert.strictEqual(controller.options.useEncoders, true);
    });

    it('should create with custom options', () => {
      const controller = new BrickPi3MotorController({
        address: 1,
        leftMotorPort: 'PORT_C',
        rightMotorPort: 'PORT_D',
        useEncoders: false,
      });
      assert.strictEqual(controller.options.address, 1);
      assert.strictEqual(controller.options.leftMotorPort, 'PORT_C');
      assert.strictEqual(controller.options.rightMotorPort, 'PORT_D');
      assert.strictEqual(controller.options.useEncoders, false);
    });
  });

  describe('initialization', () => {
    it('should have telemetry object', () => {
      const controller = new BrickPi3MotorController();
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

    it('should return disabled state before enable', () => {
      const controller = new BrickPi3MotorController();
      assert.strictEqual(controller.isEnabled(), false);
    });
  });

  describe('setSpeed validation', () => {
    it('should fail when not initialized', async () => {
      const controller = new BrickPi3MotorController();
      const result = await controller.setSpeed(0.5, 0.5);
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('initialized'));
      assert.strictEqual(controller.isEnabled(), false);
    });

    it('should fail when disabled', async () => {
      const controller = new BrickPi3MotorController();
      // Mark as initialized without actually initializing hardware
      controller._initialized = true;

      const result = await controller.setSpeed(0.5, 0.5);
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('disabled'));
      assert.strictEqual(controller.isEnabled(), false);
    });

    it('should clamp speeds to valid range', async () => {
      const controller = new BrickPi3MotorController();
      controller._initialized = true;
      controller._enabled = true;

      // Set up mock _bp
      controller._bp = {
        set_motor_power: async () => {},
      };

      const result = await controller.setSpeed(1.5, -1.5);
      assert.strictEqual(result.success, true);

      const telemetry = controller.getTelemetry();
      assert.strictEqual(telemetry.leftSpeed, 1.0);
      assert.strictEqual(telemetry.rightSpeed, -1.0);
    });
  });

  describe('enable/disable', () => {
    it('should enable when initialized', async () => {
      const controller = new BrickPi3MotorController();
      controller._initialized = true;

      const result = await controller.enable();
      assert.strictEqual(result.success, true);
      assert.strictEqual(controller.isEnabled(), true);
    });

    it('should fail enable when not initialized', async () => {
      const controller = new BrickPi3MotorController();

      const result = await controller.enable();
      assert.strictEqual(result.success, false);
      assert.strictEqual(controller.isEnabled(), false);
    });

    it('should disable motors', async () => {
      const controller = new BrickPi3MotorController();
      controller._initialized = true;
      controller._enabled = true;
      controller._bp = { set_motor_power: async () => {} };

      await controller.disable();
      assert.strictEqual(controller.isEnabled(), false);
    });
  });

  describe('emergencyStop', () => {
    it('should stop motors and disable', async () => {
      const controller = new BrickPi3MotorController();
      controller._initialized = true;
      controller._enabled = true;
      controller._leftSpeed = 0.5;
      controller._rightSpeed = 0.5;

      // Set up mock _bp
      controller._bp = {
        set_motor_power: async () => {},
      };

      await controller.emergencyStop();

      assert.strictEqual(controller.isEnabled(), false);
      const telemetry = controller.getTelemetry();
      assert.strictEqual(telemetry.leftSpeed, 0);
      assert.strictEqual(telemetry.rightSpeed, 0);
    });

    it('should emit emergencyStop event', async () => {
      const controller = new BrickPi3MotorController();
      controller._initialized = true;
      controller._enabled = true;
      controller._bp = { set_motor_power: async () => {} };

      const promise = new Promise((resolve) => {
        controller.once('emergencyStop', resolve);
      });

      await controller.emergencyStop();
      await promise;
    });
  });

  describe('telemetry', () => {
    it('should return telemetry object', () => {
      const controller = new BrickPi3MotorController();
      const telemetry = controller.getTelemetry();

      assert.ok(typeof telemetry === 'object');
      assert.ok('voltage' in telemetry);
      assert.ok('leftSpeed' in telemetry);
      assert.ok('rightSpeed' in telemetry);
      assert.ok('enabled' in telemetry);
    });
  });

  describe('port validation', () => {
    it('should throw on invalid port', () => {
      const controller = new BrickPi3MotorController();

      assert.throws(() => {
        controller._getPort('PORT_INVALID');
      }, /Invalid motor port/);
    });

    it('should return valid port numbers', () => {
      const controller = new BrickPi3MotorController();

      assert.strictEqual(controller._getPort('PORT_A'), 0);
      assert.strictEqual(controller._getPort('PORT_B'), 1);
      assert.strictEqual(controller._getPort('PORT_C'), 2);
      assert.strictEqual(controller._getPort('PORT_D'), 3);
    });
  });

  describe('dispose', () => {
    it('should clean up resources', async () => {
      const controller = new BrickPi3MotorController();
      controller._initialized = true;
      controller._enabled = true;
      controller._bp = { set_motor_power: async () => {} };

      const promise = new Promise((resolve) => {
        controller.once('disposed', resolve);
      });

      await controller.dispose();
      await promise;

      assert.strictEqual(controller._initialized, false);
      assert.strictEqual(controller._bp, null);
    });
  });
});
