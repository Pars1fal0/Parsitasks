# Operating Parsitasks

This runbook describes available tooling, not proof that every provider setting
or recovery scenario is already configured. Never test deletion, restore,
registration or email delivery on the owner's working account.

## Public Monitoring

`Public Availability` runs hourly when the repository variable
`PARSITASKS_MONITORING_ENABLED=1`. The variable was enabled on 2026-10-06.
The workflow reads public endpoints only. It retries a failed probe once, opens
one GitHub bot issue for a confirmed outage, suppresses repeated incident posts,
and closes that issue after recovery. Alerts never include raw provider errors,
tokens, email addresses or workspace content. Repository Issues must be enabled.

Review GitHub notification preferences and watch incident issues to receive
notifications outside GitHub. A scheduled workflow is not a guaranteed SLA or
an independent external monitor; delayed/disabled Actions cannot report their
own outage. Notifications and the first workflow run still need confirmation.

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
