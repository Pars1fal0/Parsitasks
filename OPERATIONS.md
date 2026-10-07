# Operating Parsitasks

This runbook describes available tooling, not proof that every provider setting
or recovery scenario is already configured. Never test deletion, restore,
registration or email delivery on the owner's working account.

## Public Monitoring

`Public Availability` runs every five minutes when the repository variable
`PARSITASKS_MONITORING_ENABLED=1`. The variable was enabled on 2026-10-06.
The workflow reads public endpoints only. It retries a failed probe once, opens
one GitHub bot issue for a confirmed outage, suppresses repeated incident posts,
and closes that issue after recovery. Alerts never include raw provider errors,
tokens, email addresses or workspace content. Repository Issues must be enabled.

Review GitHub notification preferences and watch incident issues to receive
notifications outside GitHub. A scheduled workflow is not a guaranteed SLA or
an independent external monitor; delayed/disabled Actions cannot report their
own outage. Notifications and the first workflow run still need confirmation.
An independent host can run `npm run monitor:public` every five minutes using
`PARSITASKS_INCIDENT_WEBHOOK` and `PARSITASKS_MONITOR_STATE_FILE` (outside Git).
Use `npm run monitor:public -- --test-alert` to confirm delivery. The monitor
rechecks failures, alerts only on outage/recovery transitions, and retries a
failed alert on the next invocation. GitHub can use the same webhook secret;
it remains a secondary monitor, not the independent host.

## Encrypted Local Backups

`backup-bundle.cjs` packages an existing export directory. It does not generate
a SQL dump, download Storage or verify database recovery. It uses scrypt and
AES-256-GCM with random salt/nonce, validates every file checksum, refuses
symlinks and overwrites, and extracts only into a new local directory. Supported
encoded payload size is 128 MiB. Larger exports need another backup tool.

Configure `PARSITASKS_BACKUP_PASSPHRASE` locally, never as a command-line argument.
Use a random passphrase of at least 32 characters. Preserve a recoverable key
separately from the encrypted archive and retain an independent copy outside the
source computer. `.backup.env` and `*.parsibak` are ignored by Git; do not place
raw database exports, Auth records or keys in the repository.

```powershell
npm run backup:seal -- --input "D:\Backups\export" --output "D:\Backups\release.parsibak" --scope "Describe included data and exclusions"
npm run backup:verify -- --file "D:\Backups\release.parsibak"
npm run backup:unpack -- --file "D:\Backups\release.parsibak" --output "D:\Backups\new-recovery-directory"
```

The release checkpoint from 2026-10-06 was encrypted and unpacked locally with
all four source file hashes matching. It excludes snapshot contents, Auth data
and Storage binaries. Its key is protected with Windows DPAPI CurrentUser in a
separate local directory. This protects the key at rest but is not portable key
escrow: loss of the Windows profile or source disk can still prevent recovery.
This is not a full backup or a managed Supabase restore drill.

