const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { verifyRelease } = require("../scripts/check-production.cjs");

const sha = (body) => crypto.createHash("sha256").update(body).digest("hex");
function fixture({ changeAsset = false, anonymousStatus = 401, headers = true, revision = "a".repeat(40), config = true, health = true } = {}) {
  const bodies = { "/index.html": "<html>app</html>", "/auth.html": "<html>auth</html>", "/landing.html": "<html>landing</html>", "/sw.js": "self.addEventListener('fetch', () => {});" };
  const release = { version: "0.28.0", buildHash: "123456abcdef", sourceRevision: revision, assets: Object.fromEntries(Object.entries(bodies).map(([file, body]) => [file, sha(body)])) };
  const requests = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://example.test");
    assert.ok(parsed.searchParams.has("release-check"));
    const file = parsed.pathname;
    requests.push(file);
    const json = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    if (file === "/release.json") return json(release);
    if (file === "/api/public-config") return json(config ? { supabaseUrl: "https://example.supabase.co", anonKey: "sb_publishable_test" } : {});
    if (file === "/mcp/health") return json({ authConfigured: health });
    if (file === "/mcp") return new Response("unauthorized", { status: anonymousStatus });
    const route = { "/app": "/index.html", "/auth": "/auth.html", "/": "/landing.html" }[file] || file;
    const responseHeaders = { "Content-Type": route.endsWith(".html") ? "text/html" : "text/javascript" };
    if (headers) Object.assign(responseHeaders, { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "script-src 'self'; object-src 'none'" });
    return new Response(changeAsset && file === "/sw.js" ? "old build" : bodies[route], { headers: responseHeaders });
  };
  return { release, requests, fetchImpl };
}

module.exports = [
  { name: "verifies exact production assets, page routes and anonymous authentication boundaries", async fn() {
    const mock = fixture();
    const result = await verifyRelease({ baseUrl: "https://example.test/app", expectedRevision: "a".repeat(40), fetchImpl: mock.fetchImpl });
    assert.equal(result.verifiedAssets, 4);
    assert.equal(result.version, "0.28.0");
    assert.ok(mock.requests.includes("/app"));
    assert.ok(mock.requests.includes("/mcp"));
  } },
  { name: "rejects stale revisions, mixed assets, missing headers and unsafe public endpoints", async fn() {
    for (const [options, error] of [
      [{ revision: "b".repeat(40) }, /not deployed/],
      [{ changeAsset: true }, /does not match/],
      [{ headers: false }, /Security headers/],
      [{ anonymousStatus: 200 }, /reject anonymous/],
      [{ config: false }, /authentication configuration/],
      [{ health: false }, /authentication is not configured/],
    ]) {
      const mock = fixture(options);
      await assert.rejects(verifyRelease({ baseUrl: "https://example.test", expectedRevision: "a".repeat(40), fetchImpl: mock.fetchImpl }), error);
    }
  } },
  { name: "rejects release fingerprints that could fetch outside the asset directory", async fn() {
    for (const invalid of ["//other.test/file.js", "/../secret", "/file.js?token=x"]) {
      const mock = fixture();
      mock.release.assets[invalid] = "a".repeat(64);
      await assert.rejects(verifyRelease({ baseUrl: "https://example.test", fetchImpl: mock.fetchImpl }), /Invalid release asset fingerprint/);
      assert.equal(mock.requests.includes(invalid), false);
    }
  } },
];
