import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { FirestoreRestStore } from '../firestore-rest-store.js';
import { MIGRATION_SCOPE, applyMigration, createRollbackArtifact, documentFingerprint, inspectMigration, rollbackMigration, transformTarget } from '../migration-utils.js';

const [host, portText] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
let env;

const store = new FirestoreRestStore({ baseUrl: `http://${process.env.FIRESTORE_EMULATOR_HOST}`, token: 'owner', projectId: 'demo-family-helpers' });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-family-helpers',
    firestore: { host, port: Number(portText), rules: await readFile('firestore.rules', 'utf8') },
  });
});
after(async () => env.cleanup());
beforeEach(async () => env.clearFirestore());

async function fixture() {
  const targets = [];
  await env.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    for (let i = 0; i < 6; i += 1) {
      const path = `families/home/calendarEvents/event-${i}`;
      const ref = admin.doc(path);
      await ref.set({ title: `Event ${i}` });
      targets.push({ path, operation: 'default-repeat-none' });
    }
    for (let i = 0; i < 3; i += 1) {
      const path = `families/home/usefulInfo/info-${i}`;
      const ref = admin.doc(path);
      await ref.set({ category: 'school', name: `Entry ${i}` });
      targets.push({ path, operation: 'map-category', fromCategory: 'school', toCategory: 'company' });
    }
  });
  for (const target of targets) {
    const snapshot = await store.get(target.path);
    const transformed = transformTarget(target, snapshot.fields);
    target.expectedUpdateTime = snapshot.updateTime;
    target.expectedBeforeHash = documentFingerprint(snapshot.fields);
    target.expectedAfterHash = documentFingerprint({ ...snapshot.fields, ...transformed.patch });
  }
  return { version: 1, scope: MIGRATION_SCOPE, mappingDecision: { school: 'company' }, targets };
}

test('dry-run performs zero writes and reports exact deterministic classes', async () => {
  const plan = await fixture();
  const result = await applyMigration({ plan, store });
  assert.deepEqual(result.byOperation, { 'default-repeat-none': 6, 'map-category': 3 });
  assert.equal(result.writesPerformed, 0);
  assert.equal((await store.get(plan.targets[0].path)).fields.repeat, undefined);
});

test('same approved plan is operationally idempotent after the first run', async () => {
  const plan = await fixture();
  const first = await applyMigration({ plan, store, apply: true });
  assert.equal(first.writesPerformed, 9);
  const second = await applyMigration({ plan, store, apply: true });
  assert.equal(second.writesPerformed, 0);
  assert.equal(second.mode, 'apply-noop');
  assert.equal(second.alreadyCompatible, 9);
});

test('tampered or duplicate rollback entries are rejected before access', async () => {
  const plan = await fixture();
  const prepared = createRollbackArtifact(plan, await inspectMigration({ plan, store }));
  const duplicate = structuredClone(prepared);
  duplicate.entries[8].path = duplicate.entries[0].path;
  await assert.rejects(rollbackMigration({ artifact: duplicate, store }), /invalid_rollback_artifact/);
  const tampered = structuredClone(prepared);
  tampered.entries[0].intendedAfter.repeat = 'weekly';
  await assert.rejects(rollbackMigration({ artifact: tampered, store }), /invalid_rollback_artifact/);
});

test('plan rejects alternate useful-info source or destination mappings', async () => {
  const plan = await fixture();
  const alternateSource = structuredClone(plan);
  alternateSource.targets[8].fromCategory = 'legacy-school';
  await assert.rejects(inspectMigration({ plan: alternateSource, store }), /invalid_category_mapping/);
  const alternateDestination = structuredClone(plan);
  alternateDestination.targets[8].toCategory = 'other';
  await assert.rejects(inspectMigration({ plan: alternateDestination, store }), /invalid_category_mapping/);
});

test('drift after discovery fails before any migration write', async () => {
  const plan = await fixture();
  await store.atomicPatch([{ path: plan.targets[8].path, patch: { note: 'concurrent change' }, expectedUpdateTime: plan.targets[8].expectedUpdateTime }]);
  await assert.rejects(inspectMigration({ plan, store }), /target_changed_since_discovery/);
  assert.equal((await store.get(plan.targets[0].path)).fields.repeat, undefined);
});

test('rollback artifact restores category and removes newly introduced repeat', async () => {
  const plan = await fixture();
  const records = await inspectMigration({ plan, store });
  const applied = await applyMigration({ plan, store, apply: true });
  const artifact = applied.rollbackArtifact;
  const dry = await rollbackMigration({ artifact, store });
  assert.equal(dry.writesPerformed, 0);
  await rollbackMigration({ artifact, store, apply: true });
  assert.equal((await store.get(plan.targets[0].path)).fields.repeat, undefined);
  assert.equal((await store.get(plan.targets[8].path)).fields.category, 'school');
});

test('complete prepared artifact supports recovery after commit-before-enrichment crash', async () => {
  const plan = await fixture();
  const records = await inspectMigration({ plan, store });
  const prepared = createRollbackArtifact(plan, records);
  assert.equal(prepared.state, 'prepared');
  assert.equal(prepared.entries.length, 9);
  assert.ok(prepared.entries.every((entry) => entry.before && entry.intendedAfter && entry.expectedAfterHash));
  await store.atomicPatch(records.map((record) => ({
    path: record.target.path, patch: record.patch, expectedUpdateTime: record.snapshot.updateTime,
  })));
  const recovered = await rollbackMigration({ artifact: prepared, store, apply: true });
  assert.equal(recovered.writesPerformed, 9);
  assert.equal((await store.get(plan.targets[0].path)).fields.repeat, undefined);
  assert.equal((await store.get(plan.targets[8].path)).fields.category, 'school');
});
