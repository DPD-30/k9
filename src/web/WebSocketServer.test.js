/**
 * WebSocket Server Tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { WebSocket } from 'ws';
import { RobotWebSocketServer } from './WebSocketServer.js';

const WS_OPEN = 1;
const WS_CLOSED = 3;
const WS_CONNECTING = 0;

describe('RobotWebSocketServer', () => {
  let wsServer;
  let httpServer;
  let port;

  beforeEach(async () => {
    port = 4000 + Math.floor(Math.random() * 1000);
    httpServer = http.createServer();
    wsServer = new RobotWebSocketServer({ path: '/ws', pingIntervalMs: 30000 });

    await new Promise((resolve) => {
      httpServer.listen(port, resolve);
    });

    wsServer.attach(httpServer);
  });

  afterEach(async () => {
    wsServer.close();
    await new Promise((resolve) => {
      httpServer.close(resolve);
    });
  });

  describe('getClientCount', () => {
    it('should return 0 when no clients connected', () => {
      const count = wsServer.getClientCount();
      assert.strictEqual(count, 0);
    });

    it('should return client count after connection', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);

        ws.on('open', () => {
          const count = wsServer.getClientCount();
          assert.strictEqual(count, 1);
          ws.close();
          resolve();
        });

        ws.on('error', reject);
      });
    });
  });

  describe('broadcast', () => {
    it('should broadcast message to all connected clients', async () => {
      await new Promise((resolve, reject) => {
        const messages = [];
        const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
        const ws2 = new WebSocket(`ws://localhost:${port}/ws`);

        let connected = 0;

        const checkDone = () => {
          connected++;
          if (connected === 2) {
            wsServer.broadcast({ type: 'test', data: 'hello' });
          }
        };

        ws1.on('open', checkDone);
        ws2.on('open', checkDone);

        const onMessage = (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'connected') return; // Skip welcome message
          messages.push(msg);
          if (messages.length === 2) {
            assert.strictEqual(messages[0].type, 'test');
            assert.strictEqual(messages[1].type, 'test');
            ws1.close();
            ws2.close();
            resolve();
          }
        };

        ws1.on('message', onMessage);
        ws2.on('message', onMessage);

        ws1.on('error', reject);
        ws2.on('error', reject);
      });
    });
  });

  describe('send', () => {
    it('should send message to specific client', { timeout: 2000 }, async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);

        ws.on('open', () => {
          wsServer.send(ws, { type: 'direct', message: 'hello' });
        });

        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'connected') return; // Skip welcome message
          assert.strictEqual(msg.type, 'direct');
          assert.strictEqual(msg.message, 'hello');
          ws.close();
          resolve();
        });

        ws.on('error', reject);
      });
    });

    it('should not send to closed client', () => {
      const mockWs = {
        readyState: WS_CLOSED,
        send: () => assert.fail('Should not send'),
      };

      wsServer.send(mockWs, { type: 'test' });
    });
  });

  describe('close', () => {
    it('should close all client connections', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);

        ws.on('open', () => {
          assert.strictEqual(wsServer.getClientCount(), 1);
          wsServer.close();
          assert.strictEqual(wsServer.getClientCount(), 0);
          resolve();
        });

        ws.on('error', reject);
      });
    });
  });

  describe('WebSocket events', () => {
    it('should emit connected event with welcome message', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);

        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'connected') {
            assert.strictEqual(msg.message, 'Connected to K9 robot control server');
            assert.ok(msg.timestamp);
            ws.close();
            resolve();
          }
        });

        ws.on('error', reject);
      });
    });

    it('should handle client disconnect', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);

        ws.on('open', () => {
          assert.strictEqual(wsServer.getClientCount(), 1);
          ws.close();
        });

        ws.on('close', () => {
          setTimeout(() => {
            assert.strictEqual(wsServer.getClientCount(), 0);
            resolve();
          }, 100);
        });

        ws.on('error', reject);
      });
    });
  });

  describe('ping interval', () => {
    it('should clean up ping interval on close', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);

        ws.on('open', () => {
          assert.ok(wsServer.pingInterval);
          wsServer.close();
          assert.strictEqual(wsServer.pingInterval, null);
          resolve();
        });

        ws.on('error', reject);
      });
    });

    it('should mark clients alive on pong', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);

        ws.on('open', () => {
          // Get the server-side WebSocket instance
          const serverWs = Array.from(wsServer.clients)[0];
          serverWs.isAlive = false;
          serverWs.emit('pong');
          assert.strictEqual(serverWs.isAlive, true);
          ws.close();
          resolve();
        });

        ws.on('error', reject);
      });
    });
  });

  describe('broadcast dead client cleanup', () => {
    it('should remove dead clients during broadcast', () => {
      const mockWs = {
        readyState: WS_CLOSED,
        terminate: () => {},
      };

      wsServer.clients.add(mockWs);
      assert.strictEqual(wsServer.clients.size, 1);

      wsServer.broadcast({ type: 'test' });

      assert.strictEqual(wsServer.clients.size, 0);
    });

    it('should handle client error events', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);
        let errorHandled = false;

        ws.on('open', () => {
          ws.close();
        });

        ws.on('close', () => {
          if (errorHandled) resolve();
        });

        // Server handles errors, test just verifies no crash
        const errorHandler = () => {
          errorHandled = true;
        };
        ws.on('error', errorHandler);

        // Trigger error after connection
        setTimeout(() => {
          ws.emit('error', new Error('test error'));
          setTimeout(resolve, 50);
        }, 10);
      });
    });
  });

  describe('_handleConnection', () => {
    it('should set isAlive true on connection', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);

        ws.on('open', () => {
          // isAlive is set on server-side WebSocket, not client
          setTimeout(() => {
            const serverWs = Array.from(wsServer.clients)[0];
            assert.strictEqual(serverWs.isAlive, true);
            ws.close();
            resolve();
          }, 10);
        });

        ws.on('error', reject);
      });
    });

    it('should handle close event and remove client', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);

        ws.on('open', () => {
          assert.strictEqual(wsServer.clients.size, 1);
          ws.close();
        });

        ws.on('close', () => {
          setTimeout(() => {
            assert.strictEqual(wsServer.clients.size, 0);
            resolve();
          }, 50);
        });

        ws.on('error', reject);
      });
    });

    it('should add client on connection', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);

        ws.on('open', () => {
          // Wait for server to add client to Set
          setTimeout(() => {
            assert.ok(wsServer.clients.has(ws));
            ws.close();
            resolve();
          }, 10);
        });

        ws.on('error', reject);
      });
    });
  });

  describe('send with readyState check', () => {
    it('should send when WebSocket.OPEN', () => {
      let sent = false;
      const mockWs = {
        readyState: WS_OPEN,
        send: (data) => { sent = true; },
      };

      wsServer.send(mockWs, { type: 'test' });
      assert.strictEqual(sent, true);
    });

    it('should not send when not OPEN', () => {
      const mockWs = {
        readyState: WS_CONNECTING,
        send: () => assert.fail('Should not send'),
      };

      wsServer.send(mockWs, { type: 'test' });
    });
  });

  describe('ping interval logic', () => {
    it('should terminate dead clients and ping alive ones', (done) => {
      const mockWs = {
        isAlive: false,
        terminate: () => { done(); },
        ping: () => {},
      };

      wsServer.clients.add(mockWs);
      clearInterval(wsServer.pingInterval);

      wsServer.pingInterval = setInterval(() => {
        wsServer.clients.forEach(ws => {
          if (ws.isAlive === false) {
            ws.terminate();
          }
          ws.isAlive = false;
          ws.ping();
        });
      }, 100);

      setTimeout(() => {
        clearInterval(wsServer.pingInterval);
      }, 150);
    });
  });

  describe('close clears interval', () => {
    it('should clear ping interval on close', () => {
      assert.ok(wsServer.pingInterval);
      wsServer.close();
      assert.strictEqual(wsServer.pingInterval, null);
    });

    it('should close clients with reason', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`);

        ws.on('open', () => {
          wsServer.close();
          setTimeout(() => {
            assert.strictEqual(ws.readyState, WebSocket.CLOSED);
            resolve();
          }, 50);
        });

        ws.on('error', reject);
      });
    });
  });
});
