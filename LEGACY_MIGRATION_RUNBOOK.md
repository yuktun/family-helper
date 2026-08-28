# Legacy data compatibility migration

This tooling prepares nine known legacy documents for the candidate Firestore Rules. It is dry-run by default and is locked to project `family-helpers`, database `(default)`, family `home`, and the `calendarEvents` and `usefulInfo` collections.

## Deterministic mapping

- Six calendar events with no `repeat` field receive `repeat: "none"`.
- Three useful-information entries with category `school` receive category `company`.
- Any other source shape, count, collection, family, or mapping stops the operation.

The category-only investigation reads only the category field. It emits the recognized `school-to-company` mapping count and a single aggregate count for all unknown categories, without unknown labels, fingerprints, or document IDs. Any nonzero unknown count stops mapping work for review:

`npm run inspect:legacy-categories -- --production-read --confirm-project=family-helpers`

## Controlled procedure

Production commands require separate Owner authorization. Discovery confirms the active account can access the hardcoded project, reads only `repeat` and `category`, validates the exact 6+3 targets, and writes an exclusive-create, owner-only manifest:

`npm run migrate:legacy -- --production-read --confirm-project=family-helpers --discover --out=migration-private/legacy.migration-plan.json`

The default plan execution is a zero-write dry run. Its console output contains only aggregate counts:

`npm run migrate:legacy -- --production-read --confirm-project=family-helpers --plan=migration-private/legacy.migration-plan.json`

Apply is one atomic Firestore commit. Every write has the discovery-time update-time precondition, so any drift rejects all nine writes. Production apply additionally requires all three independent controls plus a protected rollback destination:

`HOME_APP_PRODUCTION_MIGRATION=AUTHORIZED npm run migrate:legacy -- --production-read --plan=migration-private/legacy.migration-plan.json --apply --confirm-project=family-helpers --confirm-write-count=9 --backup-out=migration-private/legacy.rollback.json`

The environment variable is an execution interlock, not authorization. Never run that command without explicit production-change approval.

## Rollback

Before the atomic commit begins, the rollback artifact already contains exact private paths, prior values, pre-state and intended post-state fingerprints, and intended changes. After success it is enriched with post-migration update times. If the process stops between commit and enrichment, rollback safely detects whether the atomic commit happened, reconstructs the post-update preconditions, and can recover. Store the artifact securely, do not share it in logs or tickets, and delete it under the Owner's retention direction after verification. It is excluded from Git.

Rollback defaults to a zero-write check:

`npm run migrate:legacy -- --production-read --confirm-project=family-helpers --rollback=migration-private/legacy.rollback.json`

Authorized rollback uses an atomic commit and refuses to overwrite any document changed after migration:

`HOME_APP_PRODUCTION_MIGRATION=AUTHORIZED npm run migrate:legacy -- --production-read --rollback=migration-private/legacy.rollback.json --apply --confirm-project=family-helpers --confirm-write-count=9`

After apply, rerun the production compatibility audit before any Rules deployment. If apply fails, Firestore's atomic commit guarantees that none of the nine changes were written.
