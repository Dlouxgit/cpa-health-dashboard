import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../src/lib/config.mjs";
import { openDatabase } from "../src/lib/db.mjs";
import { nowMs, safeInteger, safeString, sha256, shortError } from "../src/lib/utils.mjs";

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("usage: node scripts/import-from-cpa-manager.mjs /path/to/usage.sqlite");
  process.exit(1);
}
if (!fs.existsSync(sourcePath)) {
  console.error(`source sqlite not found: ${sourcePath}`);
  process.exit(1);
}

const config = loadConfig();
const target = openDatabase(config.dbPath);
const source = new DatabaseSync(sourcePath, { readonly: true });
const rows = source.prepare(`
  select id, event_hash, timestamp_ms, request_id, provider, model, requested_model,
         resolved_model, endpoint, auth_type, auth_index, source, api_key_hash,
         account_snapshot, auth_label_snapshot, auth_file_snapshot, auth_provider_snapshot,
         input_tokens, output_tokens, reasoning_tokens, cached_tokens, cache_tokens,
         total_tokens, latency_ms, failed, raw_json
  from usage_events
  order by id asc
`).all();

function parseRaw(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const events = rows.map((row) => {
  const raw = parseRaw(row.raw_json);
  const fail = raw && raw.fail && typeof raw.fail === 'object' ? raw.fail : {};
  const sanitizedRaw = raw && typeof raw === 'object' ? { ...raw, api_key: raw.api_key ? '[redacted]' : raw.api_key } : raw;
  return {
    event_hash: `cpam:${safeString(row.event_hash) || row.id}`,
    timestamp_ms: safeInteger(row.timestamp_ms, nowMs()),
    request_id: safeString(row.request_id),
    provider: safeString(row.provider),
    model: safeString(row.model),
    alias: safeString(raw.alias),
    requested_model: safeString(row.requested_model) || safeString(raw.alias) || safeString(row.model),
    resolved_model: safeString(row.resolved_model) || safeString(row.model),
    endpoint: safeString(row.endpoint),
    auth_type: safeString(row.auth_type),
    auth_index: safeString(row.auth_index),
    source: safeString(row.source),
    api_key_hash: safeString(row.api_key_hash),
    account_snapshot: safeString(row.account_snapshot),
    auth_label_snapshot: safeString(row.auth_label_snapshot),
    auth_file_snapshot: safeString(row.auth_file_snapshot),
    auth_provider_snapshot: safeString(row.auth_provider_snapshot),
    reasoning_effort: safeString(raw.reasoning_effort),
    service_tier: safeString(raw.service_tier),
    failed: safeInteger(row.failed),
    status_code: safeInteger(fail.status_code, safeInteger(row.failed) ? 500 : 200),
    fail_body: shortError(safeString(fail.body), 500),
    latency_ms: safeInteger(row.latency_ms),
    ttft_ms: safeInteger(raw.ttft_ms),
    input_tokens: safeInteger(row.input_tokens),
    output_tokens: safeInteger(row.output_tokens),
    reasoning_tokens: safeInteger(row.reasoning_tokens),
    cached_tokens: safeInteger(row.cached_tokens),
    cache_read_tokens: safeInteger(raw.tokens && raw.tokens.cache_read_tokens),
    cache_creation_tokens: safeInteger(raw.tokens && raw.tokens.cache_creation_tokens),
    total_tokens: safeInteger(row.total_tokens),
    raw_json: JSON.stringify(sanitizedRaw || {}),
    imported_from: 'cpa-manager',
    created_at_ms: nowMs()
  };
});
const inserted = target.insertEvents(events);
console.log(JSON.stringify({ sourcePath, totalRows: rows.length, inserted }, null, 2));
