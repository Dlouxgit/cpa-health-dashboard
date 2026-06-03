import { fallbackResolvedNames } from './mappings.mjs';
import { clamp, nowMs, p95, safeString, shortError } from './utils.mjs';

const WINDOWS = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  all: null
};

function groupStatus(summary, recentWindowMs, currentTimeMs) {
  const recentRows = summary.rows.filter((row) => row.timestamp_ms >= currentTimeMs - recentWindowMs);
  const recentTotal = recentRows.length;
  const recentSuccess = recentRows.filter((row) => !row.failed).length;
  const recentRate = recentTotal ? recentSuccess / recentTotal : 0;
  const consecutiveFailures = summary.consecutiveFailures;

  let status = 'idle';
  if (summary.total > 0) status = 'healthy';

  const noRecentSuccess = recentTotal >= 2 && recentSuccess === 0;
  const sustainedHardFailure = consecutiveFailures >= 3;

  if (summary.total > 0 && (noRecentSuccess || sustainedHardFailure)) {
    status = 'critical';
  } else if (summary.total > 0 && (summary.lastFailed || consecutiveFailures >= 1 || (recentTotal >= 3 && recentRate < 0.6))) {
    status = 'warning';
  }

  const baseScore = summary.total ? Math.round((summary.success / summary.total) * 100) : 0;
  let score = baseScore;
  if (summary.lastFailed) score -= 8;
  score -= consecutiveFailures * 6;
  if (recentTotal >= 3) score = Math.min(score, Math.round(recentRate * 100));
  score = clamp(score, 0, 100);

  return {
    status,
    score,
    recentTotal,
    recentSuccess,
    recentFailure: recentTotal - recentSuccess,
    recentRate: recentTotal ? Number((recentRate * 100).toFixed(1)) : null
  };
}

function summarizeRows(rows, recentWindowMs, currentTimeMs) {
  const sorted = [...rows].sort((a, b) => b.timestamp_ms - a.timestamp_ms);
  const latencies = sorted.map((row) => Number(row.latency_ms || 0)).filter((value) => value > 0);
  let consecutiveFailures = 0;
  for (const row of sorted) {
    if (row.failed) consecutiveFailures += 1;
    else break;
  }
  const success = sorted.filter((row) => !row.failed).length;
  const failure = sorted.length - success;
  const inputTokens = sorted.reduce((sum, row) => sum + Number(row.input_tokens || 0), 0);
  const outputTokens = sorted.reduce((sum, row) => sum + Number(row.output_tokens || 0), 0);
  const reasoningTokens = sorted.reduce((sum, row) => sum + Number(row.reasoning_tokens || 0), 0);
  const cachedTokens = sorted.reduce((sum, row) => sum + Number(row.cached_tokens || 0), 0);
  const totalTokens = sorted.reduce((sum, row) => sum + Number(row.total_tokens || 0), 0);
  const lastRow = sorted[0] || null;
  const lastSuccess = sorted.find((row) => !row.failed) || null;
  const lastFailure = sorted.find((row) => row.failed) || null;
  const summary = {
    rows: sorted,
    total: sorted.length,
    success,
    failure,
    successRate: sorted.length ? Number(((success / sorted.length) * 100).toFixed(1)) : 0,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    totalTokens,
    avgTokensPerRequest: sorted.length ? Number((totalTokens / sorted.length).toFixed(1)) : 0,
    avgLatencyMs: latencies.length ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1)) : null,
    p95LatencyMs: p95(latencies),
    consecutiveFailures,
    lastSeenAtMs: lastRow?.timestamp_ms || null,
    lastSuccessAtMs: lastSuccess?.timestamp_ms || null,
    lastFailureAtMs: lastFailure?.timestamp_ms || null,
    lastFailed: Boolean(lastRow?.failed),
    lastError: lastFailure ? shortError(lastFailure.fail_body || `${lastFailure.status_code || 500}`) : '',
    lastErrorFull: lastFailure ? (lastFailure.fail_body || `${lastFailure.status_code || 500}`) : '',
    lastStatusCode: lastFailure?.status_code || null,
    models: [...new Set(sorted.map((row) => safeString(row.requested_model || row.model)).filter(Boolean))].slice(0, 8)
  };
  return { ...summary, ...groupStatus(summary, recentWindowMs, currentTimeMs) };
}

function buildGroups(events, keyBuilder, labelBuilder, recentWindowMs, currentTimeMs) {
  const map = new Map();
  for (const event of events) {
    const key = keyBuilder(event);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(event);
  }
  return [...map.entries()].map(([key, rows]) => {
    const summary = summarizeRows(rows, recentWindowMs, currentTimeMs);
    const { rows: _rows, ...compactSummary } = summary;
    return {
      key,
      ...labelBuilder(rows[0], key),
      ...compactSummary
    };
  }).sort((a, b) => {
    if ((b.totalTokens || 0) !== (a.totalTokens || 0)) {
      return (b.totalTokens || 0) - (a.totalTokens || 0);
    }
    if ((b.score || 0) !== (a.score || 0)) {
      return (b.score || 0) - (a.score || 0);
    }
    const severityOrder = { healthy: 0, warning: 1, critical: 2, idle: 3 };
    if (severityOrder[a.status] !== severityOrder[b.status]) {
      return severityOrder[a.status] - severityOrder[b.status];
    }
    if ((b.avgTokensPerRequest || 0) !== (a.avgTokensPerRequest || 0)) {
      return (b.avgTokensPerRequest || 0) - (a.avgTokensPerRequest || 0);
    }
    return (b.lastSeenAtMs || 0) - (a.lastSeenAtMs || 0);
  });
}

