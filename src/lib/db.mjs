import { DatabaseSync } from 'node:sqlite';
import { nowMs } from './utils.mjs';

function runTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw error;
  }
}

export function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    pragma journal_mode = WAL;
    pragma synchronous = NORMAL;
    create table if not exists auth_mappings (
      auth_index text primary key,
      display_name text not null,
      vendor_name text not null,
      provider_type text,
      auth_kind text not null,
      base_url text,
      raw_name text,
      account_email text,
      account_label text,
      meta_json text,
      updated_at_ms integer not null
    );
    create table if not exists events (
      id integer primary key autoincrement,
      event_hash text not null unique,
      timestamp_ms integer not null,
      request_id text,
      provider text,
      model text,
      alias text,
      requested_model text,
      resolved_model text,
      endpoint text,
      auth_type text,
      auth_index text,
      source text,
      api_key_hash text,
      account_snapshot text,
      auth_label_snapshot text,
      auth_file_snapshot text,
      auth_provider_snapshot text,
      reasoning_effort text,
      service_tier text,
      failed integer not null default 0,
      status_code integer,
      fail_body text,
      latency_ms integer,
      ttft_ms integer,
      input_tokens integer not null default 0,
      output_tokens integer not null default 0,
      reasoning_tokens integer not null default 0,
      cached_tokens integer not null default 0,
      cache_read_tokens integer not null default 0,
      cache_creation_tokens integer not null default 0,
      total_tokens integer not null default 0,
      raw_json text,
      imported_from text,
      created_at_ms integer not null
    );
    create index if not exists idx_events_timestamp on events(timestamp_ms desc);
    create index if not exists idx_events_auth_index on events(auth_index);
    create index if not exists idx_events_provider on events(provider);
    create index if not exists idx_events_api_key_hash on events(api_key_hash);
  `);

  const statements = {
    upsertMapping: db.prepare(`
      insert into auth_mappings (
        auth_index, display_name, vendor_name, provider_type, auth_kind,
        base_url, raw_name, account_email, account_label, meta_json, updated_at_ms
      ) values (
        @auth_index, @display_name, @vendor_name, @provider_type, @auth_kind,
        @base_url, @raw_name, @account_email, @account_label, @meta_json, @updated_at_ms
      )
      on conflict(auth_index) do update set
        display_name=excluded.display_name,
        vendor_name=excluded.vendor_name,
        provider_type=excluded.provider_type,
        auth_kind=excluded.auth_kind,
        base_url=excluded.base_url,
        raw_name=excluded.raw_name,
        account_email=excluded.account_email,
        account_label=excluded.account_label,
        meta_json=excluded.meta_json,
        updated_at_ms=excluded.updated_at_ms
    `),
    insertEvent: db.prepare(`
      insert or ignore into events (
        event_hash, timestamp_ms, request_id, provider, model, alias,
        requested_model, resolved_model, endpoint, auth_type, auth_index,
        source, api_key_hash, account_snapshot, auth_label_snapshot,
        auth_file_snapshot, auth_provider_snapshot, reasoning_effort,
        service_tier, failed, status_code, fail_body, latency_ms, ttft_ms,
        input_tokens, output_tokens, reasoning_tokens, cached_tokens,
        cache_read_tokens, cache_creation_tokens, total_tokens, raw_json,
        imported_from, created_at_ms
      ) values (
        @event_hash, @timestamp_ms, @request_id, @provider, @model, @alias,
        @requested_model, @resolved_model, @endpoint, @auth_type, @auth_index,
        @source, @api_key_hash, @account_snapshot, @auth_label_snapshot,
        @auth_file_snapshot, @auth_provider_snapshot, @reasoning_effort,
        @service_tier, @failed, @status_code, @fail_body, @latency_ms, @ttft_ms,
        @input_tokens, @output_tokens, @reasoning_tokens, @cached_tokens,
        @cache_read_tokens, @cache_creation_tokens, @total_tokens, @raw_json,
        @imported_from, @created_at_ms
      )
    `),
    selectMappings: db.prepare(`select * from auth_mappings`),
    selectEventsSince: db.prepare(`select * from events where timestamp_ms >= ? order by timestamp_ms desc`),
    selectAllEvents: db.prepare(`select * from events order by timestamp_ms desc`),
    selectRecentEvents: db.prepare(`select * from events order by timestamp_ms desc limit ?`),
    countEvents: db.prepare(`select count(*) as count from events`),
    latestEvent: db.prepare(`select max(timestamp_ms) as timestamp_ms from events`)
  };

  return {
    db,
    statements,
    upsertMappings(mappings) {
      return runTransaction(db, () => {
        for (const row of mappings) {
          statements.upsertMapping.run(row);
        }
        return mappings.length;
      });
    },
    insertEvents(events) {
      return runTransaction(db, () => {
        let inserted = 0;
        for (const row of events) {
          const result = statements.insertEvent.run({ created_at_ms: nowMs(), imported_from: null, ...row });
          inserted += Number(result?.changes || 0);
        }
        return inserted;
      });
    },
    insertEvent(row) {
      const result = statements.insertEvent.run({ created_at_ms: nowMs(), imported_from: null, ...row });
      return Number(result?.changes || 0);
    },
    loadMappings() {
      return statements.selectMappings.all();
    },
    loadEvents(windowMs = null) {
      if (windowMs == null) return statements.selectAllEvents.all();
      return statements.selectEventsSince.all(nowMs() - windowMs);
    },
    loadRecentEvents(limit = 100) {
      return statements.selectRecentEvents.all(limit);
    },
    getCounts() {
      return {
        events: statements.countEvents.get().count,
        latestTimestampMs: statements.latestEvent.get().timestamp_ms || null
      };
    }
  };
}
