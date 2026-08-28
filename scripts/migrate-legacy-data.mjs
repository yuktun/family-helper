import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createPrivateArtifact, resolvePrivateArtifact } from '../artifact-path-utils.js';
import { FirestoreRestStore } from '../firestore-rest-store.js';
import { MIGRATION_SCOPE, applyMigration, createRollbackArtifact, documentFingerprint, inspectMigration, rollbackMigration, transformTarget } from '../migration-utils.js';

const require = createRequire(import.meta.url);
const auth = require('firebase-tools/lib/auth');
const { Client } = require('firebase-tools/lib/apiv2');
const args = new Set(process.argv.slice(2));
const valueArg = (name) => process.argv.slice(2).find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const host = process.env.FIRESTORE_EMULATOR_HOST;
const isEmulator = Boolean(host);

function requireProductionReadControls() {
  if (!isEmulator && (!args.has('--production-read') || valueArg('--confirm-project') !== MIGRATION_SCOPE.projectId)) {
    throw new Error('production_read_controls_missing');
  }
}

async function connection() {
  if (isEmulator) return new FirestoreRestStore({ baseUrl: `http://${host}`, projectId: 'demo-family-helpers' });
  requireProductionReadControls();
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error('no_firebase_account');
  auth.setActiveAccount({}, account);
  const firebase = new Client({ urlPrefix: 'https://firebase.googleapis.com', apiVersion: 'v1beta1' });
  const project = await firebase.get(`/projects/${MIGRATION_SCOPE.projectId}`, { skipLog: { resBody: true } });
  if (project.status !== 200 || project.body?.projectId !== MIGRATION_SCOPE.projectId) throw new Error('project_identity_not_confirmed');
  const access = await auth.getAccessToken(account.tokens.refresh_token, []);
  return new FirestoreRestStore({ baseUrl: 'https://firestore.googleapis.com', token: access.access_token });
}

async function listMasked(collection, field, store) {
  const root = store.url(`families/${MIGRATION_SCOPE.familyId}/${collection}`);
  const output = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ pageSize: '300', 'mask.fieldPaths': field });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await store.request(`${root}?${query}`);
    for (const doc of page.documents || []) {
      output.push({
        path: doc.name.split('/documents/')[1],
        value: doc.fields?.[field]?.stringValue,
        updateTime: doc.updateTime,
      });
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return output;
}

async function discover(store) {
  const [events, info] = await Promise.all([
    listMasked('calendarEvents', 'repeat', store),
    listMasked('usefulInfo', 'category', store),
  ]);
  const targets = [
    ...events.filter((item) => item.value === undefined).map((item) => ({ path: item.path, operation: 'default-repeat-none', expectedUpdateTime: item.updateTime })),
    ...info.filter((item) => item.value === 'school').map((item) => ({ path: item.path, operation: 'map-category', fromCategory: 'school', toCategory: 'company', expectedUpdateTime: item.updateTime })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const plan = { version: 1, scope: MIGRATION_SCOPE, mappingDecision: { school: 'company' }, targets };
  for (const target of plan.targets) {
    const snapshot = await store.get(target.path);
    const transformed = transformTarget(target, snapshot.fields);
    if (transformed.status !== 'change') throw new Error('discovery_target_not_legacy');
    target.expectedUpdateTime = snapshot.updateTime;
    target.expectedBeforeHash = documentFingerprint(snapshot.fields);
    target.expectedAfterHash = documentFingerprint({ ...snapshot.fields, ...transformed.patch });
  }
  // Validation includes exact 6+3 class counts and path allowlisting.
  await inspectMigration({ plan, store });
  return plan;
}

async function main() {
  const store = await connection();
  if (args.has('--discover')) {
    const output = valueArg('--out');
    if (!output) throw new Error('discover_requires_out');
    const plan = await discover(store);
    const artifact = await createPrivateArtifact(output);
    try { await artifact.writeJson(plan); } finally { await artifact.handle.close(); }
    process.stdout.write(`${JSON.stringify({ mode: 'discovery', targets: 9, calendarDefaults: 6, categoryMappings: 3, outputProtected: true, writesPerformed: 0 })}\n`);
    return;
  }
  const rollbackFile = valueArg('--rollback');
  if (rollbackFile) {
    const artifactPath = await resolvePrivateArtifact(rollbackFile, { mustExist: true });
    const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
    const apply = args.has('--apply');
    if (apply && !isEmulator && (valueArg('--confirm-project') !== MIGRATION_SCOPE.projectId ||
        valueArg('--confirm-write-count') !== String(artifact.entries?.length) || process.env.HOME_APP_PRODUCTION_MIGRATION !== 'AUTHORIZED')) {
      throw new Error('production_confirmation_missing');
    }
    process.stdout.write(`${JSON.stringify(await rollbackMigration({ artifact, store, apply }), null, 2)}\n`);
    return;
  }
  const planFile = valueArg('--plan');
  if (!planFile) throw new Error('plan_required');
  const planPath = await resolvePrivateArtifact(planFile, { mustExist: true });
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const records = await inspectMigration({ plan, store });
  const apply = args.has('--apply');
  let backupArtifact = null;
  let preparedRecovery = null;
  if (apply && !isEmulator) {
    if (valueArg('--confirm-project') !== MIGRATION_SCOPE.projectId || valueArg('--confirm-write-count') !== '9' || process.env.HOME_APP_PRODUCTION_MIGRATION !== 'AUTHORIZED') {
      throw new Error('production_apply_controls_missing');
    }
    if (records.some((record) => record.status === 'change')) {
      const backup = valueArg('--backup-out');
      if (!backup) throw new Error('backup_output_required');
      backupArtifact = await createPrivateArtifact(backup);
      preparedRecovery = createRollbackArtifact(plan, records);
      await backupArtifact.writeJson(preparedRecovery);
    }
  }
  try {
    const result = await applyMigration({ plan, store, apply, recoveryArtifact: preparedRecovery });
    if (backupArtifact) await backupArtifact.writeJson(result.rollbackArtifact);
    delete result.rollbackArtifact;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (backupArtifact) await backupArtifact.handle.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || 'migration_failed')}\n`);
  process.exitCode = 1;
});
