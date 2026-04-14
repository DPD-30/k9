import { RobotController } from './control/RobotController.js';
import { BrickPi3MotorController } from './motors/BrickPi3MotorController.js';
import { WiimoteInput } from './input/WiimoteInput.js';
import { RobotWebServer } from './web/RobotWebServer.js';
import { logger } from './observability/logger.js';
import { startTelemetry, shutdownTelemetry } from './observability/otel.js';

/**
 * K9 Robot Main Entry Point
 *
 * Wires together:
 * - BrickPi3 Motor Controller
 * - Wiimote Input (Nunchuk)
 * - Robot Controller (state machine, safety)
 * - Web Server (REST API + WebSocket)
 *
 * Usage:
 *   node src/app.js
 *
 * Web UI: http://localhost:3000
 * API:    http://localhost:3000/api/status
 */

async function main() {
  logger.info('='.repeat(50));
  logger.info('K9 Robot Control System');
  logger.info('='.repeat(50));

  await startTelemetry();

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

  const webServer = new RobotWebServer({
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
  });

  // Initialize motor controller
  logger.info('[Init] Initializing motor controller...');
  const motorResult = await motorController.initialize();
  if (!motorResult.success) {
    logger.error(`[Error] Motor controller failed: ${motorResult.error}`);
    process.exit(1);
  }
  logger.info('[Init] Motor controller initialized');

  // Connect to Wiimote
  logger.info('[Init] Connecting to Wiimote...');
  const wiimoteConnected = await wiimoteInput.connect();
  if (!wiimoteConnected) {
    logger.error('[Error] Failed to connect to Wiimote');
    await motorController.dispose();
    process.exit(1);
  }
  logger.info('[Init] Wiimote connected');

  // Initialize robot controller
  logger.info('[Init] Initializing robot controller...');
  const robotResult = await robotController.initialize(motorController, wiimoteInput);
  if (!robotResult.success) {
    logger.error(`[Error] Robot controller failed: ${robotResult.error}`);
    await motorController.dispose();
    await wiimoteInput.disconnect();
    process.exit(1);
  }
  logger.info('[Init] Robot controller initialized');

  // Initialize web server
  logger.info('[Init] Initializing web server...');
  const webResult = await webServer.initialize(robotController, motorController);
  if (!webResult.success) {
    logger.error(`[Error] Web server failed: ${webResult.error}`);
    await robotController.dispose();
    await motorController.dispose();
    await wiimoteInput.disconnect();
    process.exit(1);
  }

  // Start control loop
  robotController.start();
  logger.info('[Init] Control loop started');

  // Start web server
  await webServer.start();
  logger.info('[Init] Web server started');

  logger.info('');
  logger.info('='.repeat(50));
  logger.info('K9 Robot ready!');
  logger.info('Web UI: http://localhost:' + (process.env.PORT || 3000));
  logger.info('API:    http://localhost:' + (process.env.PORT || 3000) + '/api/status');
  logger.info('='.repeat(50));

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      logger.warn('[Shutdown] Already shutting down, forcing exit...');
      process.exit(1);
    }
    shuttingDown = true;

    logger.info('');
    logger.info(`[Shutdown] Received ${signal}, stopping...`);

    // Emergency stop first for safety
    robotController.emergencyStop({ source: 'shutdown' });

    // Give motors time to stop
    await new Promise(resolve => setTimeout(resolve, 100));

    await webServer.dispose();
    await robotController.dispose();
    await wiimoteInput.disconnect();
    await motorController.dispose();
    await shutdownTelemetry();

    logger.info('[Shutdown] Complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

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