function looksLikeRealAccount(row) {
  const candidates = [
    row.account_email,
    row.account_snapshot,
    row.auth_label_snapshot,
    row.account_name
  ];
  return candidates.some((value) => safeString(value).includes('@'));
}

export function buildDashboard(db, state, options = {}) {
  const now = nowMs();
  const recentWindowMs = (options.recentWindowMinutes || 15) * 60 * 1000;
  const windowKey = Object.hasOwn(WINDOWS, options.window) ? options.window : '1h';
  const windowMs = WINDOWS[windowKey];
  const search = safeString(options.search).toLowerCase();
  const mappingRows = db.loadMappings();
  const mappingMap = new Map(mappingRows.map((row) => [safeString(row.auth_index), row]));
  const rawEvents = db.loadEvents(windowMs);
  const events = rawEvents.map((row) => {
    const mapping = mappingMap.get(safeString(row.auth_index)) || null;
    const resolved = fallbackResolvedNames(row, mapping);
    return {
      ...row,
      channel_name: resolved.channelName,
      vendor_name: resolved.vendorName,
      account_name: resolved.accountName,
      account_email: resolved.accountEmail
    };
  }).filter((row) => {
    if (!search) return true;
    const haystack = [row.channel_name, row.vendor_name, row.account_name, row.model, row.endpoint, row.fail_body]
      .map((value) => safeString(value).toLowerCase())
      .join(' ');
    return haystack.includes(search);
  });

  const vendors = buildGroups(
    events,
    (row) => row.vendor_name,
    (row, key) => ({ name: key, providerType: row.provider || row.auth_provider_snapshot || 'unknown' }),
    recentWindowMs,
    now
  );
  const channels = buildGroups(
    events,
    (row) => row.channel_name,
    (row, key) => ({
      name: key,
      vendorName: row.vendor_name,
      providerType: row.provider || row.auth_provider_snapshot || 'unknown',
      authIndex: row.auth_index,
      accountEmail: row.account_email || ''
    }),
    recentWindowMs,
    now
  );
  const accountEvents = events.filter(looksLikeRealAccount);
  const accounts = buildGroups(
    accountEvents,
    (row) => row.account_name,
    (row, key) => ({
      name: key,
      email: row.account_email || '',
      channelName: row.channel_name,
      providerType: row.provider || row.auth_provider_snapshot || 'unknown'
    }),
    recentWindowMs,
    now
  );

  const recentEvents = events.slice(0, 120).map((row) => ({
    timestampMs: row.timestamp_ms,
    channelName: row.channel_name,
    vendorName: row.vendor_name,
    accountName: row.account_name,
    model: row.requested_model || row.model,
    endpoint: row.endpoint,
    failed: Boolean(row.failed),
    statusCode: row.status_code,
    latencyMs: row.latency_ms,
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    reasoningTokens: Number(row.reasoning_tokens || 0),
    cachedTokens: Number(row.cached_tokens || 0),
    totalTokens: Number(row.total_tokens || 0),
    error: shortError(row.fail_body || ''),
    errorFull: row.fail_body || '',
    authIndex: row.auth_index
  }));

  const tokenTotals = events.reduce((acc, row) => {
    acc.inputTokens += Number(row.input_tokens || 0);
    acc.outputTokens += Number(row.output_tokens || 0);
    acc.reasoningTokens += Number(row.reasoning_tokens || 0);
    acc.cachedTokens += Number(row.cached_tokens || 0);
    acc.totalTokens += Number(row.total_tokens || 0);
    return acc;
  }, {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    totalTokens: 0
  });

  const dbCounts = db.getCounts();
  const overview = {
    window: windowKey,
    totalEvents: events.length,
    storedEvents: dbCounts.events,
    lastEventAtMs: dbCounts.latestTimestampMs,
    collector: {
      lastPollAtMs: state.lastPollAtMs || null,
      lastPollCount: state.lastPollCount || 0,
      lastPollError: state.lastPollError || '',
      totalInserted: state.totalInserted || 0,
      mappingCount: state.mappingCount || mappingRows.length,
      lastMappingRefreshMs: state.lastMappingRefreshMs || null,
      lastMappingRefreshError: state.lastMappingRefreshError || ''
    },
    tokens: tokenTotals,
    healthCounts: {
      vendors: countStatuses(vendors),
      channels: countStatuses(channels),
      accounts: countStatuses(accounts)
    }
  };

  return { overview, vendors, channels, accounts, recentEvents };
}

function countStatuses(rows) {
  return rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, { healthy: 0, warning: 0, critical: 0, idle: 0 });
}
