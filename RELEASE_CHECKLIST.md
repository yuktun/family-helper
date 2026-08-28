# Home App release checklist

Use this checklist for every release. Application publishing and Firestore Rules publishing are separate operations. Neither is implied by local tests or by pushing source code.

## Local verification

- Confirm the intended branch and review `git status` for unrelated work.
- Run `npm test` and confirm every test passes.
- Start a local static server and smoke-test sign-in states, lists, calendar recurrence, contacts, notes, reminders, backup export/import, and responsive navigation.
- Confirm a backup import explains that it **adds** records to existing cloud data. It does not replace or deduplicate records and may therefore create duplicates.
- Review `firestore.rules` locally. Local presence does not prove that these rules are active in Firebase.
- Confirm no credentials, service-account files, private household data, or generated backup JSON files are included.

## Owner authorization gate

Obtain the owner’s explicit approval before either production action below. Record the approved commit and rules revision. Do not use or request credentials in source files or chat.

- Ask the owner to confirm the current production Firebase project/account before any Firebase command. Do not infer it from historical deployment attempts.
- Compare the frontend `firebaseConfig.projectId` and the repository `.firebaserc` target with that owner-confirmed project. A local match is configuration evidence only, not proof of the active production account or rules.
- Run `npm run test:all`, including the isolated Firestore Emulator authorization and legacy-shape suite.
- Review `FIREBASE_ENVIRONMENT.md`. Before stricter rules are published, complete an authorized read-only production shape audit and any separately approved migration it identifies.

## Firestore Rules production step (separate)

- Before publication, audit representative/current documents in every protected collection for missing newly required fields and historical extra fields. In particular, older calendar events may not contain `repeat`; document any other legacy shape found.
- Compile and exercise the proposed rules with the Firebase Emulator Suite against legacy-shaped and current-shaped fixtures. Verify read, create, update, and delete behavior for signed-out visitors, requesters, approved members, and administrators.
- Confirm that existing legacy records remain readable and deletable and that the current app can safely update them into the validated shape. If a record cannot be updated safely, define and test a migration before publication.
- **Block rules publication until the document audit and emulator compatibility checks pass.** Do not weaken validation or guess at production data shape to bypass this gate.
- With an authorized Firebase owner account, compare the active rules with `firestore.rules`.
- Publish only the reviewed rules revision.
- Verify as: signed-out visitor, unapproved requester, approved member, and administrator.
- Confirm unauthorized private reads/writes are rejected, approved members retain collaborative access, and announcements remain public-read/admin-write.
- Record the publication result. If access is unavailable, report verification as blocked rather than assuming deployment.

## GitHub Pages production step (separate)

- Publish the approved application commit through the configured GitHub Pages process.
- Smoke-test the production URL, service worker update, manifest/icons, Google sign-in, Firestore synchronization, backup round trip, transport, and weather.
- Confirm the deployed commit identifier and record any rollback action required.