A project backup requires database roles/schema/data, Auth records, custom
Auth/Storage policies and triggers, Storage binaries/metadata, provider settings
and separately retained encryption keys. Keep the matching Git revision too.
Use the provider-supported [Supabase backup/restore process](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
which treats Storage file transfer separately from SQL. Do not restore the entire
raw managed schema into production using an unreviewed `pg_dump`.

Define retention and acceptable data loss before enabling scheduled exports.
Choose an independent destination and configure credentials locally. Only a
successful restore into a separate project can close the database recovery gate.

## Website Rollback

`Restore Verified Website` is a manually dispatched production workflow. Enter
the ID of a successful master `Application Verification` run and `ROLLBACK`.
The tooling refuses failed/PR/foreign/expired candidates, verifies the downloaded
ZIP's GitHub SHA-256 digest, validates paths, then checks all sealed candidate
files before deployment. It redeploys the retained Worker and client without
rebuilding old source, keeps production secrets/variables and verifies the exact
public revision and assets afterwards.

Required: retained candidate artifact, Cloudflare deployment secrets and access
to the production environment. Artifacts currently expire after 14 days. Keep a
trusted verified candidate outside that window if longer rollback is required.
Do not choose a release older than the compatible workspace schema. Never roll
back database security policies to make an old client work. A rollback drill on
real infrastructure remains outstanding; synthetic tooling checks are not a drill.

## Registration and Recovery

Recovery requests target the dedicated `/auth` page using the provider's query
parameter. Callback tokens are removed immediately from the address bar; a
tab-scoped, token-free marker preserves the recovery form on reload. Server
session validation runs before exposing the password form. Expired/malformed
callbacks leave an existing account session intact and show a request-new-link
message instead of replacing it. Password changes are guarded against an account
switch while waiting for the response.

Still verify: custom SMTP, sender-domain DNS, actual confirmation/recovery mail
delivery, provider callback allowlist, expired/reused links, CAPTCHA compatibility
and rate limits. Do not increase production email limits to mask a missing SMTP
service. Do not enable CAPTCHA before the client supports its required token.

Observed in production dashboards on 2026-10-06: custom SMTP is not configured,
CAPTCHA and leaked-password prevention are disabled. Existing limits are 30
signup/signin requests, 30 token verifications and 150 refreshes per five minutes
per IP. These were inspected, not relaxed or changed. GitHub contains no repository
or environment deployment secrets; automatic gated deployment remains disabled.

The 2026-10-07 code removes the optional deployment switch: successful master
verification now attempts the sealed deployment and fails visibly if credentials
or database guards are missing. This does not provision GitHub secrets. The old
`build:cloudflare` source-build command now fails closed; disable that old build
integration in Cloudflare before pushing this change. Do not replace it with
another unverified source-build command. Use `npm run verify:release` locally;
it runs the same checks declared by the verification workflow.

## Database Changes From 2026-10-07

After the existing recovery and Storage lifecycle migrations, apply in staging:
1. `database/20261007-write-compatibility.sql`.
2. `database/20261007-image-retention.sql`.
3. `database/20261007-release-capabilities.sql`.

Verify staging before applying to production. `npm run verify:database` checks
only public readiness flags and refuses publication if required guards are
missing. It never reads accounts or workspaces. Schema downgrade is rejected for
direct authenticated writes, while the existing owner-only, revision-checked
restore RPC still works. Image collection protects current workspaces and every
retained database snapshot, retains unused files for at least 30 days, and uses
durable claims to prevent a concurrent/stale write restoring a removed file.
Uploads and collection serialize on the workspace row. Binaries are deleted
through Storage API, never by deleting `storage.objects` metadata directly.
Collection runs at most once per day per active client session, 100 files per
batch. A failed Storage deletion leaves the claim retryable on a later run.
Old standalone JSON/local backups beyond that window may refer to expired files;
they are not binary backups. Managed-provider concurrency is still a staging
test requirement, not something the PGlite tests prove.

Production status, 2026-10-07: all three migrations above were applied in order
after the owner explicitly authorized direct production migration without a
separate staging project. The public readiness check reports all four guards
enabled. No owner workspace was restored/deleted and no garbage-collection RPC
was invoked during migration. Managed concurrency and staging remain unverified.

## Collecting An Independent Project Backup

`npm run backup:collect` requires Supabase CLI/Docker and these locally configured
variables, never committed or sent through chat:

- `PARSITASKS_BACKUP_DIRECTORY`: private directory outside the repository.
- `PARSITASKS_BACKUP_DB_URL`: database connection with read/export access.
- `PARSITASKS_BACKUP_SUPABASE_URL` and `PARSITASKS_BACKUP_SERVICE_KEY`: privileged
  Storage read access; this key is not included in the backup.
- `PARSITASKS_BACKUP_PASSPHRASE`: separate passphrase, at least 32 characters.
- `PARSITASKS_BACKUP_PROVIDER_SETTINGS_FILE`: reviewed JSON export of provider
  configuration, including Auth/SMTP/redirect settings needed for recovery.
- `PARSITASKS_GOOGLE_KEY_ESCROW_FILE`: existing Google encryption key kept
  separately from the encrypted backup. Only its fingerprint is recorded.

The collector exports roles, application schema and public/Auth/Storage data,
downloads the actual Storage binaries, checks a second inventory for changes,
includes migration SQL and provider configuration, then encrypts/authenticates
the bundle. Only after successful sealing does it remove its own newly created
plaintext directory. Failures intentionally preserve partial exports: inspect
and protect those directories. On Windows, select a directory with private ACLs;
POSIX mode flags alone do not establish Windows access control.

Use a maintenance window, copy the encrypted result to an independent destination
and retain its passphrase/key separately. The tool supports at most 64 MiB of
source data and refuses larger or incomplete exports instead of skipping files.
Larger projects need an external backup system. Restore into a separate compatible
Supabase project following the [provider process](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
reapply managed-schema policies from the included migrations, verify accounts,
snapshot counts and every Storage binary. A collected bundle explicitly records
`restoreVerified: false`; collection is not a recovery drill.

## Enabling CAPTCHA

The client supports Cloudflare Turnstile for signup, password login and recovery.
Set the public `TURNSTILE_SITE_KEY` Worker variable and configure its matching
secret in Supabase Auth, not in client code. Only the auth page permits the
challenge script/frame; the rest of the app retains its restrictive CSP.
Configured challenges fail closed when unavailable or expired. Verify in staging
on desktop and mobile before enabling provider enforcement in production.
Actual SMTP delivery, leaked-password prevention and disposable-account tests
remain dependent on provider setup and must not be marked passed by UI mocks.

## Local Recovery, Image Cache And Build Safety

Local automatic and pre-import backups carry their workspace owner. Recovery
never assigns an untagged legacy backup to a signed-in account: such copies
remain untouched and are eligible only for the local unsigned workspace.
The backup slot remains shared, not a per-account backup history. Export a
reviewed file separately when long-term retention across account switches is
needed. JSON backups do not contain Storage image binaries.

A client refuses local writes over a newer workspace schema, including a newer
recovery backup behind a corrupt primary document. Export retains that original
document and its unknown fields. Update the application before editing; the UI
can display the known subset but is not a fully disabled read-only editor.
Imports over 16 MiB or from a newer schema are refused. Import/restore also stops
if local state changed while its confirmation was open.

IndexedDB board cache keys include provider and user. Recoverable cloud cache
is limited to 64 MiB / 200 entries and expires after 30 days using LRU eviction.
Legacy rows without proven ownership and local-only copies are not evicted;
they can exceed these limits. Do not clear them as a substitute for recovery.
Delayed network responses are rejected after an owner change, and writes report
success only after the IndexedDB transaction completes.

Web builds use a fresh staging directory and retain/restore the previous output
on compilation or replacement failures. Stop the local Wrangler/dev server
before `npm run verify:release`: Windows can lock the output directory. A lock
fails the build visibly without intentionally deleting the previous output.

## Ownership and Release Decisions

The owner must choose public support contact, operator identity/jurisdiction,
data retention and backup budget. Privacy notices must match actual local-first
storage, administrator access, Supabase, Cloudflare and optional Google services;
do not promise end-to-end encryption or instantaneous removal from backups.
Legal/payment terms require review before a paid launch. No invented operator,
support address, refund policy or legal-compliance claim is supplied by this code.

Real Android/iOS operation and email delivery cannot be proven by mocked browser
tests. The owner deferred disposable-account and two-device checks; they remain
unverified rather than passed. Nutrition and portable desktop binaries are not
changed in this stage.
