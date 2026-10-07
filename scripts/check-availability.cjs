const { verifyRelease } = require("./check-production.cjs");

async function checkAvailability({ baseUrl = "https://parsitasks.ru", fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw new Error("Invalid availability timeout");
  const base = new URL(baseUrl);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password) throw new Error("Invalid public application URL");
  if (base.protocol === "http:" && !["127.0.0.1", "localhost"].includes(base.hostname)) throw new Error("Public monitoring requires HTTPS");
  const checks = [];
  const request = async (route, method = "GET", origin = base.origin, headers = {}) => {
    const url = new URL(route, origin);
    if (origin === base.origin) url.searchParams.set("availability-check", "1");
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error(`Availability timeout: ${route}`)); }, timeoutMs); });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetchImpl(url, { method, redirect: "manual", headers: { "Cache-Control": "no-cache", ...headers }, signal: controller.signal });
        let data = null;
        if (method === "GET" && route !== "/mcp") {
          if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(`Invalid response type: ${route}`);
          const reader = response.body?.getReader();
          if (!reader) throw new Error(`Missing response body: ${route}`);
          let size = 0; const chunks = [];
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.length;
            if (size > 256 * 1024) { await reader.cancel(); throw new Error(`Public response is too large: ${route}`); }
            chunks.push(Buffer.from(value));
          }
          try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error(`Invalid public JSON: ${route}`); }
        } else await response.body?.cancel();
        return { status: response.status, headers: response.headers, data };
      })()]);
    } finally { clearTimeout(timer); }
  };
  for (const route of ["/", "/auth", "/app"]) {
    const response = await request(route, "HEAD");
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) throw new Error(`Page unavailable: ${route}`);
    if (response.headers.get("x-content-type-options") !== "nosniff" || !response.headers.get("content-security-policy")?.includes("script-src 'self'")) throw new Error(`Security headers missing: ${route}`);
    checks.push(route);
  }
  const manifest = await request("/release.json");
  if (manifest.status !== 200 || !/^\d+\.\d+\.\d+$/.test(manifest.data?.version || "") || !/^[a-f0-9]{12}$/.test(manifest.data?.buildHash || "")
    || !/^[a-f0-9]{40}$/.test(manifest.data?.sourceRevision || "")) throw new Error("Release identity is unavailable");
  const config = await request("/api/public-config");
  const provider = publicProvider(config);
  const providerHeaders = { apikey: provider.key };
  const auth = await request("/auth/v1/health", "GET", provider.origin, providerHeaders);
  if (auth.status !== 200 || !auth.data?.version || !auth.data?.name) throw new Error("Supabase Auth is unavailable");
  // HEAD + limit=0 checks the protected relation without retrieving user records.
  const database = await request("/rest/v1/rhythm_states?select=user_id&limit=0", "HEAD", provider.origin, providerHeaders);
  if (![401, 403].includes(database.status)) throw new Error("Supabase Data API is unavailable or anonymous table access is enabled");
  const health = await request("/mcp/health");
  if (health.status !== 200 || health.data?.ok !== true || health.data?.authConfigured !== true) throw new Error("MCP authentication is unavailable");
  const anonymous = await request("/mcp");
  if (anonymous.status !== 401) throw new Error("MCP must reject anonymous access");
  return { ok: true, version: manifest.data.version, buildHash: manifest.data.buildHash, sourceRevision: manifest.data.sourceRevision,
    checkedEndpoints: checks.length + 6, backend: { auth: "available", anonymousStateAccess: "blocked" } };
}

function publicProvider(config) {
  const fail = () => { throw new Error("Public authentication configuration is unavailable"); };
  if (config.status !== 200) fail();
  let url;
  try { url = new URL(config.data?.supabaseUrl); } catch { fail(); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") fail();
  const key = config.data?.anonKey;
  if (typeof key !== "string" || key.length > 4096) fail();
  if (!/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key)) {
    try {
      const parts = key.split(".");
      if (parts.length !== 3 || JSON.parse(Buffer.from(parts[1], "base64url")).role !== "anon") fail();
    } catch { fail(); }
  }
  return { origin: url.origin, key };
}

async function main() {
  const args = process.argv.slice(2);
  const url = args.includes("--url") ? args[args.indexOf("--url") + 1] : "https://parsitasks.ru";
  const result = args.includes("--full") ? await verifyRelease({ baseUrl: url }) : await checkAvailability({ baseUrl: url });
  console.log(`availability ok - ${JSON.stringify(result)}`);
}
module.exports = { checkAvailability, publicProvider };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
