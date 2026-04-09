import { describe, it } from 'node:test';
import assert from 'node:assert';
import { StateMachine, RobotState } from '../control/StateMachine.js';

describe('StateMachine', () => {
  describe('initialization', () => {
    it('should start in DISABLED state', () => {
      const sm = new StateMachine();
      sm.initialize();
      assert.strictEqual(sm.getState(), RobotState.DISABLED);
    });

    it('should emit initialized event', async () => {
      const sm = new StateMachine();
      const promise = new Promise((resolve) => {
        sm.once('initialized', resolve);
      });
      sm.initialize();
      const event = await promise;
      assert.strictEqual(event.state, RobotState.DISABLED);
      assert.strictEqual(sm.getState(), RobotState.DISABLED);
    });

    it('should clear history on initialize', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();
      sm.disable();
      sm.initialize();
      const history = sm.getHistory();
      assert.strictEqual(history.length, 0); // initialize() clears history
      assert.strictEqual(sm.getState(), RobotState.DISABLED);
    });
  });

  describe('state transitions', () => {
    it('should transition DISABLED -> ENABLED', () => {
      const sm = new StateMachine();
      sm.initialize();
      const result = sm.enable();
      assert.strictEqual(result.success, true);
      assert.strictEqual(sm.getState(), RobotState.ENABLED);
    });

    it('should transition ENABLED -> DRIVING', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();
      const result = sm.startDriving();
      assert.strictEqual(result.success, true);
      assert.strictEqual(sm.getState(), RobotState.DRIVING);
    });

    it('should transition DRIVING -> ENABLED (stop driving)', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();
      sm.startDriving();
      const result = sm.stopDriving();
      assert.strictEqual(result.success, true);
      assert.strictEqual(sm.getState(), RobotState.ENABLED);
    });

    it('should transition ENABLED -> DISABLED', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();
      const result = sm.disable();
      assert.strictEqual(result.success, true);
      assert.strictEqual(sm.getState(), RobotState.DISABLED);
    });
  });

  describe('emergency stop', () => {
    it('should transition to E_STOP from any active state', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();
      sm.startDriving();
      const result = sm.emergencyStop({ source: 'test' });
      assert.strictEqual(result.success, true);
      assert.strictEqual(sm.getState(), RobotState.E_STOP);
    });

    it('should not allow direct transition E_STOP -> ENABLED', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.emergencyStop();
      const result = sm.enable();
      assert.strictEqual(result.success, false);
      assert.strictEqual(sm.getState(), RobotState.E_STOP);
    });

    it('should allow E_STOP -> DISABLED via resetEStop', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.emergencyStop();
      const result = sm.resetEStop();
      assert.strictEqual(result.success, true);
      assert.strictEqual(sm.getState(), RobotState.DISABLED);
    });

    it('should emit stateChanged event on E-stop', async () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();

      const promise = new Promise((resolve) => {
        sm.once('stateChanged', resolve);
      });

      sm.emergencyStop({ source: 'button' });
      const event = await promise;

      assert.strictEqual(event.from, RobotState.ENABLED);
      assert.strictEqual(event.to, RobotState.E_STOP);
      assert.strictEqual(event.context.source, 'button');
      assert.strictEqual(sm.getState(), RobotState.E_STOP);
    });
  });

  describe('fault handling', () => {
    it('should transition to FAULT from any state', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();
      const result = sm.fault('TEST_FAULT');
      assert.strictEqual(result.success, true);
      assert.strictEqual(sm.getState(), RobotState.FAULT);
    });

    it('should include faultCode in context', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();
      sm.fault('TEST_FAULT');
      const history = sm.getHistory();
      const lastEntry = history[history.length - 1];
      assert.strictEqual(lastEntry.context.faultCode, 'TEST_FAULT');
      assert.strictEqual(sm.getState(), RobotState.FAULT);
    });

    it('should not allow direct FAULT -> ENABLED', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.fault('TEST');
      const result = sm.enable();
      assert.strictEqual(result.success, false);
      assert.strictEqual(sm.getState(), RobotState.FAULT);
    });

    it('should allow FAULT -> DISABLED via clearFault', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.fault('TEST');
      const result = sm.clearFault();
      assert.strictEqual(result.success, true);
      assert.strictEqual(sm.getState(), RobotState.DISABLED);
    });
  });

  describe('transition denial', () => {
    it('should deny E_STOP -> ENABLED directly', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.emergencyStop();
      const result = sm.enable();
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('Cannot transition'));
      assert.strictEqual(sm.getState(), RobotState.E_STOP);
    });

    it('should emit transitionDenied event', async () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.emergencyStop();

      const promise = new Promise((resolve) => {
        sm.once('transitionDenied', resolve);
      });

      sm.enable();
      const event = await promise;

      assert.strictEqual(event.from, RobotState.E_STOP);
      assert.strictEqual(event.to, RobotState.ENABLED);
      assert.ok(event.reason.includes('Cannot transition'));
      assert.strictEqual(sm.getState(), RobotState.E_STOP);
    });
  });

  describe('auto-drive on input', () => {
    it('should auto-transition to DRIVING on input when ENABLED', () => {
      const sm = new StateMachine({ autoDriveOnInput: true });
      sm.initialize();
      sm.enable();

      const result = sm.handleInput({ stickY: 0.5 });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transitioned, true);
      assert.strictEqual(sm.getState(), RobotState.DRIVING);
    });

    it('should not auto-transition if disabled', () => {
      const sm = new StateMachine({ autoDriveOnInput: true });
      sm.initialize();

      const result = sm.handleInput({ stickY: 0.5 });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transitioned, false);
      assert.strictEqual(sm.getState(), RobotState.DISABLED);
    });

    it('should not auto-transition if option disabled', () => {
      const sm = new StateMachine({ autoDriveOnInput: false });
      sm.initialize();
      sm.enable();

      const result = sm.handleInput({ stickY: 0.5 });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transitioned, false);
      assert.strictEqual(sm.getState(), RobotState.ENABLED);
    });
  });

  describe('input timeout handling', () => {
    it('should transition DRIVING -> ENABLED on input timeout', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();
      sm.startDriving();

      const result = sm.handleInputTimeout();
      assert.strictEqual(result.success, true);
      assert.strictEqual(sm.getState(), RobotState.ENABLED);
    });

    it('should do nothing if not DRIVING', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();

      const result = sm.handleInputTimeout();
      assert.strictEqual(result.success, true);
      assert.strictEqual(sm.getState(), RobotState.ENABLED);
    });
  });

  describe('state history', () => {
    it('should track state history', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();
      sm.startDriving();
      sm.stopDriving();
      sm.disable();

      const history = sm.getHistory();
      assert.ok(history.length >= 4);

      assert.strictEqual(history[0].state, RobotState.ENABLED);
      assert.strictEqual(history[1].state, RobotState.DRIVING);
      assert.strictEqual(sm.getState(), RobotState.DISABLED);
    });

    it('should limit history to 100 entries', () => {
      const sm = new StateMachine();
      sm.initialize();

      for (let i = 0; i < 150; i++) {
        sm.enable();
        sm.disable();
      }

      const history = sm.getHistory();
      assert.ok(history.length <= 100);
      assert.strictEqual(sm.getState(), RobotState.DISABLED);
    });

    it('should return limited history with getHistory(limit)', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();
      sm.startDriving();
      sm.stopDriving();
      sm.disable();

      const history = sm.getHistory(2);
      assert.strictEqual(history.length, 2);
      assert.strictEqual(sm.getState(), RobotState.DISABLED);
    });
  });

  describe('isStopped and isActive helpers', () => {
    it('should return true for isStopped in DISABLED', () => {
      const sm = new StateMachine();
      sm.initialize();
      assert.strictEqual(sm.isStopped(), true);
      assert.strictEqual(sm.isActive(), false);
    });

    it('should return true for isActive in ENABLED', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();
      assert.strictEqual(sm.isActive(), true);
      assert.strictEqual(sm.isStopped(), false);
      assert.strictEqual(sm.getState(), RobotState.ENABLED);
    });

    it('should return true for isActive in DRIVING', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.enable();
      sm.startDriving();
      assert.strictEqual(sm.isActive(), true);
      assert.strictEqual(sm.isStopped(), false);
      assert.strictEqual(sm.getState(), RobotState.DRIVING);
    });

    it('should return true for isStopped in E_STOP', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.emergencyStop();
      assert.strictEqual(sm.isStopped(), true);
      assert.strictEqual(sm.isActive(), false);
      assert.strictEqual(sm.getState(), RobotState.E_STOP);
    });

    it('should return true for isStopped in FAULT', () => {
      const sm = new StateMachine();
      sm.initialize();
      sm.fault('TEST');
      assert.strictEqual(sm.isStopped(), true);
      assert.strictEqual(sm.isActive(), false);
      assert.strictEqual(sm.getState(), RobotState.FAULT);
    });
  });
});
