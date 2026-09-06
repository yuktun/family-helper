import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('completed checklist items are hidden from every list filter', () => {
  assert.match(
    source,
    /state\.todos\.filter\(\(item\) => !item\.completed && \(todoFilter === 'all' \|\| item\.category === todoFilter\)\)/,
  );
});
