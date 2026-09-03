import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const auth = require('firebase-tools/lib/auth');
const { Client } = require('firebase-tools/lib/apiv2');
const rulesApi = require('firebase-tools/lib/gcp/rules');

const PROJECT_ID = 'family-helpers';
const DATABASE_ID = '(default)';
const FAMILY_ID = 'home';
const COLLECTIONS = ['todos', 'calendarEvents', 'usefulInfo', 'notes', 'reminders', 'expenses'];

if (process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Audit stopped: FIRESTORE_EMULATOR_HOST is set.');
}

const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Audit stopped: no existing Firebase CLI account is configured.');
auth.setActiveAccount({}, account);

const firestore = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const firebase = new Client({ urlPrefix: 'https://firebase.googleapis.com', apiVersion: 'v1beta1' });

const specs = {
  todos: {
    fields: ['title', 'category', 'completed', 'createdBy', 'createdAt', 'updatedAt'],
    checks: {
      title: requiredText(200), category: enumText(['todo', 'shopping']), completed: type('boolean'),
      createdBy: requiredText(Infinity), createdAt: type('timestamp'), updatedAt: type('timestamp'),
    },
  },
  calendarEvents: {
    fields: ['title', 'date', 'time', 'category', 'repeat', 'createdBy', 'createdAt', 'updatedAt'],
    checks: {
      title: requiredText(200), date: requiredText(10), time: text(5),
      category: enumText(['family', 'school', 'medical', 'car', 'bill', 'birthday', 'other']),
      repeat: enumText(['none', 'weekly', 'monthly', 'yearly']), createdBy: requiredText(Infinity),
      createdAt: type('timestamp'), updatedAt: type('timestamp'),
    },
    semantic: { date: isoDate, time: clockTime },
  },
  usefulInfo: {
    fields: ['category', 'name', 'phone', 'address', 'note', 'sortOrder', 'createdAt', 'updatedAt'],
    checks: {
      category: enumText(['estate', 'medical', 'company', 'emergency', 'other']), name: requiredText(120),
      phone: text(80), address: text(500), note: text(1000), sortOrder: numberRange(0, 100000),
      createdAt: type('timestamp'), updatedAt: type('timestamp'),
    },
  },
  notes: {
    fields: ['title', 'content', 'createdBy', 'createdAt', 'updatedAt'],
    checks: {
      title: requiredText(200), content: text(5000), createdBy: requiredText(Infinity),
      createdAt: type('timestamp'), updatedAt: type('timestamp'),
    },
  },
  reminders: {
    fields: ['title', 'dueDate', 'repeat', 'leadDays', 'createdBy', 'createdAt', 'updatedAt'],
    checks: {
      title: requiredText(200), dueDate: requiredText(10), repeat: enumText(['none', 'monthly', 'yearly']),
      leadDays: integerRange(0, 365), createdBy: requiredText(Infinity),
      createdAt: type('timestamp'), updatedAt: type('timestamp'),
    },
    semantic: { dueDate: isoDate },
  },
  expenses: {
    fields: ['title', 'amountCents', 'currency', 'date', 'category', 'paidBy', 'note', 'createdBy', 'createdAt', 'updatedAt'],
    checks: {
      title: requiredText(200), amountCents: integerRange(1, 999999999), currency: enumText(['HKD']), date: requiredText(10),
      category: enumText(['groceries', 'dining', 'transport', 'home', 'utilities', 'health', 'education', 'leisure', 'other']),
      paidBy: text(80), note: text(1000), createdBy: requiredText(Infinity), createdAt: type('timestamp'), updatedAt: type('timestamp'),
    },
    semantic: { date: isoDate },
  },
};

function valueType(value) {
  if (!value || typeof value !== 'object') return 'unknown';
  if ('stringValue' in value) return 'string';
  if ('booleanValue' in value) return 'boolean';
  if ('timestampValue' in value) return 'timestamp';
  if ('integerValue' in value) return 'integer';
  if ('doubleValue' in value) return 'double';
  if ('nullValue' in value) return 'null';
  if ('mapValue' in value) return 'map';
  if ('arrayValue' in value) return 'array';
  if ('referenceValue' in value) return 'reference';
  if ('geoPointValue' in value) return 'geopoint';
  if ('bytesValue' in value) return 'bytes';
  return 'unknown';
}

function scalar(value) {
  const kind = valueType(value);
  if (kind === 'string') return value.stringValue;
  if (kind === 'boolean') return value.booleanValue;
  if (kind === 'integer') return Number(value.integerValue);
  if (kind === 'double') return Number(value.doubleValue);
  return undefined;
}

function type(expected) {
  return (value) => valueType(value) === expected ? null : `wrong_type:${expected}`;
}
function text(max) {
  return (value) => {
    if (valueType(value) !== 'string') return 'wrong_type:string';
    return Array.from(value.stringValue).length <= max ? null : 'too_long';
  };
}
function requiredText(max) {
  return (value) => {
    const basic = text(max)(value);
    if (basic) return basic;
    return Array.from(value.stringValue).length > 0 ? null : 'empty_required';
  };
}
function enumText(allowed) {
  return (value) => {
    if (valueType(value) !== 'string') return 'wrong_type:string';
    return allowed.includes(value.stringValue) ? null : 'invalid_enum';
  };
}
function numberRange(min, max) {
  return (value) => {
    const kind = valueType(value);
    if (!['integer', 'double'].includes(kind)) return 'wrong_type:number';
    const number = scalar(value);
    return Number.isFinite(number) && number >= min && number <= max ? null : 'out_of_range';
  };
}
function integerRange(min, max) {
  return (value) => {
    if (valueType(value) !== 'integer') return 'wrong_type:integer';
    const number = scalar(value);
    return Number.isInteger(number) && number >= min && number <= max ? null : 'out_of_range';
  };
}
function isoDate(value) {
  if (valueType(value) !== 'string') return false;
  const candidate = value.stringValue;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate;
}
function clockTime(value) {
  return valueType(value) === 'string' && (value.stringValue === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.stringValue));
}

