import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const auth = require('firebase-tools/lib/auth');
const { Client } = require('firebase-tools/lib/apiv2');

const PROJECT_ID = 'family-helpers';
const DATABASE_ID = '(default)';
const FAMILY_ID = 'home';
const ALLOWED = new Set(['estate', 'medical', 'company', 'emergency', 'other']);
const args = new Set(process.argv.slice(2));
const confirmedProject = process.argv.slice(2).find((arg) => arg.startsWith('--confirm-project='))?.split('=')[1];

if (process.env.FIRESTORE_EMULATOR_HOST || !args.has('--production-read') || confirmedProject !== PROJECT_ID) {
  process.stderr.write('category_inspection_failed\n');
  process.exit(1);
}
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Inspection stopped: no Firebase CLI account is configured.');
auth.setActiveAccount({}, account);

const firebase = new Client({ urlPrefix: 'https://firebase.googleapis.com', apiVersion: 'v1beta1' });
const firestore = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });

async function main() {
  const project = await firebase.get(`/projects/${PROJECT_ID}`, { skipLog: { resBody: true } });
  if (project.status !== 200 || project.body?.projectId !== PROJECT_ID) {
    throw new Error('Inspection stopped: the active account cannot confirm the allowlisted project.');
  }

  const counts = new Map();
  let pageToken = '';
  const seenTokens = new Set();
  do {
    if (pageToken && seenTokens.has(pageToken)) throw new Error('Inspection stopped: repeated page token.');
    if (pageToken) seenTokens.add(pageToken);
    const response = await firestore.get(
      `/projects/${PROJECT_ID}/databases/${encodeURIComponent(DATABASE_ID)}/documents/families/${FAMILY_ID}/usefulInfo`,
      { queryParams: { pageSize: 300, pageToken, 'mask.fieldPaths': 'category' }, skipLog: { resBody: true } },
    );
    if (response.status !== 200 || !response.body || typeof response.body !== 'object') {
      throw new Error('Inspection stopped: category read failed.');
    }
    for (const document of response.body.documents || []) {
      const value = document?.fields?.category?.stringValue;
      const key = typeof value === 'string' ? value : '<missing-or-non-string>';
      if (!ALLOWED.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
    }
    pageToken = response.body.nextPageToken || '';
  } while (pageToken);

  const recognizedMappings = [];
  let unknownCategoryDocumentCount = 0;
  for (const [value, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (value === 'school') recognizedMappings.push({ mappingClass: 'school-to-company', count });
    else unknownCategoryDocumentCount += count;
  }
  process.stdout.write(`${JSON.stringify({
    mode: 'privacy-minimized-read-only-category-aggregation',
    scope: { projectId: PROJECT_ID, databaseId: DATABASE_ID, familyId: FAMILY_ID, collection: 'usefulInfo' },
    recognizedMappings,
    unknownCategoryDocumentCount,
    invalidDocumentCount: [...counts.values()].reduce((sum, count) => sum + count, 0),
    fieldsRead: ['category'],
    documentIdsOutput: false,
    complete: unknownCategoryDocumentCount === 0,
    writesPerformed: 0,
  }, null, 2)}\n`);
  if (unknownCategoryDocumentCount > 0) process.exitCode = 2;
}

main().catch(() => {
  process.stderr.write('category_inspection_failed\n');
  process.exitCode = 1;
});
