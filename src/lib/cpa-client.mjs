import { safeString } from './utils.mjs';

export class CPAClient {
  constructor(config) {
    this.baseUrl = config.cpaBaseUrl.replace(/\/$/, '');
    this.managementKey = config.managementKey;
  }

  headers() {
    return {
      Authorization: `Bearer ${this.managementKey}`,
      'Content-Type': 'application/json'
    };
  }

  async getJson(path) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers()
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`CPA ${path} -> ${response.status}: ${text.slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  async getUsageQueue(count) {
    const value = Number.isFinite(count) ? count : 100;
    const result = await this.getJson(`/v0/management/usage-queue?count=${value}`);
    return Array.isArray(result) ? result : [];
  }

  async getCodexChannels() {
    const result = await this.getJson('/v0/management/codex-api-key');
    return Array.isArray(result?.['codex-api-key']) ? result['codex-api-key'] : [];
  }

  async getClaudeChannels() {
    const result = await this.getJson('/v0/management/claude-api-key');
    return Array.isArray(result?.['claude-api-key']) ? result['claude-api-key'] : [];
  }

  async getGeminiChannels() {
    const result = await this.getJson('/v0/management/gemini-api-key');
    return Array.isArray(result?.['gemini-api-key']) ? result['gemini-api-key'] : [];
  }

  async getVertexChannels() {
    const result = await this.getJson('/v0/management/vertex-api-key');
    return Array.isArray(result?.['vertex-api-key']) ? result['vertex-api-key'] : [];
  }

  async getOpenAICompatChannels() {
    const result = await this.getJson('/v0/management/openai-compatibility');
    return Array.isArray(result?.['openai-compatibility']) ? result['openai-compatibility'] : [];
  }

  async getAuthFiles() {
    const result = await this.getJson('/v0/management/auth-files');
    return Array.isArray(result?.files) ? result.files : [];
  }

  async getAllMappingsPayload() {
    const [codex, claude, gemini, vertex, openai, authFiles] = await Promise.all([
      this.getCodexChannels(),
      this.getClaudeChannels(),
      this.getGeminiChannels(),
      this.getVertexChannels(),
      this.getOpenAICompatChannels(),
      this.getAuthFiles()
    ]);
    return { codex, claude, gemini, vertex, openai, authFiles };
  }

  static authIndex(entry) {
    return safeString(entry?.['auth-index'] ?? entry?.authIndex ?? entry?.auth_index);
  }
}
