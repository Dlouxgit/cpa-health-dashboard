import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function nowMs() {
  return Date.now();
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

export function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export function safeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function safeInteger(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function hostnameLabel(baseUrl, fallback = 'unknown') {
  const raw = safeString(baseUrl);
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    const host = parsed.host.replace(/^www\./i, '');
    const pathname = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : '';
    return `${host}${pathname}`;
  } catch {
    return raw;
  }
}

export function uniqueLabelMap(items, baseNameGetter, stableSortGetter) {
  const sorted = [...items].sort((a, b) => {
    const aKey = stableSortGetter(a);
    const bKey = stableSortGetter(b);
    return aKey.localeCompare(bKey);
  });
  const counts = new Map();
  const out = new Map();
  for (const item of sorted) {
    const rawName = safeString(baseNameGetter(item)) || 'unknown';
    const next = (counts.get(rawName) || 0) + 1;
    counts.set(rawName, next);
    out.set(item, next === 1 ? rawName : `${rawName} ${next}`);
  }
  return out;
}

export function shortError(body, maxLength = 120) {
  const text = safeString(body).replace(/\s+/g, ' ');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function formatTimeAgo(timestampMs) {
  if (!timestampMs) return '-';
  const delta = Math.max(0, Date.now() - timestampMs);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function parseTimestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = safeString(value);
  if (!text) return nowMs();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : nowMs();
}

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeSearch(value) {
  return safeString(value).toLowerCase();
}

export function p95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[idx];
}
