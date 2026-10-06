const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".security-test.env");
const APP_BASE_URL = "https://parsitasks.ru";
const CANARY_TITLE = "PENTEST-CANARY-2026";
const request = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(15000), redirect: "error" });

if (process.env.PARSITASKS_LIVE_TEST_ACCOUNTS !== "1") {
  console.error("Live checks require two disposable test accounts. Set PARSITASKS_LIVE_TEST_ACCOUNTS=1 only after selecting them; personal accounts must not be used.");
  process.exit(2);
}

loadEnvFile(ENV_FILE);

const required = [
  "PARSITASKS_TEST_A_EMAIL",
  "PARSITASKS_TEST_A_PASSWORD",
  "PARSITASKS_TEST_B_EMAIL",
  "PARSITASKS_TEST_B_PASSWORD",
];
const missing = required.filter((name) => !String(process.env[name] || "").trim());
if (missing.length) {
  console.error(`Missing variables: ${missing.join(", ")}`);
  console.error("Copy .security-test.env.example to .security-test.env and use two disposable accounts.");
  process.exit(2);
}

async function run() {
  const config = await publicConfig();
  const first = await signIn(config, "A", process.env.PARSITASKS_TEST_A_EMAIL, process.env.PARSITASKS_TEST_A_PASSWORD);
  const second = await signIn(config, "B", process.env.PARSITASKS_TEST_B_EMAIL, process.env.PARSITASKS_TEST_B_PASSWORD);
  if (first.userId === second.userId) throw new Error("A and B must be different accounts");

  const testUserIds = [first.userId, second.userId];
  first.rows = await readRows(config, first, testUserIds);
  second.rows = await readRows(config, second, testUserIds);
  first.ownRow = ownRow(first);
  second.ownRow = ownRow(second);

  const canaryOwners = [first, second].filter((account) => hasCanary(account.ownRow.state));
  if (canaryOwners.length !== 1) {
    throw new Error(canaryOwners.length
      ? `The canary task must exist in exactly one account, found in ${canaryOwners.length}`
      : `Task ${CANARY_TITLE} was not found. Open the test account and wait for cloud sync.`);
  }

  const victim = canaryOwners[0];
  const attacker = victim === first ? second : first;
  const victimRow = victim.ownRow;
  console.log(`Canary owner: account ${victim.label}; attacker: account ${attacker.label}`);

  const findings = [];
  [first, second].forEach((account) => {
    const foreignRows = account.rows.filter((row) => row.user_id !== account.userId);
    if (foreignRows.length) findings.push(`account ${account.label} can list ${foreignRows.length} foreign state row(s)`);
  });
  const leakedRows = await crossRead(config, attacker, victim.userId, "rhythm_states", "user_id,state,updated_at");
  if (leakedRows.length) findings.push("attacker can read the victim state");

  const leakedSnapshots = await crossRead(
    config,
    attacker,
    victim.userId,
    "rhythm_state_snapshots",
    "id,user_id,created_at",
  );
  if (leakedSnapshots.length) findings.push("attacker can read victim snapshots");

  const crossWrite = await tryCrossAccountWrite(config, attacker, victimRow);
  if (crossWrite.allowed) {
    findings.push("attacker can update the victim state");
  }

  const storage = await tryCrossAccountStorage(config, attacker, victim);
  if (storage.allowed) findings.push("attacker can upload into the victim storage path");

  const mcpLeak = await mcpCanSeeCanary(attacker);
  if (mcpLeak) findings.push("attacker MCP session can find the victim canary task");

  if (findings.length) {
    console.error("SECURITY TEST FAILED:");
    findings.forEach((finding) => console.error(`- ${finding}`));
    process.exitCode = 1;
    return;
  }

  console.log("security live ok - cross-account state, snapshots, writes and storage are isolated");
}

async function publicConfig() {
  const response = await request(`${APP_BASE_URL}/api/public-config`, { headers: { Accept: "application/json" } });
  const body = await readJson(response);
  if (!response.ok || !body?.supabaseUrl || !body?.anonKey) throw remoteError("Public config unavailable", response, body);
  return { anonKey: body.anonKey, supabaseUrl: String(body.supabaseUrl).replace(/\/+$/, "") };
}

async function signIn(config, label, email, password) {
  const response = await request(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: config.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: String(email).trim().toLowerCase(), password: String(password) }),
  });
  const body = await readJson(response);
  if (!response.ok || !body?.access_token || !body?.user?.id) throw remoteError(`Account ${label} sign-in failed`, response, body);
  return { accessToken: body.access_token, label, userId: body.user.id };
}

