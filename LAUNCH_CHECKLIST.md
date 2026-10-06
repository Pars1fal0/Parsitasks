# Parsitasks: Preparation for Public Release

Updated: 2026-10-06. This checklist distinguishes implemented controls from
checks that still require real infrastructure or disposable accounts. It is not
a security certification or permission to start charging users.

## Completed in This Stage

- Dependencies updated to patched MCP SDK 1.32.1, sharp 0.35.5 and proxy-addr
  2.0.8. SDK/sharp overrides also cover upstream packages with older pinned
  versions; review those overrides when Agents/Miniflare update. The current
  npm audit reports no known vulnerabilities, not immunity to unknown issues.

- Cloud restore uses a database transaction with an owner-scoped row lock and
  expected revision. It always saves the previous workspace before replacing
  different data, independently of the automatic five-minute snapshot throttle.
- Conflicts and an unavailable restore RPC abort without a fallback overwrite.
- Local edits created while restore is pending are preserved instead of being
  replaced by the response; the UI explains that cloud and device need reconciliation.
- A client refuses to synchronize or restore a newer workspace schema. This
  protects clients containing this guard; it does not patch already released
  older clients retroactively.
- Account deletion enumerates only the owner's image paths and removes binaries
  through Storage API before deleting Auth. Enumeration finishes before deletion
  so pagination cannot skip files. The database refuses deletion with remaining
  board images. A partially failed cleanup leaves the account available for retry.
- Storage has a restrictive active-account guard: a deleted user's still-valid
  JWT cannot list or mutate board images. Write checks lock that user's Auth row,
  and deletion locks the same row before checking remaining files. Listing stays
  read-only. Actual concurrent managed Storage requests still require staging.
- Settings imports validate shape, version and a 256 KiB limit, preserve missing
  preferences and cancel after account switches. Only explicitly imported account
  preferences receive new timestamps. Exports allowlist known public settings.
- Settings persistence failures are disclosed; timezone and ChatGPT access edits
  roll back rather than announcing a successful unsaved change.
- Synthetic PostgreSQL checks cover the full schema, repeated migration, RLS,
  OAuth rows, Storage metadata paths, snapshot conflicts and owner-only deletion.
- Isolated browser checks cover mobile/desktop preview, restore errors, local
  persistence and account deletion. All network requests are mocked.
- Live security diagnostics cannot create proof tasks and restrict reads to the
  two explicitly selected disposable accounts, even if RLS is broken. Provider
  outages do not count as a successful security check.
- Public monitoring checks Supabase Auth health and a zero-row HEAD request to
  the protected Data API, in addition to pages, release identity and MCP.
  It uses only the public key and never signs in or reads workspace content.

## Publish This Stage Safely

1. Verify `database/20261005-reliability.sql` is already applied. Follow its backup
   and verification files if not. Do not replace the schema with an old copy.
2. Take an independent project backup. A copy in the same database is not an
   off-site backup. Keep database credentials and Google token encryption keys
   outside Git, logs and chat.
3. Apply `database/20261006-account-recovery.sql` first on a disposable Supabase
   project, then on production. The migration is transactional and does not
   delete accounts or change existing task content by itself.
4. Run `database/20261006-account-recovery-verify.sql`. Every result must be true.
   It inspects catalogs only, without reading tasks or invoking destructive RPCs.
5. Apply `database/20261006-storage-lifecycle.sql` after the recovery migration,
   first in staging, then production. Run `database/20261006-storage-lifecycle-verify.sql`;
   all results must be true. Reapplying the older recovery migration afterwards
   replaces the deletion function and removes its lock; reapply lifecycle last.
6. Verify restore and deletion in disposable accounts, including a board image.
   Keep the deleted account's old JWT in the test harness and confirm new uploads
   and downloads are rejected. Exercise an upload concurrent with deletion:
   either the upload is rejected, or deletion refuses until the file is cleaned.
   Never use the owner's working account for these checks.
7. Publish the verified client/Worker only after the database is ready. Old
   clients cannot delete an account with images after the new guard is applied;
   they must update first. Keep this database guard if rolling back the client.
