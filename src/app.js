import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { startTelemetry, shutdownTelemetry } from './observability/otel.js';
import { logger } from './observability/logger.js';
import { recordRequest } from './observability/metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ---- static Preact build ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- request middleware ----
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    recordRequest(req.method, req.route?.path || req.url, res.statusCode, duration);

    logger.info({
      method: req.method,
      path: req.url,
      status: res.statusCode,
      duration
    }, 'http request');
  });

  next();
});

// ---- example route ----
app.get('/api/test', async (req, res) => {
  logger.info('handling /api/test');
  await new Promise(r => setTimeout(r, 100));
  res.json({ ok: true });
});

// ---- start server ----
async function start() {
  await startTelemetry();

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    logger.info({ port }, 'server started');
  });
}

start();

// ---- graceful shutdown ----
async function shutdown() {
  logger.info('shutting down...');
  await shutdownTelemetry();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);