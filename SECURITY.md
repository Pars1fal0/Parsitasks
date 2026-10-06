# Security

## Architecture

Parsitasks uses one managed Supabase project for all accounts. Every cloud row and board image is tied to `auth.uid()` and protected by Row Level Security. The browser and desktop clients receive only a Supabase publishable key; a `service_role` or `sb_secret_...` key must never be shipped to a client or committed to Git.

The application is local-first. Tasks and the Supabase session are stored on the user's device. Cloud data is encrypted in transit and protected at rest by the hosting provider, but it is not end-to-end encrypted from the database administrator. MCP needs server-readable data to work.

## Production checklist

Before publishing 0.34.16, apply `database/20261006-account-recovery.sql` after
the reliability migration below, first in staging, then in production. Run the
catalog-only `database/20261006-account-recovery-verify.sql`; all columns must
be true. Then apply `database/20261006-storage-lifecycle.sql` and run its matching
`*-verify.sql`. Keep this migration last: it adds locking to account deletion.
The new client deliberately has no non-atomic restore fallback.
`npm run test:sql-isolation` exercises the full schema on synthetic PostgreSQL
accounts, not the managed Auth/Storage services. `npm run test:account-recovery`
uses isolated browser profiles with every HTTP request mocked. Live provider
checks still need two disposable accounts; never use personal workspaces.
The remaining deployment, off-site backup, email and release gates are listed
in the root `LAUNCH_CHECKLIST.md`.

For the 0.34.11 reliability changes, apply `database/20261005-reliability.sql`
before deploying the Worker. Validate it against a disposable Supabase project
first. `npm run test:sql-reliability` executes the migration in disposable PostgreSQL
with synthetic roles and accounts. It does not prove live Supabase RLS isolation,
provider configuration, backup restoration, or production migration status.

1. Run the current `database/supabase-schema.sql` once in the production Supabase SQL Editor after every security migration.
2. Set `SUPABASE_PUBLISHABLE_KEY` in Cloudflare Workers. The legacy `SUPABASE_ANON_KEY` remains supported temporarily. Never use `SUPABASE_SECRET_KEY`, `sb_secret_...`, or `service_role`.
3. In Supabase Auth, enable email confirmation, require at least eight password characters, enable leaked-password protection, and configure CAPTCHA before opening public registration broadly.
4. Keep the Site URL and allowed redirects restricted to `https://parsitasks.ru`.
5. Review Supabase Security Advisor and Auth audit logs after schema or authentication changes.
6. Keep Cloudflare and GitHub accounts protected with MFA. Desktop release Actions are pinned to immutable commit SHAs.

## Current controls

- authenticated-only RLS and least-privilege table grants;
- private per-user Storage paths for board images;
- strict CSP without inline or remote scripts;
- no `innerHTML`, `eval`, or renderer Node.js integration;
- Electron context isolation, sandboxing, blocked permission requests, limited navigation, and validated IPC senders;
- optimistic concurrency, deletion tombstones, safety backups, and account-switch isolation;
- MCP bearer-token verification, explicit destructive confirmations, request throttling, and action history;
- dependency audit and automated security regression tests.

Cloud restoration locks the owner's current row, checks its revision, and
explicitly checkpoints the current workspace even within the snapshot throttle
window. The client refuses newer workspace schemas. This client-side guard
does not retroactively update previously distributed clients.

Account deletion removes board image binaries using the authenticated Storage
API before invoking the owner-only SQL RPC. SQL refuses deletion while image
metadata remains. Partial cleanup can remove some images before an error; the
account remains available for retry. Direct SQL deletion of Storage metadata is
not supported, because it does not remove the underlying objects.
Storage policies also require a live Auth identity, rather than trusting a JWT
that may remain valid after account deletion. Write checks take a key-share lock
on that identity; deletion takes an update lock before checking remaining images.
Read-only listing uses a separate stable helper without locks. The guard is
restrictive, so another permissive policy cannot bypass it for a deleted account.
Synthetic tests cover stale-token reads and mutations; concurrent requests through
managed Storage/Auth still need staging verification with disposable accounts.

Settings export/import uses an explicit UI preference allowlist, a 256 KiB file
limit and schema/owner checks. Imports cannot set cloud credentials and partial
files do not overwrite unrelated preference timestamps. Failed local persistence
is reported, not presented as a successful import or privacy setting change.

The migration replaces per-instance MCP counters with an atomic,
authenticated-only database RPC (120 requests per account per minute). The
counter table has no client grants. A failed limiter check fails closed with
503. It also bounds state writes and throttles automatic state snapshots to
one per five minutes, retaining at most 30 versions and 16 MiB of snapshot JSON
per account. These are application quotas, not a substitute for infrastructure
rate limits, billing alerts, or tested backup restoration.

## Residual risks

- A successful XSS in the same origin could access the locally stored Supabase session. The restrictive CSP and text-only DOM rendering reduce this risk but do not make it impossible.
- Public registration and direct Storage uploads still require provider-side CAPTCHA, rate limits, quotas, and monitoring to control abuse.
- Windows builds are distributed without commercial code signing until a signing certificate is configured.
- Cloud records are not end-to-end encrypted because synchronization and MCP operate on structured server-readable data.
- Local snapshots and snapshots in the same database are not an independent
  disaster-recovery backup. A full project restore, including Auth and Storage,
  still needs a separately retained backup and a successful staging drill.
- Public health monitoring verifies Auth availability and anonymous Data API
  rejection, not authenticated sync, email delivery or every RLS policy.
- Already-issued Storage signed URLs are independent of subsequent JWT/account
  checks and can remain usable until expiration. The active-account guard is not
  a guarantee of immediate revocation of every previously issued download URL.

## Reporting

Do not publish credentials or private user data in a public issue. Use the repository's private GitHub security advisory flow for a vulnerability report and include reproducible steps, affected version, and impact.
