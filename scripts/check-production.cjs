const crypto = require("node:crypto");

async function verifyRelease({ baseUrl = "https://parsitasks.ru", expectedRevision = "", fetchImpl = fetch } = {}) {
  const origin = new URL(baseUrl).origin;
  const fetchPath = async (path) => {
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new Error("Release asset is outside the application origin");
    url.searchParams.set("release-check", String(Date.now()));
    return fetchImpl(url.href, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(15000) });
  };
  const manifestResponse = await fetchPath("/release.json");
  if (!manifestResponse.ok || !manifestResponse.headers.get("content-type")?.includes("application/json")) throw new Error("Release manifest is not available yet");
  const release = await manifestResponse.json();
  if (!/^[a-f0-9]{12}$/.test(release.buildHash) || !/^\d+\.\d+\.\d+$/.test(release.version)) throw new Error("Invalid release manifest");
  if (expectedRevision && release.sourceRevision !== expectedRevision) throw new Error("The requested revision is not deployed yet");
  const assets = Object.entries(release.assets || {});
  if (!assets.length || assets.length > 2000) throw new Error("Invalid release asset list");
  for (const [path, hash] of assets) {
    if (!/^\/(?!\/)[a-zA-Z0-9_./-]+$/.test(path) || path.includes("..") || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid release asset fingerprint");
    const response = await fetchPath(path);
    if (!response.ok) throw new Error(`Asset unavailable: ${path} (${response.status})`);
    const actual = crypto.createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
    if (actual !== hash) throw new Error(`Asset does not match the release: ${path}`);
  }
  for (const [route, file] of [["/app", "/index.html"], ["/auth", "/auth.html"], ["/", "/landing.html"]]) {
    const response = await fetchPath(route);
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) throw new Error(`Page unavailable: ${route}`);
    const hash = crypto.createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
    if (hash !== release.assets[file]) throw new Error(`Page does not match the release: ${route}`);
    if (response.headers.get("x-content-type-options") !== "nosniff" || !response.headers.get("content-security-policy")?.includes("script-src 'self'")) throw new Error(`Security headers missing: ${route}`);
  }
  const config = await fetchPath("/api/public-config");
  if (!config.ok) throw new Error("Public authentication configuration is unavailable");
  const configuration = await config.json();
  if (!configuration.supabaseUrl || !configuration.anonKey || /^sb_secret_/i.test(configuration.anonKey)) throw new Error("Invalid public authentication configuration");
  const health = await fetchPath("/mcp/health");
  if (!health.ok || !(await health.json()).authConfigured) throw new Error("MCP authentication is not configured");
  const anonymous = await fetchPath("/mcp");
  if (anonymous.status !== 401) throw new Error("MCP must reject anonymous requests");
  return { version: release.version, buildHash: release.buildHash, sourceRevision: release.sourceRevision, verifiedAssets: assets.length };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const expectedRevision = option("--revision", "");
  if (expectedRevision && !/^[a-f0-9]{40}$/.test(expectedRevision)) throw new Error("--revision must be a full Git commit SHA");
  const waitSeconds = Number(option("--wait", "0"));
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 900) throw new Error("--wait must be between 0 and 900 seconds");
  const deadline = Date.now() + waitSeconds * 1000;
  while (true) {
    try {
      const result = await verifyRelease({ baseUrl: option("--url", "https://parsitasks.ru"), expectedRevision });
      console.log(`production verified - ${JSON.stringify(result)}`);
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      console.log(`Waiting for deployment: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(30000, deadline - Date.now())));
    }
  }
}

module.exports = { verifyRelease };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