function increment(target, reason) {
  target[reason] = (target[reason] || 0) + 1;
}

function inspectDocument(collection, fields) {
  const spec = specs[collection];
  const reasons = new Set();
  const present = Object.keys(fields || {});
  for (const field of spec.fields) {
    if (!(field in (fields || {}))) reasons.add(`missing_field:${field}`);
  }
  for (const field of present) {
    if (!spec.fields.includes(field)) reasons.add('unexpected_field');
  }
  for (const [field, check] of Object.entries(spec.checks)) {
    if (field in (fields || {})) {
      const result = check(fields[field]);
      if (result) reasons.add(`${result}:${field}`);
    }
  }
  const semantic = [];
  for (const [field, check] of Object.entries(spec.semantic || {})) {
    if (field in (fields || {}) && !check(fields[field])) semantic.push(`invalid_format:${field}`);
  }
  return { compatible: reasons.size === 0, reasons: [...reasons], semantic };
}

async function auditCollection(collection) {
  const result = { total: 0, compatible: 0, incompatible: 0, reasons: {}, semanticWarnings: {} };
  let pageToken = '';
  const seenPageTokens = new Set();
  const seenDocumentNames = new Set();
  do {
    if (pageToken) {
      if (seenPageTokens.has(pageToken)) throw new Error(`read_failed:${collection}:repeated_page`);
      seenPageTokens.add(pageToken);
    }
    const response = await firestore.get(
      `/projects/${PROJECT_ID}/databases/${encodeURIComponent(DATABASE_ID)}/documents/families/${FAMILY_ID}/${collection}`,
      { queryParams: { pageSize: 300, pageToken }, skipLog: { resBody: true } },
    );
    if (response.status !== 200) throw new Error(`read_failed:${collection}:${response.status}`);
    if (!response.body || typeof response.body !== 'object' || Array.isArray(response.body)) {
      throw new Error(`read_failed:${collection}:invalid_body`);
    }
    const nextPageToken = response.body.nextPageToken;
    if (nextPageToken != null && typeof nextPageToken !== 'string') {
      throw new Error(`read_failed:${collection}:invalid_page_token`);
    }
    if (response.body.documents == null && nextPageToken) {
      throw new Error(`read_failed:${collection}:missing_documents`);
    }
    if (response.body.documents != null && !Array.isArray(response.body.documents)) {
      throw new Error(`read_failed:${collection}:invalid_documents`);
    }
    for (const document of response.body.documents || []) {
      if (!document || typeof document.name !== 'string' || !document.name) {
        throw new Error(`read_failed:${collection}:missing_document_name`);
      }
      if (seenDocumentNames.has(document.name)) {
        throw new Error(`read_failed:${collection}:duplicate_document`);
      }
      seenDocumentNames.add(document.name);
      const inspected = inspectDocument(collection, document.fields || {});
      result.total += 1;
      if (inspected.compatible) result.compatible += 1;
      else result.incompatible += 1;
      for (const reason of inspected.reasons) increment(result.reasons, reason);
      for (const reason of inspected.semantic) increment(result.semanticWarnings, reason);
    }
    pageToken = nextPageToken || '';
  } while (pageToken);
  if (result.total !== result.compatible + result.incompatible) throw new Error(`count_mismatch:${collection}`);
  return result;
}

async function getActiveRules() {
  const releases = await rulesApi.listAllReleases(PROJECT_ID);
  const expectedName = `projects/${PROJECT_ID}/releases/cloud.firestore`;
  const matches = releases.filter((release) => release.name === expectedName && typeof release.rulesetName === 'string');
  if (matches.length !== 1) throw new Error('rules_read_failed:default_release_not_unique');
  const files = await rulesApi.getRulesetContent(matches[0].rulesetName);
  return files?.[0]?.content || '';
}

function normalizeRules(source) {
  return source.replace(/\r\n/g, '\n').trim();
}
function hash(source) {
  return createHash('sha256').update(source).digest('hex');
}

async function main() {
  const projectResponse = await firebase.get(`/projects/${PROJECT_ID}`, { skipLog: { resBody: true } });
  if (projectResponse.status !== 200 || projectResponse.body.projectId !== PROJECT_ID) {
    throw new Error('Audit stopped: configured account cannot confirm the required project.');
  }

  const localRules = normalizeRules(await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'));
  const activeRules = normalizeRules(await getActiveRules());
  const passes = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const collections = {};
    for (const collection of COLLECTIONS) collections[collection] = await auditCollection(collection);
    passes.push(collections);
  }
  if (JSON.stringify(passes[0]) !== JSON.stringify(passes[1])) throw new Error('audit_inconclusive:production_changed');

  const output = {
    auditMode: 'read-only-get-list',
    project: { projectId: PROJECT_ID },
    database: DATABASE_ID,
    family: FAMILY_ID,
    rules: {
      exactNormalizedMatch: activeRules === localRules,
      activeSha256: hash(activeRules),
      candidateSha256: hash(localRules),
    },
    collections: passes[0],
    repeatedReadMatched: true,
    complete: true,
    writesPerformed: 0,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  const message = String(error?.message || 'unknown_error');
  const safe = /^(read_failed|count_mismatch):[A-Za-z]+(?::\d+)?$/.test(message) ? message : 'audit_failed';
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
});