async function readRows(config, account, testUserIds) {
  // Even with broken RLS, restrict diagnostics to the two authorized test accounts.
  if (testUserIds.length !== 2 || testUserIds.some((id) => !/^[a-f0-9-]{36}$/i.test(id))) throw new Error("Invalid test account IDs");
  const filter = `user_id=in.(${testUserIds.map(encodeURIComponent).join(",")})`;
  const response = await request(
    `${config.supabaseUrl}/rest/v1/rhythm_states?select=user_id,user_key,state,client_updated_at,updated_at&${filter}&limit=2`,
    { headers: authHeaders(config, account) },
  );
  const body = await readJson(response);
  if (!response.ok) throw remoteError(`Account ${account.label} state read failed`, response, body);
  return Array.isArray(body) ? body : [];
}

function ownRow(account) {
  const row = account.rows.find((item) => item.user_id === account.userId);
  if (!row) throw new Error(`Account ${account.label} has no cloud state. Open it and wait for sync.`);
  return row;
}

async function crossRead(config, attacker, victimId, table, select) {
  const query = `select=${encodeURIComponent(select)}&user_id=eq.${encodeURIComponent(victimId)}&limit=5`;
  const response = await request(`${config.supabaseUrl}/rest/v1/${table}?${query}`, {
    headers: authHeaders(config, attacker),
  });
  const body = await readJson(response);
  if (!response.ok) throw remoteError(`Cross-read probe failed for ${table}`, response, body);
  return Array.isArray(body) ? body : [];
}

async function tryCrossAccountWrite(config, attacker, victimRow) {
  const query = [
    `user_id=eq.${encodeURIComponent(victimRow.user_id)}`,
    "select=user_id,state,client_updated_at,updated_at",
  ].join("&");
  const response = await request(`${config.supabaseUrl}/rest/v1/rhythm_states?${query}`, {
    method: "PATCH",
    headers: { ...authHeaders(config, attacker), Prefer: "return=representation" },
    body: JSON.stringify({ client_updated_at: victimRow.client_updated_at }),
  });
  const body = await readJson(response);
  if ([401, 403].includes(response.status)) return { allowed: false };
  if (!response.ok) throw remoteError("Cross-write probe failed", response, body);
  return { allowed: Array.isArray(body) && body.length > 0, row: Array.isArray(body) ? body[0] : null };
}

async function tryCrossAccountStorage(config, attacker, victim) {
  const assetName = `security-probe-${Date.now()}.png`;
  const objectPath = `${victim.userId}/${assetName}`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const response = await request(`${config.supabaseUrl}/storage/v1/object/board-images/${objectPath}`, {
    method: "POST",
    headers: { ...authHeaders(config, attacker), "Content-Type": "image/png", "x-upsert": "false" },
    body: png,
  });
  if (!response.ok) {
    const body = await readJson(response);
    if ([401, 403].includes(response.status) || (response.status === 400 && (String(body?.statusCode) === "403" || /row-level security|unauthorized/i.test(String(body?.message || body?.error || ""))))) return { allowed: false };
    throw remoteError("Cross-storage probe failed", response, body);
  }

  const cleanup = await request(`${config.supabaseUrl}/storage/v1/object/board-images/${objectPath}`, {
    method: "DELETE",
    headers: authHeaders(config, victim),
  });
  if (!cleanup.ok) console.warn(`Cross-storage proof remains at ${objectPath}; remove it from Supabase Storage.`);
  return { allowed: true };
}

async function mcpCanSeeCanary(attacker) {
  const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new Client({ name: "parsitasks-security-live", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${APP_BASE_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${attacker.accessToken}` } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "search", arguments: { query: CANARY_TITLE, limit: 10 } });
    return JSON.stringify(result?.structuredContent || result?.content || {}).includes(CANARY_TITLE);
  } finally {
    await transport.close().catch(() => {});
  }
}

function authHeaders(config, account) {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${account.accessToken}`,
    "Content-Type": "application/json",
  };
}

function hasCanary(state) {
  return Array.isArray(state?.tasks) && state.tasks.some((task) => task?.title === CANARY_TITLE);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, "utf8").split(/\r?\n/).forEach((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) return;
    const separator = clean.indexOf("=");
    if (separator < 1) return;
    const name = clean.slice(0, separator).trim();
    let value = clean.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(name in process.env)) process.env[name] = value;
  });
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text }; }
}

function remoteError(message, response, body) {
  const code = typeof body?.code === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(body.code) ? ` (${body.code})` : "";
  return new Error(`${message}: HTTP ${response.status}${code}`);
}

run().catch((error) => {
  console.error(`security live failed: ${error.message}`);
  process.exitCode = 1;
});
