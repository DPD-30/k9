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
  logger.info('='.repeat(50));
  logger.info('K9 Hardware Validation');
  logger.info('='.repeat(50));
  logger.info('');
 
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
    logger.info(`[Wiimote] Connected (Player ${info.player})`);
    logger.info(`[Wiimote] Nunchuk: ${info.nunchuk ? 'Yes' : 'No'}`);
    logger.info('');
    logger.info('Controls:');
    logger.info('  - Stick Y: Forward/Reverse');
    logger.info('  - Stick X: Turn Left/Right');
    logger.info('  - Z Button: E-Stop (press again to reset)');
    logger.info('  - Home: E-Stop');
    logger.info('');
    logger.info('Press the Z button to ENABLE the robot.');
    logger.info('='.repeat(50));
  });

  wiimoteInput.on('disconnected', () => {
    logger.info('[Wiimote] Disconnected!');
  });

/*   wiimoteInput.on('nunchuk-z', ({ pressed }) => {
    if (pressed) {
      const status = robotController.getStatus();
      if (status.eStopActive) { 
        const result = robotController.resetEStop();
         if (result.success) {
          logger.info('[Input] E-stop RESET - Press Z button to enable');
        }
      } else {
        robotController.emergencyStop({ source: 'nunchuk-z-button' });
      } 
    }
  }); */

  wiimoteInput.on('home', ({ pressed }) => {
    if (pressed) {
      robotController.emergencyStop({ source: 'home-button' });
    }
  });

  robotController.on('stateChanged', (event) => {
    logger.info(`[Robot] State: ${event.from} -> ${event.to}`);
  });

  robotController.on('emergencyStop', (ctx) => {
    logger.info(`[Robot] EMERGENCY STOP: ${ctx?.source || 'unknown'}`);
  });

  robotController.on('batteryWarning', (info) => {
    logger.info(`[Robot] Battery warning: ${info.voltage.toFixed(2)}V`);
  });

  // Initialize motor controller FIRST
  logger.info('[Init] Initializing BrickPi3 motor controller...');
  try {
    const motorResult = await motorController.initialize();
    logger.info('brickpi init do')
    if (!motorResult.success) {
      logger.error(`[Error] Motor controller failed: ${motorResult.error}`);
      process.exit(1);
    }
    logger.info('[Init] BrickPi3 initialized OK');
  } catch (err) {
    logger.error(`[Error] Motor controller exception: ${err.message}`);
    logger.error(err.stack);
    process.exit(1);
  }

  // Then connect to Wiimote
  logger.info('[Init] Connecting to Wiimote...');
  const connected = await wiimoteInput.connect();
  if (!connected) {
    logger.error('[Error] Failed to connect to Wiimote');
    await motorController.dispose();
    process.exit(1);
  }

  // Initialize robot controller
  logger.info('[Init] Initializing robot controller...');
  const result = await robotController.initialize(motorController, wiimoteInput);
  if (!result.success) {
    logger.error(`[Error] Robot controller failed: ${result.error}`);
    await motorController.dispose();
    await wiimoteInput.disconnect();
    process.exit(1);
  }

  logger.info('');
  logger.info('[Init] Hardware validation ready!');
  logger.info('');

  // Start control loop
  robotController.start();

  // Wait for SIGINT/SIGTERM
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      logger.warn('[Shutdown] Already shutting down, forcing exit...');
      process.exit(1);
    }
    shuttingDown = true;

    logger.info('');
    logger.info(`[Shutdown] Received ${signal}, stopping...`);

    // Trigger emergency stop immediately for safety
    robotController.emergencyStop({ source: 'user-request' });

    // Give motors time to stop
    await new Promise(resolve => setTimeout(resolve, 100));

    await robotController.dispose();
    await wiimoteInput.disconnect();

    logger.info('[Shutdown] Complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Also handle uncaught exceptions
  process.on('uncaughtException', async (err) => {
    logger.error(`[Fatal] Uncaught exception: ${err.message}`);
    await shutdown('uncaught-exception');
  });
}

main().catch(err => {
  logger.error('Fatal error:', err);
  logger.error(err.stack);
  process.exit(1);
});
