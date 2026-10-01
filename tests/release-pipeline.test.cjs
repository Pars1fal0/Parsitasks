const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { prepareCandidate, verifyCandidate } = require("../scripts/release-candidate.cjs");
const { checkAvailability } = require("../scripts/check-availability.cjs");
const revision = "a".repeat(40);
const sha = (body) => crypto.createHash("sha256").update(body).digest("hex");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-release-test-"));
  const write = (name, body) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
  const assets = { "/index.html": "app", "/auth.html": "auth", "/landing.html": "landing", "/sw.js": "worker shell", "/src/core/app.js": "app code" };
  Object.entries(assets).forEach(([file, body]) => write(`web-dist${file}`, body));
  write("web-dist/_headers", "headers"); write("web-dist/_redirects", "redirects"); write("web-dist/.nojekyll", "");
  write("web-dist/release.json", JSON.stringify({ sourceRevision: revision, version: "0.33.1", buildHash: "a".repeat(12), assets: Object.fromEntries(Object.entries(assets).map(([file, body]) => [file, sha(body)])) }));
  write(".wrangler-build/worker.js", "export default {fetch(){return new Response('ok')}}");
  write("wrangler.jsonc", JSON.stringify({ name: "tasks-and-habits", main: "mcp/worker.mjs", build: { command: "do not run" }, env: { staging: {} }, assets: { binding: "ASSETS", directory: "./web-dist", run_worker_first: true } }));
  write(".dev.vars", "SECRET=not-for-deployment");
  const directory = path.join(root, ".release-candidate");
  const prepare = (sourceDirty = false) => prepareCandidate({ root, expectedRevision: revision, sourceDirty });
  return { root, directory, write, prepare, verify: (options = {}) => verifyCandidate({ directory, expectedRevision: revision, ...options }) };
}

function availabilityFixture({ pageStatus = 200, auth = true, anonymousStatus = 401, headers = true } = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url); requests.push({ route: parsed.pathname, method: options.method, headers: options.headers });
    assert.equal(parsed.origin, "https://example.test"); assert.equal(parsed.searchParams.get("availability-check"), "1");
    const json = (value) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
    if (options.method === "HEAD") return new Response(null, { status: pageStatus, headers: { "Content-Type": "text/html", ...(headers ? { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "script-src 'self'" } : {}) } });
    if (parsed.pathname === "/release.json") return json({ version: "0.33.1", buildHash: "a".repeat(12), sourceRevision: revision });
    if (parsed.pathname === "/api/public-config") return json({ supabaseUrl: "https://example.supabase.co", anonKey: "sb_publishable_test" });
    if (parsed.pathname === "/mcp/health") return json({ ok: true, authConfigured: auth });
    return new Response("unauthorized", { status: anonymousStatus });
  };
  return { requests, fetchImpl };
}

