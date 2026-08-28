import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, validateBackup, MAX_BACKUP_BYTES, MAX_BACKUP_RECORDS } from '../backup-utils.js';

const data = {
  todos: [{ id: 't1', title: '買奶', category: 'shopping', completed: false }],
  events: [{ id: 'e1', title: '覆診', date: '2026-09-30', time: '09:05', category: 'medical', repeat: 'monthly' }],
  contacts: [{ id: 'c1', category: 'medical', name: '醫生', phone: '1234', address: '香港', note: '帶報告', sortOrder: 0 }],
  notes: [{ id: 'n1', title: '門鎖', content: '提示' }],
  reminders: [{ id: 'r1', title: '續期', dueDate: '2027-01-01', repeat: 'yearly', leadDays: 0 }],
};

test('version 3 backup preserves all supported fields and recurrence', () => {
  assert.deepEqual(validateBackup(createBackup(data, '2026-08-27T00:00:00.000Z')), {
    todos: [{ title: '買奶', category: 'shopping', completed: false }],
    events: [{ title: '覆診', date: '2026-09-30', time: '09:05', category: 'medical', repeat: 'monthly' }],
    contacts: [{ category: 'medical', name: '醫生', phone: '1234', address: '香港', note: '帶報告', sortOrder: 0 }],
    notes: [{ title: '門鎖', content: '提示' }],
    reminders: [{ title: '續期', dueDate: '2027-01-01', repeat: 'yearly', leadDays: 0 }],
  });
});

test('accepts a valid backup containing empty supported collections', () => {
  const empty = Object.fromEntries(Object.keys(data).map((key) => [key, []]));
  assert.deepEqual(validateBackup(createBackup(empty, '2026-08-27T00:00:00Z')), empty);
});

for (const [name, mutate] of [
  ['unsupported version', (x) => { x.version = 2; }],
  ['unknown collection', (x) => { x.data.secrets = []; }],
  ['missing collection', (x) => { delete x.data.notes; }],
  ['wrong completed type', (x) => { x.data.todos[0].completed = 'false'; }],
  ['invalid date', (x) => { x.data.events[0].date = '2026-02-30'; }],
  ['invalid enum', (x) => { x.data.events[0].repeat = 'daily'; }],
]) test(`rejects ${name}`, () => {
  const candidate = structuredClone(createBackup(data, '2026-08-27T00:00:00Z'));
  mutate(candidate);
  assert.throws(() => validateBackup(candidate));
});

test('rejects oversized files and record counts before import', () => {
  assert.throws(() => validateBackup(createBackup(data), MAX_BACKUP_BYTES + 1));
  const tooMany = createBackup({ ...data, todos: Array.from({ length: MAX_BACKUP_RECORDS + 1 }, () => ({ title: 'x', category: 'todo', completed: false })) });
  assert.throws(() => validateBackup(tooMany));
});
