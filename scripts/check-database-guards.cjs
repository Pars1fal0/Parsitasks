const { publicProvider } = require("./check-availability.cjs");
async function checkDatabaseGuards({ baseUrl = "https://parsitasks.ru", fetchImpl = fetch } = {}) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid production URL");
  const config = await fetchImpl(new URL("/api/public-config", base), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  const provider = publicProvider({ status: config.status, data: await config.json() });
  const response = await fetchImpl(`${provider.origin}/rest/v1/rpc/parsitasks_release_capabilities`, {
    method: "POST", headers: { apikey: provider.key, "Content-Type": "application/json" }, body: "{}",
    redirect: "error", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Database readiness check unavailable; apply and verify the 2026-10-07 migrations before publishing");
  const result = await response.json();
  if (result?.migration !== "2026-10-07" || ["schemaWriteGuard", "imageRetention", "storageAccountGuard", "restoreSafety"].some((name) => result[name] !== true)) {
    throw new Error("Required database guards are missing or disabled; publication refused");
  }
  return { ready: true, migration: result.migration };
}
module.exports = { checkDatabaseGuards };
if (require.main === module) checkDatabaseGuards().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
