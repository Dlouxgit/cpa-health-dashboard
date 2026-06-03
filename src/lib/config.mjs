import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, readJsonFile, safeInteger, safeString } from './utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

export function getProjectRoot() {
  return projectRoot;
}

export function loadConfig() {
  const configPath = path.join(projectRoot, 'config.local.json');
  const raw = readJsonFile(configPath, {});
  const port = safeInteger(process.env.PORT || raw.port, 18317);
  const cpaBaseUrl = safeString(process.env.CPA_BASE_URL || raw.cpaBaseUrl || 'http://127.0.0.1:8317').replace(/\/$/, '');
  const managementKey = safeString(process.env.CPA_MANAGEMENT_KEY || raw.managementKey);
  const dbPathRaw = safeString(process.env.DB_PATH || raw.dbPath || './data/health-dashboard.sqlite');
  const dbPath = path.isAbsolute(dbPathRaw) ? dbPathRaw : path.join(projectRoot, dbPathRaw);
  const pollIntervalMs = safeInteger(process.env.POLL_INTERVAL_MS || raw.pollIntervalMs, 1000);
  const queueBatchSize = safeInteger(process.env.QUEUE_BATCH_SIZE || raw.queueBatchSize, 100);
  const mappingRefreshMs = safeInteger(process.env.MAPPING_REFRESH_MS || raw.mappingRefreshMs, 300000);
  const recentWindowMinutes = safeInteger(process.env.RECENT_WINDOW_MINUTES || raw.recentWindowMinutes, 15);
  ensureDir(path.dirname(dbPath));
  return {
    projectRoot,
    configPath,
    port,
    cpaBaseUrl,
    managementKey,
    dbPath,
    pollIntervalMs,
    queueBatchSize,
    mappingRefreshMs,
    recentWindowMinutes
  };
}
