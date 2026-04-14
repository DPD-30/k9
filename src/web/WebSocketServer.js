import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../observability/logger.js';

/**
 * WebSocket server for real-time robot status updates.
 * Pushes telemetry and state changes to connected clients.
 */
export class RobotWebSocketServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      // WebSocket server path
      path: options.path ?? '/ws',
      // Ping interval to detect dead connections (ms)
      pingIntervalMs: options.pingIntervalMs ?? 30000,
    };

    this.wss = null;
    this.clients = new Set();
    this.pingInterval = null;
  }

  /**
   * Attach WebSocket server to HTTP server.
   * @param {import('http').Server} httpServer - Node.js HTTP server
   */
  attach(httpServer) {
    this.wss = new WebSocketServer({
      server: httpServer,
      path: this.options.path,
    });

    this.wss.on('connection', (ws, req) => this._handleConnection(ws, req));

    // Start ping interval to detect dead connections
    this.pingInterval = setInterval(() => {
      this.clients.forEach(ws => {
        if (ws.isAlive === false) {
          if (typeof ws.terminate === 'function') {
            ws.terminate();
          }
          return;
        }
        ws.isAlive = false;
        if (typeof ws.ping === 'function') {
          ws.ping();
        }
      });
    }, this.options.pingIntervalMs);

    this.wss.on('close', () => {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
    });

    logger.info({ path: this.options.path }, 'WebSocket server attached');
  }

  /**
   * Handle new WebSocket connection.
   * @private
   * @param {WebSocket} ws - WebSocket instance
   * @param {http.IncomingMessage} req - HTTP request
   */
  _handleConnection(ws, req) {
    logger.debug({ ip: req.socket.remoteAddress }, 'New WebSocket connection');

    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      logger.debug({ remaining: this.clients.size }, 'WebSocket client disconnected');
    });

    ws.on('error', (err) => {
      logger.warn({ error: err.message }, 'WebSocket error');
    });

    // Send initial state to new client
    this.clients.add(ws);
    logger.info({ total: this.clients.size }, 'WebSocket client connected');

    // Send welcome message
    this.send(ws, {
      type: 'connected',
      message: 'Connected to K9 robot control server',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send message to a specific client.
   * @param {WebSocket} ws - WebSocket instance
   * @param {object} data - Message data
   */
  send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  /**
   * Broadcast message to all connected clients.
   * @param {object} data - Message data
   */
  broadcast(data) {
    const message = JSON.stringify(data);
    const deadClients = [];

    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      } else {
        deadClients.push(ws);
      }
    });

    // Clean up dead clients
    deadClients.forEach(ws => {
      this.clients.delete(ws);
      if (typeof ws.terminate === 'function') {
        ws.terminate();
      }
    });

    logger.debug({ count: this.clients.size }, 'Broadcast message sent');
  }

  /**
   * Get number of connected clients.
   * @returns {number}
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * Clean up resources.
   */
  close() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.wss) {
      this.clients.forEach(ws => {
        if (typeof ws.close === 'function') {
          ws.close(1000, 'Server shutting down');
        }
      });
      this.clients.clear();

      this.wss.close();
      this.wss = null;
    }

    logger.info('WebSocket server closed');
  }
}

export default RobotWebSocketServer;
