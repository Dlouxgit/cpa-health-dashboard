import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, getProjectRoot } from './lib/config.mjs';
import { openDatabase } from './lib/db.mjs';
import { CPAClient } from './lib/cpa-client.mjs';
import { startCollector } from './lib/collector.mjs';
import { buildDashboard } from './lib/health.mjs';
import { refreshMappings } from './lib/mappings.mjs';
import { nowMs, safeString } from './lib/utils.mjs';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const client = new CPAClient(config);
const state = {
  startedAtMs: nowMs(),
  lastPollAtMs: null,
  lastPollCount: 0,
  lastPollError: '',
  totalInserted: 0,
  collectorRunning: false,
  lastMappingRefreshMs: null,
  lastMappingRefreshError: '',
  mappingCount: 0
};

await refreshMappings(client, db, state).catch((error) => {
  state.lastMappingRefreshError = error.message || String(error);
});
const collector = startCollector({ client, db, state, config });
setInterval(() => {
  refreshMappings(client, db, state).catch((error) => {
    state.lastMappingRefreshError = error.message || String(error);
  });
}, config.mappingRefreshMs).unref();

const projectRoot = getProjectRoot();
const publicDir = path.join(projectRoot, 'public');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === '/api/dashboard') {
      const search = url.searchParams.get('search') || '';
      const window = url.searchParams.get('window') || '1h';
      const data = buildDashboard(db, state, {
        search,
        window,
        recentWindowMinutes: config.recentWindowMinutes
      });
      return sendJson(res, 200, data);
    }
    if (url.pathname === '/api/status') {
      return sendJson(res, 200, {
        startedAtMs: state.startedAtMs,
        config: {
          port: config.port,
          cpaBaseUrl: config.cpaBaseUrl,
          dbPath: config.dbPath,
          pollIntervalMs: config.pollIntervalMs,
          queueBatchSize: config.queueBatchSize
        },
        collector: {
          running: state.collectorRunning,
          lastPollAtMs: state.lastPollAtMs,
          lastPollCount: state.lastPollCount,
          lastPollError: state.lastPollError,
          totalInserted: state.totalInserted
        },
        mappings: {
          lastRefreshAtMs: state.lastMappingRefreshMs,
          lastError: state.lastMappingRefreshError,
          count: state.mappingCount
        },
        db: db.getCounts()
      });
    }
    if (url.pathname === '/api/poll-now' && req.method === 'POST') {
      await collector.pollOnce();
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname === '/api/refresh-mappings' && req.method === 'POST') {
      await refreshMappings(client, db, state);
      return sendJson(res, 200, { ok: true, count: state.mappingCount });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return sendFile(res, path.join(publicDir, 'index.html'), 'text/html; charset=utf-8');
    }
    if (url.pathname.startsWith('/assets/')) {
      const filePath = path.join(publicDir, url.pathname.replace(/^\//, ''));
      return sendFile(res, filePath, contentType(filePath));
    }
    return sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || String(error) });
  }
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`CPA Health Dashboard listening on http://127.0.0.1:${config.port}`);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  collector.stop();
  server.close(() => process.exit(0));
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function sendFile(res, filePath, type) {
  if (!fs.existsSync(filePath)) {
    return sendJson(res, 404, { error: 'file not found' });
  }
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  stream.pipe(res);
}

function contentType(filePath) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  return 'application/octet-stream';
}
