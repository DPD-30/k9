import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { logger } from '../observability/logger.js';
import { createRobotRoutes } from './routes.js';
import { RobotWebSocketServer } from './WebSocketServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main web server for K9 robot control.
 * Combines Express HTTP server with WebSocket real-time updates.
 */
export class RobotWebServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      // HTTP server port
      port: options.port ?? 3000,
      // Serve static files from public directory
      serveStatic: options.serveStatic ?? true,
      // Static files directory
      staticPath: options.staticPath ?? path.join(__dirname, 'public'),
    };

    this.app = express();
    this.server = null;
    this.wsServer = null;
    this.robotController = null;
    this.motorController = null;
  }

  /**
   * Initialize web server with robot controller dependencies.
   * @param {RobotController} robotController - Robot controller instance
   * @param {MotorController} motorController - Motor controller instance
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async initialize(robotController, motorController) {
    try {
      this.robotController = robotController;
      this.motorController = motorController;

      // JSON body parser
      this.app.use(express.json());

      // Request logging middleware
      this.app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
          const duration = Date.now() - start;
          logger.debug({
            method: req.method,
            path: req.url,
            status: res.statusCode,
            duration,
          }, 'HTTP request');
        });
        next();
      });

      // Static files
      if (this.options.serveStatic) {
        this.app.use(express.static(this.options.staticPath));
        logger.info({ path: this.options.staticPath }, 'Serving static files');
      }

      // REST API routes
      const routes = createRobotRoutes(robotController, motorController);
      this.app.use('/api', routes);
      logger.info('REST API routes registered');

      // WebSocket server for real-time updates
      this.wsServer = new RobotWebSocketServer();

      // Set up robot state change listener to broadcast to WebSocket clients
      robotController.on('stateChanged', (event) => {
        this._broadcastState(event);
      });

      robotController.on('emergencyStop', (ctx) => {
        this._broadcastEvent({ type: 'emergencyStop', context: ctx });
      });

      robotController.on('batteryWarning', (info) => {
        this._broadcastEvent({ type: 'batteryWarning', voltage: info.voltage });
      });

      logger.info('RobotWebServer initialized');
      return { success: true };
    } catch (err) {
      logger.error({ err }, 'Failed to initialize RobotWebServer');
      return { success: false, error: err.message };
    }
  }

  /**
   * Start the HTTP server.
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async start() {
    try {
      return new Promise((resolve, reject) => {
        this.server = http.createServer(this.app);

        // Attach WebSocket server
        this.wsServer.attach(this.server);

        this.server.listen(this.options.port, () => {
          logger.info({ port: this.options.port }, 'RobotWebServer started');
          resolve({ success: true });
        });

        this.server.on('error', (err) => {
          logger.error({ err }, 'RobotWebServer error');
          reject(err);
        });
      });
    } catch (err) {
      logger.error({ err }, 'Failed to start RobotWebServer');
      return { success: false, error: err.message };
    }
  }

  /**
   * Broadcast state change to all WebSocket clients.
   * @private
   * @param {object} event - State change event
   */
  _broadcastState(event) {
    const status = this.robotController.getStatus();
    const telemetry = this.motorController?.getTelemetry?.() || {};

    this.wsServer.broadcast({
      type: 'stateChanged',
      timestamp: new Date().toISOString(),
      robot: {
        state: status.state,
        from: event.from,
        to: event.to,
        eStopActive: status.eStopActive,
        batteryVoltage: status.batteryVoltage || telemetry.voltage || 0,
        batteryWarning: status.batteryWarning || 'ok',
      },
      motors: {
        enabled: this.motorController?.isEnabled?.() || false,
        leftSpeed: status.motorSpeeds?.left || 0,
        rightSpeed: status.motorSpeeds?.right || 0,
      },
      wsClients: this.wsServer.getClientCount(),
    });
  }

  /**
   * Broadcast generic event to all WebSocket clients.
   * @private
   * @param {object} data - Event data
   */
  _broadcastEvent(data) {
    this.wsServer.broadcast({
      timestamp: new Date().toISOString(),
      ...data,
    });
  }

  /**
   * Get the underlying HTTP server.
   * @returns {http.Server|null}
   */
  getServer() {
    return this.server;
  }

  /**
   * Get WebSocket client count.
   * @returns {number}
   */
  getClientCount() {
    return this.wsServer?.getClientCount?.() || 0;
  }

  /**
   * Clean up resources and stop server.
   * @returns {Promise<void>}
   */
  async dispose() {
    return new Promise((resolve) => {
      if (this.wsServer) {
        this.wsServer.close();
        this.wsServer = null;
      }

      if (this.server) {
        this.server.close(() => {
          logger.info('RobotWebServer stopped');
          this.server = null;
          this.app = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export default RobotWebServer;