module.exports = [
  { name: "release candidate packages only the built Worker and web assets and seals their exact hashes", fn() {
    const f = fixture(); f.prepare(); const result = f.verify();
    assert.equal(result.sourceRevision, revision); assert.equal(result.sourceDirty, false);
    assert.equal(fs.existsSync(path.join(f.directory, ".dev.vars")), false);
    assert.equal(fs.existsSync(path.join(f.directory, "assets", "_headers")), true);
    assert.equal(fs.existsSync(path.join(f.directory, "assets", ".nojekyll")), true);
    const config = JSON.parse(fs.readFileSync(path.join(f.directory, "wrangler.json")));
    assert.equal(config.no_bundle, true); assert.equal(config.keep_vars, true);
    assert.equal(config.build, undefined); assert.equal(config.env, undefined);
    assert.equal(config.assets.run_worker_first, true);
  } },
  { name: "release verification rejects changed bundles, changed assets, extra files and missing files", fn() {
    for (const change of [
      (f) => f.write(".release-candidate/worker.js", "changed bundle"),
      (f) => f.write(".release-candidate/assets/index.html", "changed app"),
      (f) => f.write(".release-candidate/unlisted.js", "extra"),
      (f) => fs.unlinkSync(path.join(f.directory, "assets", "sw.js")),
    ]) { const f = fixture(); f.prepare(); change(f); assert.throws(() => f.verify(), /fingerprint|missing or unexpected/); }
  } },
  { name: "release verification rejects a different commit and dirty working trees", fn() {
    const f = fixture(); f.prepare(true);
    assert.throws(() => f.verify(), /dirty working-tree/);
    assert.equal(f.verify({ allowDirty: true }).sourceDirty, true);
    assert.throws(() => f.verify({ expectedRevision: "b".repeat(40), allowDirty: true }), /verified commit/);
  } },
  { name: "candidate preparation refuses mixed web builds and files not declared in the release", fn() {
    const changed = fixture(); changed.write("web-dist/index.html", "mixed"); assert.throws(() => changed.prepare(), /changed after/);
    for (const file of [".env", ".env.production", ".dev.vars", ".dev.vars.local", ".security-test.env"]) {
      const unexpected = fixture(); unexpected.write(`web-dist/${file}`, "private-key"); assert.throws(() => unexpected.prepare(), /Invalid candidate path/);
    }
    const wrong = fixture(); assert.throws(() => prepareCandidate({ root: wrong.root, expectedRevision: "b".repeat(40), sourceDirty: false }), /does not match/);
  } },
  { name: "candidate verification rejects a traversal path even in a tampered seal", fn() {
    const f = fixture(); const candidate = f.prepare(); candidate.files["../.dev.vars"] = "a".repeat(64);
    f.write(".release-candidate/candidate.json", JSON.stringify(candidate)); assert.throws(() => f.verify(), /missing or unexpected|fingerprint/);
  } },
  { name: "an independently retained seal fingerprint rejects changes to both the payload and its checksum list", fn() {
    const f = fixture(); const candidate = f.prepare(); const expectedSeal = f.verify().sealDigest;
    assert.equal(f.verify({ expectedSeal }).sourceRevision, revision);
    f.write(".release-candidate/worker.js", "changed worker"); candidate.files["worker.js"] = sha("changed worker");
    f.write(".release-candidate/candidate.json", JSON.stringify(candidate));
    assert.throws(() => f.verify({ expectedSeal }), /seal does not match/);
    assert.throws(() => f.verify({ expectedSeal: "" }), /seal does not match/);
  } },
  { name: "availability checks only public endpoints and never send credentials or write requests", async fn() {
    const f = availabilityFixture(); const result = await checkAvailability({ baseUrl: "https://example.test", fetchImpl: f.fetchImpl });
    assert.equal(result.ok, true); assert.equal(result.checkedEndpoints, 7);
    assert.deepEqual(f.requests.map((request) => request.route), ["/", "/auth", "/app", "/release.json", "/api/public-config", "/mcp/health", "/mcp"]);
    assert.ok(f.requests.every((request) => ["HEAD", "GET"].includes(request.method) && !request.headers.Authorization));
    assert.equal(JSON.stringify(result).includes("sb_publishable"), false);
  } },
  { name: "availability fails on outages, missing headers, invalid authentication and anonymous access", async fn() {
    for (const [options, message] of [[{ pageStatus: 503 }, /Page unavailable/], [{ headers: false }, /Security headers/], [{ auth: false }, /authentication is unavailable/], [{ anonymousStatus: 200 }, /anonymous access/]]) {
      const f = availabilityFixture(options); await assert.rejects(checkAvailability({ baseUrl: "https://example.test", fetchImpl: f.fetchImpl }), message);
    }
  } },
  { name: "availability times out while receiving a response body, not only while connecting", async fn() {
    const f = availabilityFixture();
    const fetchImpl = (url, options) => new URL(url).pathname === "/release.json" ? new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "application/json" } }) : f.fetchImpl(url, options);
    await assert.rejects(checkAvailability({ baseUrl: "https://example.test", fetchImpl, timeoutMs: 5 }), /Availability timeout/);
  } },
  { name: "availability rejects credentials in the URL and insecure public addresses before fetching", async fn() {
    for (const baseUrl of ["https://user:secret@example.test", "http://example.test", "file:///private"]) await assert.rejects(checkAvailability({ baseUrl, fetchImpl: () => { throw new Error("must not fetch"); } }), /Invalid public|requires HTTPS/);
  } },
  { name: "Worker failure logging uses only an opaque identifier and constant route labels", async fn() {
    const { reportRequestFailure } = await import("../mcp/request-error.mjs");
    const logged = [];
    const requestId = reportRequestFailure(new Request("https://example.test/api/google-drive/private-file-id?code=private-oauth-code", { method: "POST", headers: { Authorization: "Bearer secret" }, body: "private-note" }), { logger: { error: (value) => logged.push(value) }, createId: () => "opaque-test-id" });
    assert.equal(requestId, "opaque-test-id");
    assert.deepEqual(JSON.parse(logged[0]), { event: "request_failed", requestId: "opaque-test-id", route: "google-drive", method: "POST", status: 500 });
    for (const secret of ["private-file-id", "private-oauth-code", "secret", "private-note", "example.test"]) assert.equal(logged[0].includes(secret), false);
  } },
  { name: "Google OAuth callback failures keep the redirect but never log the original provider error", async fn() {
    const calendar = await import("../mcp/google-calendar.mjs");
    const drive = await import("../mcp/google-drive.mjs");
    const key = "0123456789abcdef0123456789abcdef";
    const pending = await calendar.encryptJson({ accessToken: "private-session", userId: "test-user", state: "test-state", expiresAt: Date.now() + 600000 }, key);
    const env = { APP_BASE_URL: "https://example.test", SUPABASE_URL: "https://demo.supabase.co", SUPABASE_PUBLISHABLE_KEY: "publishable", GOOGLE_CALENDAR_CLIENT_ID: "client", GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret", GOOGLE_TOKEN_ENCRYPTION_KEY: key };
    for (const [service, cookie, handler] of [["google-calendar", "parsitasks_google_calendar_oauth", calendar.handleGoogleCalendarRequest], ["google-drive", "parsitasks_google_drive_oauth", drive.handleGoogleDriveRequest]]) {
      const logged = [];
      const response = await handler(new Request(`https://example.test/api/${service}/callback?state=test-state&code=private-code`, { headers: { Cookie: `${cookie}=${pending}` } }), env, {
        fetch: async (url) => { if (String(url).includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "test-user" })); throw new Error("private-email@example.test private-token"); },
        logger: { error: (value) => logged.push(value) }, createId: () => "test-request-id",
      });
      assert.equal(response.status, 302); assert.match(response.headers.get("location"), /callback_failed/);
      assert.equal(response.headers.get("X-Request-ID"), "test-request-id");
      assert.equal(logged.length, 1); assert.equal(JSON.parse(logged[0]).route, service);
      assert.doesNotMatch(logged[0], /private-|client-secret/);
    }
  } },
  { name: "production job depends on successful verification and deploys only a sealed artifact", fn() {
    const workflow = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/verification.yml"), "utf8");
    assert.match(workflow, /needs: verify/); assert.match(workflow, /PARSITASKS_GATED_DEPLOY_ENABLED == '1'/);
    assert.match(workflow, /environment:\s*\n\s*name: production/);
    assert.match(workflow, /release:verify/); assert.match(workflow, /--config \.release-candidate\/wrangler.json --no-bundle/);
    assert.match(workflow, /github.event_name != 'pull_request'/);
    const monitoring = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/availability.yml"), "utf8");
    assert.match(monitoring, /PARSITASKS_MONITORING_ENABLED == '1'/);
    assert.doesNotMatch(monitoring, /CLOUDFLARE_API_TOKEN|SUPABASE_PASSWORD/);
    for (const [, ref] of monitoring.matchAll(/uses:\s*[^\s]+@([^\s#]+)/g)) assert.match(ref, /^[a-f0-9]{40}$/);
    const yaml = require("yaml");
    const config = yaml.parse(workflow); const publicChecks = yaml.parse(monitoring);
    assert.equal(config.jobs.deploy.needs, "verify");
    assert.equal(config.jobs.deploy.environment.name, "production");
    assert.equal(config.permissions.contents, "read");
    assert.equal(config.on.pull_request_target, undefined);
    assert.equal(publicChecks.on.schedule[0].cron, "17 * * * *");
    const recheck = config.jobs.deploy.steps.find((step) => step.name === "Recheck artifact fingerprints and source revision");
    assert.equal(recheck.env.EXPECTED_CANDIDATE_SEAL, "${{ needs.verify.outputs.candidate_seal }}");
    assert.ok(recheck.run.includes('--seal "$EXPECTED_CANDIDATE_SEAL"'));
  } },
];
