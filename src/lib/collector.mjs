import { nowMs, parseTimestampMs, safeInteger, safeString, sha256, shortError, toObject } from './utils.mjs';

function sanitizeSource(source, apiKey) {
  const raw = safeString(source);
  if (!raw) return '';
  if (apiKey && raw === apiKey) return `api-key:${sha256(apiKey).slice(0, 12)}`;
  if (!raw.includes('@') && (/^(sk-|ah-|nb_|bmJf|AIza|ya29\.|eyJ)/i.test(raw) || raw.length > 48)) {
    return `token:${sha256(raw).slice(0, 12)}`;
  }
  return raw;
}

function normalizeEventPayload(raw) {
  const payload = toObject(raw);
  const tokens = toObject(payload.tokens);
  const fail = toObject(payload.fail);
  const timestampMs = parseTimestampMs(payload.timestamp);
  const apiKey = safeString(payload.api_key);
  const sanitized = { ...payload };
  if (sanitized.api_key) sanitized.api_key = '[redacted]';
  const requestedModel = safeString(payload.alias) || safeString(payload.model);
  const resolvedModel = safeString(payload.model) || requestedModel;
  return {
    event_hash: sha256(JSON.stringify(sanitized)),
    timestamp_ms: timestampMs,
    request_id: safeString(payload.request_id),
    provider: safeString(payload.provider) || 'unknown',
    model: resolvedModel,
    alias: safeString(payload.alias),
    requested_model: requestedModel,
    resolved_model: resolvedModel,
    endpoint: safeString(payload.endpoint),
    auth_type: safeString(payload.auth_type),
    auth_index: safeString(payload.auth_index),
    source: sanitizeSource(payload.source, apiKey),
    api_key_hash: apiKey ? sha256(apiKey) : '',
    account_snapshot: '',
    auth_label_snapshot: '',
    auth_file_snapshot: '',
    auth_provider_snapshot: '',
    reasoning_effort: safeString(payload.reasoning_effort),
    service_tier: safeString(payload.service_tier),
    failed: payload.failed ? 1 : 0,
    status_code: safeInteger(fail.status_code, payload.failed ? 500 : 200),
    fail_body: safeString(fail.body),
    latency_ms: safeInteger(payload.latency_ms),
    ttft_ms: safeInteger(payload.ttft_ms),
    input_tokens: safeInteger(tokens.input_tokens),
    output_tokens: safeInteger(tokens.output_tokens),
    reasoning_tokens: safeInteger(tokens.reasoning_tokens),
    cached_tokens: safeInteger(tokens.cached_tokens),
    cache_read_tokens: safeInteger(tokens.cache_read_tokens),
    cache_creation_tokens: safeInteger(tokens.cache_creation_tokens),
    total_tokens: safeInteger(tokens.total_tokens),
    raw_json: JSON.stringify(sanitized),
    imported_from: null,
    created_at_ms: nowMs()
  };
}

export function startCollector({ client, db, state, config }) {
  let timer = null;
  let running = false;

  async function pollOnce() {
    if (running) return;
    running = true;
    state.collectorRunning = true;
    try {
      const items = await client.getUsageQueue(config.queueBatchSize);
      state.lastPollAtMs = nowMs();
      state.lastPollError = '';
      state.lastPollCount = Array.isArray(items) ? items.length : 0;
      if (items.length > 0) {
        const normalized = items.map(normalizeEventPayload);
        const inserted = db.insertEvents(normalized);
        state.totalInserted += inserted;
      }
    } catch (error) {
      state.lastPollAtMs = nowMs();
      state.lastPollError = shortError(error?.message || String(error), 240);
    } finally {
      running = false;
      state.collectorRunning = false;
    }
  }

  timer = setInterval(pollOnce, config.pollIntervalMs);
  pollOnce();

  return {
    async pollOnce() {
      await pollOnce();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
