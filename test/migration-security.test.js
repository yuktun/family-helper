import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { resolvePrivateArtifact } from '../artifact-path-utils.js';

test('private artifact paths reject escape and nested paths', async () => {
  await assert.rejects(resolvePrivateArtifact('../outside.json'), /artifact_path_outside_private_root/);
  await assert.rejects(resolvePrivateArtifact('migration-private/nested/plan.json'), /artifact_subdirectories_forbidden|ENOENT/);
});

test('production migration refuses implicit read connection', () => {
  const env = { ...process.env };
  delete env.FIRESTORE_EMULATOR_HOST;
  const result = spawnSync(process.execPath, ['scripts/migrate-legacy-data.mjs', '--discover', '--out=migration-private/test.json'], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production_read_controls_missing/);
});

test('category inspection refuses implicit production read', () => {
  const env = { ...process.env };
  delete env.FIRESTORE_EMULATOR_HOST;
  const result = spawnSync(process.execPath, ['scripts/inspect-legacy-categories.mjs'], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /category_inspection_failed/);
});

test('migration requests Firebase access token with an explicit scopes array', async () => {
  const source = await readFile(new URL('../scripts/migrate-legacy-data.mjs', import.meta.url), 'utf8');
  assert.match(source, /auth\.getAccessToken\(account\.tokens\.refresh_token, \[\]\)/);
  assert.doesNotMatch(source, /auth\.getAccessToken\(account\.tokens\.refresh_token\)/);
});
