# Firebase environment baseline

## Confirmed identifiers (2026-08-27)

- Owner-confirmed production project ID: `family-helpers`
- Frontend `firebaseConfig.projectId`: `family-helpers`
- Repository `.firebaserc` default: `family-helpers`

These identifiers match. This comparison does not inspect the active Firebase CLI account, production rules, or production data. Local emulator commands deliberately use the synthetic project ID `demo-family-helpers`; Firebase blocks demo-project traffic to non-emulated services.

## Safe local emulator setup

The emulator test runner uses project-local development dependencies and a portable Java 21 runtime under the gitignored `.tools/` directory. It redirects Firebase CLI preferences into `.tools/config`, removes inherited Firebase/Google credential and project environment variables, and runs non-interactively. It therefore neither reads nor changes the user's normal Firebase CLI account configuration.

```powershell
npm install
npm run test:firestore
```

If `.tools/temurin21` is absent, download an Eclipse Temurin 21 JRE ZIP from Adoptium and extract it there. No Firebase login is required. The first emulator run may download the official Firestore emulator JAR into the Firebase CLI cache. Firebase CLI may also attempt a generic metadata/MOTD request; that is non-production network traffic and does not use the production project or credentials.

Run all local checks with:

```powershell
npm run test:all
```

## Compatibility finding

The stricter candidate rules allow approved members to read and delete legacy private records, because those operations depend only on approved membership. Writes validate the complete post-write document. A legacy record that lacks a now-required field, or contains an unknown historical field, cannot be partially edited by the current UI until it is normalized.

Known examples:

- todo without `title`, `category`, `completed`, `createdBy`, `createdAt`, or `updatedAt`
- calendar event without `title`, `date`, `time`, `category`, `repeat`, `createdBy`, `createdAt`, or `updatedAt`
- useful-info record without `category`, `name`, `phone`, `address`, `note`, `sortOrder`, `createdAt`, or `updatedAt`
- note without `title`, `content`, `createdBy`, `createdAt`, or `updatedAt`
- reminder without `title`, `dueDate`, `repeat`, `leadDays`, `createdBy`, `createdAt`, or `updatedAt`
- any private record containing fields outside its current allowlist

## Pre-deployment production audit and conditional migration

Do not deploy the candidate rules until an authorized, read-only production audit has counted incompatible records by collection and field. The owner must separately approve any production access and any migration.

If incompatible records exist, use a reviewed, idempotent migration that:

1. exports or otherwise backs up the affected production records;
2. adds safe defaults (`repeat: 'none'`, `leadDays: 0`, empty optional text, and a stable `sortOrder`);
3. preserves valid creator and timestamp data where present;
4. handles missing audit fields using an owner-approved provenance value and timestamps;
5. removes unknown fields only after confirming they are obsolete;
6. supports dry-run counts and samples before writes;
7. verifies every migrated document against the emulator-tested schema; and
8. deploys rules only after migration QA and a separately approved production change window.

If the read-only audit finds zero incompatible records, no data migration is required.
