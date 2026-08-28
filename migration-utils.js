import { createHash } from 'node:crypto';

export const MIGRATION_SCOPE = Object.freeze({
  projectId: 'family-helpers',
  databaseId: '(default)',
  familyId: 'home',
});

const DOC_PATH = /^families\/home\/(calendarEvents|usefulInfo)\/([^/]+)$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function documentFingerprint(fields) {
  return createHash('sha256').update(JSON.stringify(canonical(fields))).digest('hex');
}

export function validatePlan(plan) {
  if (!plan || plan.version !== 1 || !Array.isArray(plan.targets)) throw new Error('invalid_plan');
  if (JSON.stringify(plan.scope) !== JSON.stringify(MIGRATION_SCOPE)) throw new Error('scope_not_allowlisted');
  if (JSON.stringify(plan.mappingDecision) !== JSON.stringify({ school: 'company' })) throw new Error('mapping_not_allowlisted');
  if (plan.targets.length !== 9) throw new Error('target_count_must_be_9');
  const paths = new Set();
  let calendar = 0;
  let info = 0;
  for (const target of plan.targets) {
    const match = typeof target?.path === 'string' && target.path.match(DOC_PATH);
    if (!match || paths.has(target.path)) throw new Error('invalid_or_duplicate_target_path');
    paths.add(target.path);
    if (!validTimestamp(target.expectedUpdateTime)) throw new Error('missing_update_time');
    if (!/^[a-f0-9]{64}$/.test(target.expectedBeforeHash) || !/^[a-f0-9]{64}$/.test(target.expectedAfterHash)) throw new Error('missing_state_hash');
    if (match[1] === 'calendarEvents') {
      calendar += 1;
      if (target.operation !== 'default-repeat-none') throw new Error('invalid_calendar_operation');
    } else {
      info += 1;
      if (target.operation !== 'map-category' || target.fromCategory !== 'school' || target.toCategory !== 'company') {
        throw new Error('invalid_category_mapping');
      }
    }
  }
  if (calendar !== 6 || info !== 3) throw new Error('target_classes_must_be_6_and_3');
  return structuredClone(plan);
}

export function transformTarget(target, fields) {
  if (target.operation === 'default-repeat-none') {
    if (fields.repeat === 'none') return { status: 'already-compatible', patch: {} };
    if (fields.repeat !== undefined) throw new Error('calendar_repeat_unexpected');
    return { status: 'change', patch: { repeat: 'none' } };
  }
  if (fields.category === target.toCategory) return { status: 'already-compatible', patch: {} };
  if (fields.category !== target.fromCategory) throw new Error('category_source_mismatch');
  return { status: 'change', patch: { category: target.toCategory } };
}

export async function inspectMigration({ plan, store }) {
  const checked = validatePlan(plan);
  const records = [];
  for (const target of [...checked.targets].sort((a, b) => a.path.localeCompare(b.path))) {
    const snapshot = await store.get(target.path);
    if (!snapshot?.exists || !snapshot.updateTime) throw new Error('target_missing');
    const result = transformTarget(target, snapshot.fields);
    const currentHash = documentFingerprint(snapshot.fields);
    if (result.status === 'already-compatible') {
      if (currentHash !== target.expectedAfterHash) throw new Error('target_changed_since_discovery');
    } else if (snapshot.updateTime !== target.expectedUpdateTime || currentHash !== target.expectedBeforeHash) {
      throw new Error('target_changed_since_discovery');
    }
    records.push({ target, snapshot, ...result });
  }
  return records;
}

export async function applyMigration({ plan, store, apply = false, recoveryArtifact = null }) {
  const records = await inspectMigration({ plan, store });
  if (!apply) return summarize(records, 0, false);
  const changes = records.filter((record) => record.status === 'change');
  const postUpdateTimes = await store.atomicPatch(changes.map((record) => ({
    path: record.target.path, patch: record.patch, expectedUpdateTime: record.snapshot.updateTime,
  })));
  const result = summarize(records, changes.length, true);
  result.rollbackArtifact = enrichRollbackArtifact(recoveryArtifact || createRollbackArtifact(plan, records), postUpdateTimes);
  return result;
}

export function createRollbackArtifact(plan, records, postUpdateTimes = {}) {
  validatePlan(plan);
  return {
    version: 1,
    scope: MIGRATION_SCOPE,
    createdAt: new Date().toISOString(), state: 'prepared',
    entries: records.filter((r) => r.status === 'change').map((r) => ({
      path: r.target.path,
      operation: r.target.operation,
      before: r.target.operation === 'default-repeat-none'
        ? { repeat: { state: 'absent' } }
        : { category: r.snapshot.fields.category },
      expectedBeforeUpdateTime: r.snapshot.updateTime,
      expectedAfterUpdateTime: postUpdateTimes[r.target.path] || null,
      expectedBeforeHash: r.target.expectedBeforeHash,
      expectedAfterHash: r.target.expectedAfterHash,
      intendedAfter: r.patch,
    })),
  };
}

export function enrichRollbackArtifact(artifact, postUpdateTimes) {
  return { ...structuredClone(artifact), state: 'applied', entries: artifact.entries.map((entry) => ({
    ...entry, expectedAfterUpdateTime: postUpdateTimes[entry.path] || entry.expectedAfterUpdateTime,
  })) };
}

