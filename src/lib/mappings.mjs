import { CPAClient } from './cpa-client.mjs';
import { hostnameLabel, nowMs, safeString, shortError, uniqueLabelMap } from './utils.mjs';

function buildApiDescriptor(providerType, entry, explicitName = '') {
  const authIndex = CPAClient.authIndex(entry);
  if (!authIndex) return null;
  const baseUrl = safeString(entry['base-url'] ?? entry.baseUrl);
  const rawName = safeString(explicitName) || hostnameLabel(baseUrl, providerType);
  return {
    authIndex,
    providerType,
    authKind: 'api_key_channel',
    baseUrl,
    rawName,
    meta: entry
  };
}

function authFileDisplayName(file) {
  return safeString(file.email) || safeString(file.account) || safeString(file.id) || 'unknown-account';
}

function buildAuthFileDescriptor(file) {
  const authIndex = safeString(file.auth_index ?? file.authIndex ?? file['auth-index']);
  if (!authIndex) return null;
  const displayName = authFileDisplayName(file);
  return {
    authIndex,
    providerType: safeString(file.provider) || safeString(file.account_type) || 'auth-file',
    authKind: 'auth_file',
    baseUrl: '',
    rawName: displayName,
    accountEmail: safeString(file.email),
    accountLabel: displayName,
    meta: file
  };
}

function buildApiChannelMappings(descriptors) {
  const labelMap = uniqueLabelMap(
    descriptors,
    (item) => item.rawName,
    (item) => `${item.rawName}|${item.baseUrl}|${item.providerType}|${item.authIndex}`
  );
  return descriptors.map((descriptor) => ({
    auth_index: descriptor.authIndex,
    display_name: labelMap.get(descriptor) || descriptor.rawName,
    vendor_name: descriptor.rawName,
    provider_type: descriptor.providerType,
    auth_kind: descriptor.authKind,
    base_url: descriptor.baseUrl,
    raw_name: descriptor.rawName,
    account_email: '',
    account_label: labelMap.get(descriptor) || descriptor.rawName,
    meta_json: JSON.stringify(descriptor.meta ?? {}),
    updated_at_ms: nowMs()
  }));
}

function buildAuthFileMappings(descriptors) {
  const labelMap = uniqueLabelMap(
    descriptors,
    (item) => item.rawName,
    (item) => `${item.rawName}|${item.providerType}|${item.authIndex}`
  );
  return descriptors.map((descriptor) => ({
    auth_index: descriptor.authIndex,
    display_name: labelMap.get(descriptor) || descriptor.rawName,
    vendor_name: safeString(descriptor.providerType) || 'auth-file',
    provider_type: descriptor.providerType,
    auth_kind: descriptor.authKind,
    base_url: '',
    raw_name: descriptor.rawName,
    account_email: descriptor.accountEmail || '',
    account_label: descriptor.accountLabel || labelMap.get(descriptor) || descriptor.rawName,
    meta_json: JSON.stringify(descriptor.meta ?? {}),
    updated_at_ms: nowMs()
  }));
}

export async function refreshMappings(client, db, state) {
  const payload = await client.getAllMappingsPayload();
  const apiDescriptors = [];

  for (const entry of payload.codex) {
    const descriptor = buildApiDescriptor('codex', entry);
    if (descriptor) apiDescriptors.push(descriptor);
  }
  for (const entry of payload.claude) {
    const descriptor = buildApiDescriptor('claude', entry);
    if (descriptor) apiDescriptors.push(descriptor);
  }
  for (const entry of payload.gemini) {
    const descriptor = buildApiDescriptor('gemini', entry);
    if (descriptor) apiDescriptors.push(descriptor);
  }
  for (const entry of payload.vertex) {
    const descriptor = buildApiDescriptor('vertex', entry);
    if (descriptor) apiDescriptors.push(descriptor);
  }
  for (const entry of payload.openai) {
    const baseName = safeString(entry.name) || hostnameLabel(entry['base-url'] ?? entry.baseUrl, 'openai-compatibility');
    const apiKeyEntries = Array.isArray(entry['api-key-entries']) ? entry['api-key-entries'] : [];
    if (apiKeyEntries.length === 0) {
      const descriptor = buildApiDescriptor('openai-compatibility', entry, baseName);
      if (descriptor) apiDescriptors.push(descriptor);
      continue;
    }
    for (const apiKeyEntry of apiKeyEntries) {
      const merged = {
        ...apiKeyEntry,
        'base-url': safeString(entry['base-url'] ?? entry.baseUrl)
      };
      const descriptor = buildApiDescriptor('openai-compatibility', merged, baseName);
      if (descriptor) apiDescriptors.push(descriptor);
    }
  }

  const authFileDescriptors = [];
  for (const entry of payload.authFiles) {
    const descriptor = buildAuthFileDescriptor(entry);
    if (descriptor) authFileDescriptors.push(descriptor);
  }

  const mappings = [
    ...buildApiChannelMappings(apiDescriptors),
    ...buildAuthFileMappings(authFileDescriptors)
  ];

  db.upsertMappings(mappings);
  state.lastMappingRefreshMs = nowMs();
  state.lastMappingRefreshError = '';
  state.mappingCount = mappings.length;
  return mappings;
}

function safeFallbackSource(value) {
  const raw = safeString(value);
  if (!raw) return '';
  if (raw.includes('@')) return raw;
  if (raw.includes('...')) return raw;
  return '';
}

export function fallbackResolvedNames(eventRow, mappingRow) {
  const authIndex = safeString(eventRow.auth_index);
  const sourceFallback = safeFallbackSource(eventRow.source);
  const providerFallback = safeString(eventRow.provider) || 'unknown';
  const channelName = safeString(mappingRow?.display_name)
    || safeString(eventRow.account_snapshot)
    || safeString(eventRow.auth_label_snapshot)
    || sourceFallback
    || (authIndex ? `${providerFallback}:${authIndex.slice(0, 8)}` : providerFallback);
  const vendorName = safeString(mappingRow?.vendor_name) || safeString(eventRow.auth_provider_snapshot) || providerFallback || channelName;
  const email = safeString(mappingRow?.account_email);
  const accountName = email || safeString(mappingRow?.account_label) || safeString(eventRow.account_snapshot) || channelName;
  return {
    channelName,
    vendorName,
    accountName,
    accountEmail: email
  };
}

export function mappingErrorMessage(error) {
  return shortError(error?.message || String(error));
}
