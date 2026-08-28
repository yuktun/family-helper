import { MIGRATION_SCOPE } from './migration-utils.js';

function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }
function valueToJs(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  throw new Error('unsupported_firestore_value');
}
function jsToValue(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (value === null) return { nullValue: null };
  throw new Error('unsupported_javascript_value');
}

export class FirestoreRestStore {
  constructor({ baseUrl, token = '', projectId = MIGRATION_SCOPE.projectId }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.projectId = projectId;
  }
  url(path) {
    return `${this.baseUrl}/v1/projects/${this.projectId}/databases/${encodeURIComponent(MIGRATION_SCOPE.databaseId)}/documents/${encodePath(path)}`;
  }
  async request(url, options = {}) {
    const headers = { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) };
    const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
    if (!response.ok) throw new Error(`firestore_request_failed:${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  async get(path) {
    const doc = await this.request(this.url(path));
    return { exists: true, updateTime: doc.updateTime, fields: Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, valueToJs(v)])) };
  }
  async patch(path, patch, updateTime) {
    const masks = Object.keys(patch).sort();
    const query = new URLSearchParams({ 'currentDocument.updateTime': updateTime });
    for (const field of masks) query.append('updateMask.fieldPaths', field);
    return this.request(`${this.url(path)}?${query}`, { method: 'PATCH', body: JSON.stringify({ fields: Object.fromEntries(masks.map((k) => [k, jsToValue(patch[k])])) }) });
  }
  async removeField(path, field, updateTime) {
    const query = new URLSearchParams({ 'currentDocument.updateTime': updateTime, 'updateMask.fieldPaths': field });
    return this.request(`${this.url(path)}?${query}`, { method: 'PATCH', body: JSON.stringify({ fields: {} }) });
  }
  async atomicPatch(changes) {
    if (changes.length === 0) return {};
    const database = `${this.baseUrl}/v1/projects/${this.projectId}/databases/${encodeURIComponent(MIGRATION_SCOPE.databaseId)}`;
    const writes = changes.map(({ path, patch, expectedUpdateTime }) => {
      const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined).map(([k, value]) => [k, jsToValue(value)]));
      return {
        update: { name: `projects/${this.projectId}/databases/${MIGRATION_SCOPE.databaseId}/documents/${path}`, fields },
        updateMask: { fieldPaths: Object.keys(patch).sort() },
        currentDocument: { updateTime: expectedUpdateTime },
      };
    });
    const response = await this.request(`${database}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
    return Object.fromEntries(changes.map((change, index) => [change.path, response.writeResults[index].updateTime]));
  }
}
