# Security

## Architecture

Parsitasks uses one managed Supabase project for all accounts. Every cloud row and board image is tied to `auth.uid()` and protected by Row Level Security. The browser and desktop clients receive only a Supabase publishable key; a `service_role` or `sb_secret_...` key must never be shipped to a client or committed to Git.

The application is local-first. Tasks and the Supabase session are stored on the user's device. Cloud data is encrypted in transit and protected at rest by the hosting provider, but it is not end-to-end encrypted from the database administrator. MCP needs server-readable data to work.

## Production checklist

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

## Residual risks

- A successful XSS in the same origin could access the locally stored Supabase session. The restrictive CSP and text-only DOM rendering reduce this risk but do not make it impossible.
- Public registration and direct Storage uploads still require provider-side CAPTCHA, rate limits, quotas, and monitoring to control abuse.
- Windows builds are distributed without commercial code signing until a signing certificate is configured.
- Cloud records are not end-to-end encrypted because synchronization and MCP operate on structured server-readable data.

## Reporting

Do not publish credentials or private user data in a public issue. Use the repository's private GitHub security advisory flow for a vulnerability report and include reproducible steps, affected version, and impact.