export async function finalizeRollbackArtifact(artifact, store) {
  const finalized = structuredClone(artifact);
  const states = [];
  for (const entry of finalized.entries) {
    const current = await store.get(entry.path);
    const hash = documentFingerprint(current.fields);
    if (hash === entry.expectedBeforeHash) states.push('before');
    else if (hash === entry.expectedAfterHash) {
      states.push('after');
      entry.expectedAfterUpdateTime = current.updateTime;
    } else throw new Error('rollback_target_changed');
  }
  if (new Set(states).size > 1) throw new Error('atomic_state_inconsistent');
  finalized.state = states[0] === 'after' ? 'applied' : 'not-applied';
  return finalized;
}

export async function rollbackMigration({ artifact, store, apply = false }) {
  if (!artifact || artifact.version !== 1 || JSON.stringify(artifact.scope) !== JSON.stringify(MIGRATION_SCOPE)) {
    throw new Error('invalid_rollback_artifact');
  }
  if (!validateRollbackEntries(artifact)) {
    throw new Error('invalid_rollback_artifact');
  }
  const ready = await finalizeRollbackArtifact(artifact, store);
  if (ready.state === 'not-applied') return { mode: apply ? 'rollback-not-needed' : 'rollback-dry-run', targets: ready.entries.length, writesPerformed: 0 };
  let writes = 0;
  for (const entry of ready.entries) {
    if (!DOC_PATH.test(entry.path)) throw new Error('invalid_rollback_path');
    const current = await store.get(entry.path);
    if (!current?.exists) throw new Error('rollback_target_missing');
    if (apply && (!entry.expectedAfterUpdateTime || current.updateTime !== entry.expectedAfterUpdateTime)) {
      throw new Error('rollback_target_changed');
    }
    if (!apply) continue;
  }
  if (apply) {
    await store.atomicPatch(ready.entries.map((entry) => ({
      path: entry.path,
      patch: entry.before.repeat?.state === 'absent' ? { repeat: undefined } : { category: entry.before.category },
      expectedUpdateTime: entry.expectedAfterUpdateTime,
    })));
    writes = ready.entries.length;
  }
  return { mode: apply ? 'rollback-apply' : 'rollback-dry-run', targets: artifact.entries.length, writesPerformed: writes };
}

function validTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function validateRollbackEntries(artifact) {
  const topKeys = ['createdAt', 'entries', 'scope', 'state', 'version'];
  const entryKeys = ['before', 'expectedAfterHash', 'expectedAfterUpdateTime', 'expectedBeforeHash', 'expectedBeforeUpdateTime', 'intendedAfter', 'operation', 'path'];
  if (JSON.stringify(Object.keys(artifact).sort()) !== JSON.stringify(topKeys) || !validTimestamp(artifact.createdAt) ||
      !Array.isArray(artifact.entries) || artifact.entries.length !== 9 || !['prepared', 'applied'].includes(artifact.state)) return false;
  const paths = new Set();
  let calendars = 0;
  let info = 0;
  for (const entry of artifact.entries) {
    if (JSON.stringify(Object.keys(entry || {}).sort()) !== JSON.stringify(entryKeys)) return false;
    const match = typeof entry?.path === 'string' && entry.path.match(DOC_PATH);
    if (!match || paths.has(entry.path)) return false;
    paths.add(entry.path);
    if (!validTimestamp(entry.expectedBeforeUpdateTime) || !/^[a-f0-9]{64}$/.test(entry.expectedBeforeHash || '') ||
        !/^[a-f0-9]{64}$/.test(entry.expectedAfterHash || '') || entry.expectedBeforeHash === entry.expectedAfterHash) return false;
    if (artifact.state === 'applied' ? !validTimestamp(entry.expectedAfterUpdateTime) : entry.expectedAfterUpdateTime !== null) return false;
    if (match[1] === 'calendarEvents') {
      calendars += 1;
      if (entry.operation !== 'default-repeat-none' || JSON.stringify(entry.before) !== JSON.stringify({ repeat: { state: 'absent' } }) ||
          JSON.stringify(entry.intendedAfter) !== JSON.stringify({ repeat: 'none' })) return false;
    } else {
      info += 1;
      if (entry.operation !== 'map-category' || JSON.stringify(entry.before) !== JSON.stringify({ category: 'school' }) ||
          JSON.stringify(entry.intendedAfter) !== JSON.stringify({ category: 'company' })) return false;
    }
  }
  return calendars === 6 && info === 3;
}

function summarize(records, writes, applyRequested) {
  return {
    mode: applyRequested ? (writes ? 'apply' : 'apply-noop') : 'dry-run',
    targetsChecked: records.length,
    changesRequired: records.filter((r) => r.status === 'change').length,
    alreadyCompatible: records.filter((r) => r.status === 'already-compatible').length,
    byOperation: Object.fromEntries(['default-repeat-none', 'map-category'].map((operation) => [
      operation,
      records.filter((r) => r.target.operation === operation && r.status === 'change').length,
    ])),
    writesPerformed: writes,
  };
}
