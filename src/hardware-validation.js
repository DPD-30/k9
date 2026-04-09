/**
 * Hardware Validation Script
 *
 * Wires together RobotController, BrickPi3MotorController, and WiimoteInput
 * for basic hardware validation.
 *
 * Controls:
 * - Nunchuk Stick Y: Forward/Reverse
 * - Nunchuk Stick X: Turn left/right
 * - Z Button: Emergency Stop (press again to reset)
 * - Home Button: Emergency Stop
 *
 * Usage:
 *   cd k9/k9
 *   node src/hardware-validation.js
 */

import { RobotController } from './control/RobotController.js';
import { BrickPi3MotorController } from './motors/BrickPi3MotorController.js';
import { WiimoteInput } from './input/WiimoteInput.js';
import {logger} from './observability/logger.js';

async function main() {
  console.log('='.repeat(50));
  console.log('K9 Hardware Validation');
  console.log('='.repeat(50));
  console.log('');
 
  // Create instances
  const motorController = new BrickPi3MotorController({
    leftMotorPort: 'PORT_A',
    rightMotorPort: 'PORT_B',
    useEncoders: false,
  });

  const wiimoteInput = new WiimoteInput({
    enableNunchuk: true,
    autoReconnect: true,
    reconnectIntervalMs: 3000,
  });

  const robotController = new RobotController({
    loopIntervalMs: 50,
    inputTimeoutMs: 2000,
    accelRate: 0.5,
    decelRate: 0.8,
    deadband: 0.15,
    minMovementSpeed: 0.15,
  });

  // Setup event handlers
  wiimoteInput.on('connected', (info) => {
    console.log(`[Wiimote] Connected (Player ${info.player})`);
    console.log(`[Wiimote] Nunchuk: ${info.nunchuk ? 'Yes' : 'No'}`);
    console.log('');
    console.log('Controls:');
    console.log('  - Stick Y: Forward/Reverse');
    console.log('  - Stick X: Turn Left/Right');
    console.log('  - Z Button: E-Stop (press again to reset)');
    console.log('  - Home: E-Stop');
    console.log('');
    console.log('Press the Z button to ENABLE the robot.');
    console.log('='.repeat(50));
  });

  wiimoteInput.on('disconnected', () => {
    console.log('[Wiimote] Disconnected!');
  });

  wiimoteInput.on('nunchuk-z', ({ pressed }) => {
    if (pressed) {
      const status = robotController.getStatus();
      if (status.eStopActive) {
        const result = robotController.resetEStop();
        if (result.success) {
          console.log('[Input] E-stop RESET - Press Z button to enable');
        }
      } else {
        robotController.emergencyStop({ source: 'nunchuk-z-button' });
      }
    }
  });

  wiimoteInput.on('home', ({ pressed }) => {
    if (pressed) {
      robotController.emergencyStop({ source: 'home-button' });
    }
  });

  robotController.on('stateChanged', (event) => {
    console.log(`[Robot] State: ${event.from} -> ${event.to}`);
  });

  robotController.on('emergencyStop', (ctx) => {
    console.log(`[Robot] EMERGENCY STOP: ${ctx?.source || 'unknown'}`);
  });

  robotController.on('batteryWarning', (info) => {
    console.log(`[Robot] Battery warning: ${info.voltage.toFixed(2)}V`);
  });

  // Initialize motor controller FIRST
  console.log('[Init] Initializing BrickPi3 motor controller...');
  try {
    const motorResult = await motorController.initialize();
    console.log('brickpi init do')
    if (!motorResult.success) {
      console.error(`[Error] Motor controller failed: ${motorResult.error}`);
      process.exit(1);
    }
    console.log('[Init] BrickPi3 initialized OK');
  } catch (err) {
    console.error(`[Error] Motor controller exception: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }

  // Then connect to Wiimote
  console.log('[Init] Connecting to Wiimote...');
  const connected = await wiimoteInput.connect();
  if (!connected) {
    console.error('[Error] Failed to connect to Wiimote');
    await motorController.dispose();
    process.exit(1);
  }

  // Initialize robot controller
  console.log('[Init] Initializing robot controller...');
  const result = await robotController.initialize(motorController, wiimoteInput);
  if (!result.success) {
    console.error(`[Error] Robot controller failed: ${result.error}`);
    await motorController.dispose();
    await wiimoteInput.disconnect();
    process.exit(1);
  }

  console.log('');
  console.log('[Init] Hardware validation ready!');
  console.log('');

  // Start control loop
  robotController.start();

  // Wait for SIGINT/SIGTERM
  const shutdown = async () => {
    console.log('');
    console.log('[Shutdown] Stopping...');
    await robotController.dispose();
    console.log('[Shutdown] Complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal error:', err);
  console.error(err.stack);
  process.exit(1);
});
