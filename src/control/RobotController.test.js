import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RobotController } from '../control/RobotController.js';
import { StubMotorController } from '../motors/StubMotorController.js';
import { RobotState } from '../control/StateMachine.js';

describe('RobotController', () => {
  describe('initialization', () => {
    it('should initialize with motor controller', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      const result = await controller.initialize(motorController, null);
      assert.strictEqual(result.success, true);
      assert.strictEqual(controller.getStatus().state, RobotState.ENABLED);

      await controller.dispose();
    });

    it('should fail if motor controller initialization fails', async () => {
      const controller = new RobotController();

      // Create a mock motor controller that fails to initialize
      const failingMotorController = {
        initialize: async () => ({ success: false, error: 'Hardware not responding' }),
        dispose: async () => {},
      };

      const result = await controller.initialize(failingMotorController, null);
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('Hardware not responding'));

      await controller.dispose();
    });

    it('should emit stateChanged event on enable', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      const promise = new Promise((resolve) => {
        controller.once('stateChanged', resolve);
      });

      await controller.initialize(motorController, null);
      const event = await promise;

      assert.strictEqual(event.to, RobotState.ENABLED);
      assert.strictEqual(controller.getStatus().state, RobotState.ENABLED);

      await controller.dispose();
    });
  });

  describe('control loop', () => {
    it('should start and stop control loop', async () => {
      const controller = new RobotController({ loopIntervalMs: 50 });
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);
      controller.start();

      // Let it run for a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      assert.strictEqual(controller._running, true);

      await controller.stop();
      assert.strictEqual(controller._running, false);

      await controller.dispose();
    });

    it('should not start twice', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);
      controller.start();
      controller.start(); // Should be no-op

      await controller.stop();
      await controller.dispose();
    });
  });

  describe('enable/disable', () => {
    it('should enable robot', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);
      controller.disable(); // Start from disabled

      const result = controller.enable();
      assert.strictEqual(result.success, true);
      assert.strictEqual(controller.getStatus().state, RobotState.ENABLED);

      await controller.dispose();
    });

    it('should disable robot', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);

      const result = controller.disable();
      assert.strictEqual(result.success, true);
      assert.strictEqual(controller.getStatus().state, RobotState.DISABLED);

      await controller.dispose();
    });

    it('should not enable when E-stop is active', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);
      controller.emergencyStop();

      const result = controller.enable();
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('E-stop'));
      assert.strictEqual(controller.getStatus().state, RobotState.E_STOP);

      await controller.dispose();
    });
  });

  describe('emergency stop', () => {
    it('should trigger E-stop and stop motors', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);
      controller.start();

      const estopPromise = new Promise((resolve) => {
        controller.once('emergencyStop', resolve);
      });

      const result = controller.emergencyStop({ source: 'test' });
      assert.strictEqual(result.success, true);
      assert.strictEqual(controller.getStatus().state, RobotState.E_STOP);

      const event = await estopPromise;
      assert.strictEqual(event.source, 'test');

      await controller.stop();
      await controller.dispose();
    });

    it('should require E-stop reset before re-enable', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);
      controller.emergencyStop();

      // Try to enable without reset
      const result1 = controller.enable();
      assert.strictEqual(result1.success, false);
      assert.strictEqual(controller.getStatus().state, RobotState.E_STOP);

      // Reset E-stop
      const result2 = controller.resetEStop();
      assert.strictEqual(result2.success, true);
      assert.strictEqual(controller.getStatus().state, RobotState.DISABLED);

      // Now enable should work
      const result3 = controller.enable();
      assert.strictEqual(result3.success, true);
      assert.strictEqual(controller.getStatus().state, RobotState.ENABLED);

      await controller.dispose();
    });

    it('should emit emergencyStop event', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);

      const promise = new Promise((resolve) => {
        controller.once('emergencyStop', resolve);
      });

      controller.emergencyStop({ source: 'api' });
      const event = await promise;

      assert.strictEqual(event.source, 'api');
      assert.strictEqual(controller.getStatus().eStopActive, true);

      await controller.dispose();
    });
  });

  describe('speed ramping', () => {
    it('should ramp up speed gradually', async () => {
      const controller = new RobotController({
        loopIntervalMs: 50,
        accelRate: 1.0, // 1.0 per second
      });
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);
      controller.start();

      // Set target speeds via internal method
      controller._targetLeftSpeed = 0.5;
      controller._targetRightSpeed = 0.5;
      controller._stateMachine.startDriving();

      // After one loop, speed should not have reached target yet
      await new Promise(resolve => setTimeout(resolve, 60));

      const status = controller.getStatus();
      // Speed should be less than target (still ramping)
      assert.ok(status.motorSpeeds.left <= 0.5);
      assert.ok(status.motorSpeeds.right <= 0.5);

      await controller.stop();
      await controller.dispose();
    });

    it('should apply deadband', async () => {
      const controller = new RobotController({ deadband: 0.1 });
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);

      // Set small target speed within deadband
      controller._targetLeftSpeed = 0.05;
      controller._targetRightSpeed = 0.05;

      await controller._applySpeedRamping();

      // Speed should be clamped to 0 due to deadband
      assert.strictEqual(controller._currentLeftSpeed, 0);
      assert.strictEqual(controller._currentRightSpeed, 0);

      await controller.dispose();
    });
  });

  describe('input timeout', () => {
    it('should detect input timeout and stop driving', async () => {
      const controller = new RobotController({ inputTimeoutMs: 100 });
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);
      controller.start();
      controller._stateMachine.startDriving();

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should have transitioned out of DRIVING due to timeout
      const status = controller.getStatus();
      assert.strictEqual(status.inputTimeout, true);
      assert.ok(status.state !== RobotState.DRIVING);

      await controller.stop();
      await controller.dispose();
    });

    it('should reset timeout on new input', async () => {
      const controller = new RobotController({ inputTimeoutMs: 100 });
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);
      controller.start();

      // Simulate input received
      controller._handleInputReceived();
      assert.strictEqual(controller._inputTimeoutActive, false);

      // Wait for timeout period
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be in timeout
      assert.strictEqual(controller._inputTimeoutActive, true);

      // Simulate new input
      controller._handleInputReceived();
      assert.strictEqual(controller._inputTimeoutActive, false);

      await controller.stop();
      await controller.dispose();
    });
  });

  describe('battery monitoring', () => {
    it('should detect low battery warning', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);
      motorController.setSimulatedVoltage(10.5); // Below warning threshold

      await controller._updateBatteryStatus();

      const status = controller.getStatus();
      assert.strictEqual(status.batteryWarning, 'warning');

      await controller.dispose();
    });

    it('should detect critical battery and trigger E-stop', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);
      motorController.setSimulatedVoltage(9.5); // Below critical threshold

      const estopPromise = new Promise((resolve) => {
        controller.once('emergencyStop', resolve);
      });

      await controller._updateBatteryStatus();
      await estopPromise;

      const status = controller.getStatus();
      assert.strictEqual(status.batteryWarning, 'critical');
      assert.strictEqual(status.state, RobotState.E_STOP);

      await controller.dispose();
    });
  });

  describe('getStatus', () => {
    it('should return full status object', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);

      const status = controller.getStatus();

      assert.ok(typeof status.state === 'string');
      assert.ok(typeof status.batteryVoltage === 'number');
      assert.ok(typeof status.batteryWarning === 'string');
      assert.ok(typeof status.inputTimeout === 'boolean');
      assert.ok(typeof status.eStopActive === 'boolean');
      assert.ok(typeof status.motorSpeeds === 'object');
      assert.ok(typeof status.motorSpeeds.left === 'number');
      assert.ok(typeof status.motorSpeeds.right === 'number');

      await controller.dispose();
    });
  });

  describe('dispose', () => {
    it('should clean up resources', async () => {
      const controller = new RobotController();
      const motorController = new StubMotorController();

      await controller.initialize(motorController, null);
      controller.start();

      const disposePromise = new Promise((resolve) => {
        controller.once('disposed', resolve);
      });

      await controller.dispose();
      await disposePromise;

      assert.strictEqual(controller._running, false);
      assert.strictEqual(controller._motorController, null);

      await motorController.dispose();
    });
  });
});