8. Run `npm run verify:production -- --revision FULL_COMMIT_SHA --wait 600`, then
   `npm run check:availability`. The release revision and all asset hashes must
   match. A successful public health check does not prove authenticated sync.

Production database status, 2026-10-06: the reliability migration was already
present. Recovery and Storage lifecycle migrations were applied in that order;
all seven recovery and all eight lifecycle catalog checks returned true. No
restore or deletion RPC was invoked against the owner's working account.

Before migration, a validated checkpoint was saved outside Git: four current
workspaces, encrypted integration rows, SQL function definitions/policies and
Storage metadata. Snapshot contents, Auth data and Storage binaries are not
included. A larger history export failed through SQL Editor. This checkpoint
is release-specific protection, not a full project backup or recovery drill.

Managed concurrency and destructive provider checks remain unverified: staging
and two disposable accounts were unavailable. Production migration was explicitly
authorized after synthetic SQL and mocked-client checks. Do not treat catalog
checks or this publication as completion of the release gates below.

## Release Gates Still Open

The owner deferred disposable-account and two-device verification. This is a
scope decision, not evidence of isolation or synchronization correctness. Other
operational work and actual remaining dependencies are recorded in
[OPERATIONS.md](OPERATIONS.md).

| Gate | Required Evidence | Dependency |
| --- | --- | --- |
| Real account isolation | A/B cannot read or change each other's state, snapshots or files; restore/delete succeed for owner | Two disposable accounts and staging Supabase |
| Two-device sync | Offline edits, deletion, reconnect and account switch preserve expected records on both devices | Disposable accounts; PC and phone/laptop |
| Registration and recovery | Confirmation/recovery emails arrive; expired and reused links fail safely | Owner-selected SMTP provider, DNS and Auth configuration |
| Abuse controls | CAPTCHA, signup/Storage limits, security advisor findings and billing alerts reviewed | Provider dashboards; never weaken MFA or leaked-password protection to pass a check |
| Independent backups | Database restored to a separate project; schema, accounts, workspace counts and files verified | Backup destination, credentials and retention policy |
| Google integration | Separate user connects/revokes Drive and Calendar using production redirects | Google consent configuration and any required verification |
| Real mobile operation | Safari/iOS and Chrome/Android: keyboard, pinch, scroll, selection, resizing and save failures | Physical devices; browser emulation is insufficient |
| Operations | Gated deploy enabled, old bypass disabled, monitoring failures reach the owner, rollback rehearsed | GitHub/Cloudflare settings and alert ownership |
| Legal and commercial | Operator/contact details, privacy/terms, deletion/retention policy, jurisdiction and payment/refund obligations reviewed | Owner decisions and qualified legal/payment advice |

## Backup Recovery Drill

Use a separate project, not production. Record backup timestamp, files included,
successful recovery time and discrepancies. Restore roles/schema/data in the
order supported by the provider, then apply pending migrations and verify RLS.
Check Auth separately: restoring workspace JSON alone does not restore accounts.

Database snapshots and app JSON exports are not binary backups. Supabase board
images need a separate Storage copy; Drive files stay in each user's Drive.
Encrypted Google connection rows also need the separately retained encryption
key. Never test a restored OAuth connection by uploading to a real user's Drive.

Define acceptable data loss and recovery time before choosing backup frequency.
Schedule off-site copying only after a destination and retention budget are
chosen. Do not label the existing local or in-database copies as disaster recovery.

## Local Checks

```powershell
npm test
npm run lint
npm run test:sql-reliability
npm run test:sql-isolation
npm run test:account-recovery
npm run test:settings-reliability
npm run test:dependencies
```

Live tests require `PARSITASKS_LIVE_TEST_ACCOUNTS=1` plus disposable credentials
in the ignored `.security-test.env`, configured locally, not in chat. Do not set
the flag merely to make a skipped test green. Public health monitoring requires
no private credentials; its workflow must be enabled separately in GitHub.

## Scope

Nutrition and other new product features were not developed in this stage.
Paid infrastructure, SMTP, Google verification, payments and legal documents
cannot be truthfully marked complete by local code changes alone. Start with a
limited public beta only after the data, account and recovery gates are verified;
paid launch additionally depends on the commercial and legal gates.
