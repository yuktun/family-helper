import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');

test('private collections remain gated by approved family membership', () => {
  for (const collection of ['todos', 'calendarEvents', 'usefulInfo', 'notes', 'reminders']) {
    const block = rules.match(new RegExp(`match /${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)(?=\\n      \\}|$)`))?.[1] || '';
    assert.match(block, /isApproved\(familyId\)/, `${collection} must require approval`);
  }
});

test('private writes have field allowlists and value validation', () => {
  assert.equal((rules.match(/keys\(\)\.hasOnly/g) || []).length >= 7, true);
  assert.match(rules, /request\.resource\.data\.repeat in \['none', 'weekly', 'monthly', 'yearly'\]/);
  assert.match(rules, /request\.resource\.data\.leadDays <= 365/);
});

test('announcements remain public-read and admin-write only', () => {
  assert.match(rules, /match \/announcements\/\{announcementId\}[\s\S]*?allow read: if true;[\s\S]*?allow create: if isAdmin\(familyId\)/);
});

test('useful-information rules treat company as canonical and school as non-writable', () => {
  const block = rules.match(/match \/usefulInfo\/\{infoId\} \{([\s\S]*?)(?=\n      \}|$)/)?.[1] || '';
  assert.match(block, /category in \['estate', 'medical', 'company', 'emergency', 'other'\]/);
  assert.doesNotMatch(block, /'school'/);
});
