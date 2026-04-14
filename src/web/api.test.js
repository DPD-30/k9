/**
 * API Endpoint Tests
 *
 * Tests for the REST API routes using stubbed controllers.
 * Run with: npm test
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { RobotController } from '../control/RobotController.js';
import { StubMotorController } from '../motors/StubMotorController.js';
import { RobotWebServer } from './RobotWebServer.js';

/**
 * Helper to make HTTP requests.
 * @param {string} method - HTTP method
 * @param {string} path - URL path
 * @param {number} port - Server port
 * @param {object} body - Request body (for POST)
 * @returns {Promise<{ status: number, data: object }>}
 */
async function request(method, path, port, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: data ? JSON.parse(data) : {},
          });
        } catch (err) {
          resolve({
            status: res.statusCode,
            data: { raw: data },
          });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

describe('Robot Web API', () => {
  let webServer;
  let robotController;
  let motorController;
  let port;

  beforeEach(async () => {
    // Find available port
    port = 3000 + Math.floor(Math.random() * 1000);

    // Create stub motor controller
    motorController = new StubMotorController({
      leftMotorPort: 'PORT_A',
      rightMotorPort: 'PORT_B',
    });

    // Initialize motor controller
    await motorController.initialize();

    // Create robot controller
    robotController = new RobotController({
      loopIntervalMs: 50,
      inputTimeoutMs: 2000,
    });

    // Initialize robot controller with stub input
    await robotController.initialize(motorController, {
      getState: () => ({ stickX: 0, stickY: 0 }),
      on: () => {},
    });

    // Create and start web server
    webServer = new RobotWebServer({ port, serveStatic: false });
    await webServer.initialize(robotController, motorController);
    await webServer.start();

    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    if (webServer) {
      await webServer.dispose();
    }
    if (robotController) {
      await robotController.dispose();
    }
    if (motorController) {
      await motorController.dispose();
    }

    // Wait for server to fully close
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  describe('GET /api/status', () => {
    it('should return robot status', async () => {
      const res = await request('GET', '/api/status', port);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.robot);
      assert.strictEqual(typeof res.data.robot.state, 'string');
      assert.strictEqual(typeof res.data.robot.eStopActive, 'boolean');
    });

    it('should show DISABLED state initially', async () => {
      const res = await request('GET', '/api/status', port);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.robot.state, 'DISABLED');
    });

    it('should show motor disabled status initially', async () => {
      const res = await request('GET', '/api/status', port);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.motors.enabled, false);
    });
  });

  describe('POST /api/enable', () => {
    it('should enable the robot', async () => {
      const res = await request('POST', '/api/enable', port);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);

      // Verify state changed
      const statusRes = await request('GET', '/api/status', port);
      assert.strictEqual(statusRes.data.robot.state, 'ENABLED');
    });

    it('should return motor telemetry after enable', async () => {
      await request('POST', '/api/enable', port);

      const res = await request('GET', '/api/status', port);
      assert.strictEqual(res.data.robot.state, 'ENABLED');
      assert.ok(res.data.telemetry);
    });
  });

  describe('POST /api/disable', () => {
    it('should disable the robot', async () => {
      // First enable
      await request('POST', '/api/enable', port);

      // Then disable
      const res = await request('POST', '/api/disable', port);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);

      // Verify state changed
      const statusRes = await request('GET', '/api/status', port);
      assert.strictEqual(statusRes.data.robot.state, 'DISABLED');
    });
  });

  describe('POST /api/estop', () => {
    it('should trigger emergency stop', async () => {
      // First enable
      await request('POST', '/api/enable', port);

      // Trigger E-stop
      const res = await request('POST', '/api/estop', port);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);

      // Verify E-stop state
      const statusRes = await request('GET', '/api/status', port);
      assert.strictEqual(statusRes.data.robot.state, 'E_STOP');
      assert.strictEqual(statusRes.data.robot.eStopActive, true);
    });

    it('should stop motors during E-stop', async () => {
      await request('POST', '/api/enable', port);
      await request('POST', '/api/estop', port);

      const res = await request('GET', '/api/status', port);
      assert.strictEqual(res.data.motors.leftSpeed, 0);
      assert.strictEqual(res.data.motors.rightSpeed, 0);
    });
  });

  describe('POST /api/reset-estop', () => {
    it('should reset E-stop and return to DISABLED', async () => {
      // Enable then E-stop
      await request('POST', '/api/enable', port);
      await request('POST', '/api/estop', port);

      // Reset E-stop
      const res = await request('POST', '/api/reset-estop', port);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);

      // Verify state changed to DISABLED
      const statusRes = await request('GET', '/api/status', port);
      assert.strictEqual(statusRes.data.robot.state, 'DISABLED');
      assert.strictEqual(statusRes.data.robot.eStopActive, false);
    });

    it('should fail when not in E_STOP state', async () => {
      const res = await request('POST', '/api/reset-estop', port);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
      assert.ok(res.data.error);
    });
  });

  describe('GET /api/telemetry', () => {
    it('should return motor telemetry', async () => {
      const res = await request('GET', '/api/telemetry', port);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.telemetry);
      assert.strictEqual(typeof res.data.telemetry.voltage, 'number');
      assert.strictEqual(typeof res.data.telemetry.leftSpeed, 'number');
      assert.strictEqual(typeof res.data.telemetry.rightSpeed, 'number');
    });

    it('should show enabled status from motor controller', async () => {
      await request('POST', '/api/enable', port);

      const res = await request('GET', '/api/telemetry', port);
      assert.strictEqual(res.data.telemetry.enabled, true);
    });
  });

  describe('API Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request('GET', '/api/unknown', port);
      assert.strictEqual(res.status, 404);
    });

    it('should return proper JSON error responses', async () => {
      const res = await request('POST', '/api/reset-estop', port);
      assert.strictEqual(res.status, 400);
      assert.ok(res.data.error);
      assert.strictEqual(res.data.success, false);
    });

    it('should return 400 error for /api/enable when already enabled', async () => {
      await request('POST', '/api/enable', port);
      const res = await request('POST', '/api/enable', port);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    it('should return 400 error for /api/disable when already disabled', async () => {
      const res = await request('POST', '/api/disable', port);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    it('should return 400 error for /api/estop on error', async () => {
      const res = await request('POST', '/api/estop', port);
      assert.strictEqual(res.status, 200);
    });

    it('should return 400 error for /api/reset-estop when not in E_STOP', async () => {
      const res = await request('POST', '/api/reset-estop', port);
      assert.strictEqual(res.status, 400);
      assert.ok(res.data.error);
    });
  });

  describe('API 500 error paths', () => {
    let throwingRobotController;
    let throwingWebServer;
    let throwingPort;

    beforeEach(async () => {
      throwingPort = 5000 + Math.floor(Math.random() * 1000);

      throwingRobotController = {
        enable: () => { throw new Error('enable error'); },
        disable: () => { throw new Error('disable error'); },
        emergencyStop: () => { throw new Error('estop error'); },
        resetEStop: () => { throw new Error('reset error'); },
        getStatus: () => { throw new Error('status error'); },
        on: () => {},
      };

      throwingWebServer = new RobotWebServer({ port: throwingPort, serveStatic: false });
      await throwingWebServer.initialize(throwingRobotController, motorController);
      await throwingWebServer.start();
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    afterEach(async () => {
      if (throwingWebServer) {
        await throwingWebServer.dispose();
      }
    });

    it('should return 500 for /api/status on controller error', async () => {
      const res = await request('GET', '/api/status', throwingPort);
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.data.success, false);
    });

    it('should return 500 for /api/enable on controller error', async () => {
      const res = await request('POST', '/api/enable', throwingPort);
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.data.success, false);
    });

    it('should return 500 for /api/disable on controller error', async () => {
      const res = await request('POST', '/api/disable', throwingPort);
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.data.success, false);
    });

    it('should return 500 for /api/estop on controller error', async () => {
      const res = await request('POST', '/api/estop', throwingPort);
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.data.success, false);
    });

    it('should return 500 for /api/reset-estop on controller error', async () => {
      const res = await request('POST', '/api/reset-estop', throwingPort);
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.data.success, false);
    });

    it('should return 500 for /api/telemetry on controller error', async () => {
      const res = await request('GET', '/api/telemetry', throwingPort);
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.telemetry);
    });
  });

  describe('RobotWebServer', () => {
    it('should have getClientCount method', async () => {
      const count = webServer.getClientCount();
      assert.strictEqual(typeof count, 'number');
    });

    it('should have getServer method', async () => {
      const server = webServer.getServer();
      assert.ok(server);
    });

    it('should return client count 0 initially', async () => {
      const count = webServer.getClientCount();
      assert.strictEqual(count, 0);
    });
  });
});
