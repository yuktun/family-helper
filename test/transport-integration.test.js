import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('native transport UI has one homepage source and no duplicate bottom navigation tab', async () => {
  const html = await read('index.html');
  assert.equal((html.match(/data-home-module="transport"/g) || []).length, 1);
  assert.match(html, /id="page-transport"/);
  assert.match(html, /我的交通設定/);
  assert.match(html, /按路線加入/);
  assert.match(html, /按車站加入/);
  assert.match(html, /港鐵/);
  assert.doesNotMatch(html, /data-page-target="transport"/);
});

test('PWA pre-cache includes every local transport module and the authoritative catalog', async () => {
  const worker = await read('sw.js');
  for (const asset of [
    'transport-controller.js', 'transport/index.js', 'transport/preferences.js',
    'transport/adapters/kmb.js', 'transport/adapters/ctb.js',
    'transport/adapters/gmb.js', 'transport/adapters/mtr.js',
    'assets/transport-catalog.json',
  ]) assert.match(worker, new RegExp(asset.replaceAll('.', '\\.')));
  assert.match(worker, /family-helper-static-v19/);
});

test('personal transport is excluded from household backup collections', async () => {
  const backup = await read('backup-utils.js');
  assert.doesNotMatch(backup, /transport\/preferences|transportPreferences/);
});

