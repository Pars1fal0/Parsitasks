const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { seal, verify, unpack, safeName } = require("../scripts/backup-bundle.cjs");
const { updateIncident } = require("../scripts/availability-incident.cjs");
const { resolveRollback } = require("../scripts/resolve-rollback.cjs");
const { downloadRollback } = require("../scripts/download-rollback.cjs");
const password = "synthetic-backup-key-not-a-real-secret";

module.exports = [
  { name: "incident webhook delivery retries failures and records success before suppressing later alerts", async fn() {
    let issue = { number: 42, title: "[Monitoring] Parsitasks availability incident", body: "Synthetic incident", user: { login: "github-actions[bot]" } };
    let deliveryFails = true; const events = []; let patches = 0;
    const fetchImpl = async (url, init) => {
      if (new URL(url).host === "alerts.example.test") {
        assert.equal(init.headers.Authorization, undefined, "GitHub credentials must not reach the webhook");
        if (deliveryFails) return new Response(null, { status: 503 });
        events.push(JSON.parse(init.body).event); return new Response(null, { status: 204 });
      }
      if (init.method === "GET") return Response.json(issue.state === "closed" ? [] : [issue]);
      if (init.method === "PATCH") { patches++; issue = { ...issue, ...JSON.parse(init.body) }; }
      return Response.json({});
    };
    const config = { token: "synthetic", repository: "owner/project", runId: "123", healthy: false,
      webhook: "https://alerts.example.test/hook", fetchImpl };
    await assert.rejects(updateIncident(config), /Alert delivery failed/); assert.equal(patches, 0);
    deliveryFails = false;
    assert.equal((await updateIncident(config)).action, "already-open");
    assert.match(issue.body, /External outage alert delivered/);
    await updateIncident(config); assert.deepEqual(events, ["outage"]);
    assert.equal((await updateIncident({ ...config, healthy: true })).action, "resolved");
    assert.deepEqual(events, ["outage", "recovered"]); assert.equal(issue.state, "closed");
  } },
  { name: "encrypted backups verify and unpack byte-identical synthetic files without restoring a database", fn() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-backup-test-"));
    try {
      const input = path.join(root, "input"); fs.mkdirSync(input);
      fs.writeFileSync(path.join(input, "data.sql"), "synthetic private content");
      fs.mkdirSync(path.join(input, "storage")); fs.writeFileSync(path.join(input, "storage", "image.bin"), Buffer.from([0, 255, 12]));
      const file = path.join(root, "copy.parsibak");
      const result = seal({ directory: input, output: file, password, scope: "Synthetic SQL and one binary; no real accounts" });
      assert.equal(result.files, 2); assert.equal(result.bytes, Buffer.byteLength("synthetic private content") + 3);
      assert.equal(fs.readFileSync(file).includes(Buffer.from("synthetic private content")), false);
      assert.deepEqual(verify({ file, password }).scope, result.scope);
      const output = path.join(root, "restored"); assert.equal(unpack({ file, password, directory: output }).databaseRestored, false);
      assert.deepEqual(fs.readFileSync(path.join(output, "storage", "image.bin")), Buffer.from([0, 255, 12]));
      assert.equal(fs.readFileSync(path.join(output, "data.sql"), "utf8"), "synthetic private content");
      assert.throws(() => unpack({ file, password, directory: output }), /new directory/);
      assert.throws(() => seal({ directory: input, output: file, password, scope: "test" }), /EEXIST/);
      assert.throws(() => seal({ directory: input, output: path.join(input, "self.parsibak"), password, scope: "test" }), /outside/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  } },
  { name: "backup wrong passwords and tampered ciphertext cannot create restore directories", fn() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-backup-test-"));
    try {
      const input = path.join(root, "input"); fs.mkdirSync(input); fs.writeFileSync(path.join(input, "snapshot.json"), "{}");
      const file = path.join(root, "copy.parsibak"); seal({ directory: input, output: file, password, scope: "workspace only" });
      assert.throws(() => verify({ file, password: "short" }), /32 characters/);
      assert.throws(() => verify({ file, password: "another-long-synthetic-password-value" }), /authenticated/);
      const bytes = fs.readFileSync(file); bytes[40] ^= 1; fs.writeFileSync(file, bytes);
      const output = path.join(root, "restored"); assert.throws(() => unpack({ file, password, directory: output }), /authenticated/);
      assert.equal(fs.existsSync(output), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  } },
  { name: "backup paths reject traversal, devices and alternate data streams", fn() {
    for (const name of ["../data.sql", "/data.sql", "x\\data.sql", "x//data.sql", "CON.txt", "a:file", "a/..", "a/hidden."]) assert.equal(safeName(name), false, name);
    assert.equal(safeName("storage/account/file.png"), true);
  } },
  { name: "monitoring opens one sanitized incident and suppresses repeated outage notifications", async fn() {
    const calls = []; let issues = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (init.method === "GET") return Response.json(issues);
      issues = [{ number: 42, title: JSON.parse(init.body).title, user: { login: "github-actions[bot]" } }];
      return Response.json(issues[0]);
    };
    const config = { token: "test-token", repository: "owner/project", runId: "123", healthy: false, fetchImpl };
    assert.equal((await updateIncident(config)).action, "opened");
    assert.equal((await updateIncident(config)).action, "already-open");
    assert.equal(calls.filter((call) => call.init.method === "POST").length, 1);
    assert.equal(JSON.stringify(JSON.parse(calls.find((call) => call.init.body).init.body)).includes("test-token"), false);
  } },
  { name: "monitoring resolves only its own bot issue after recovery", async fn() {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (init.method === "GET") return Response.json([{ number: 4, title: "[Monitoring] Parsitasks availability incident", user: { login: "owner" } },
        { number: 5, title: "[Monitoring] Parsitasks availability incident", user: { login: "github-actions[bot]" } }]);
      return Response.json({});
    };
    assert.equal((await updateIncident({ token: "test", repository: "owner/project", runId: "123", healthy: true, fetchImpl })).action, "resolved");
    assert.ok(calls.filter((call) => call.init.method !== "GET").every((call) => call.url.includes("/issues/5")));
  } },
  { name: "rollback selection rejects failed, foreign, PR and expired artifacts", async fn() {
    const revision = "a".repeat(40);
    const baseRun = { status: "completed", conclusion: "success", head_branch: "master", path: ".github/workflows/verification.yml", event: "push", repository: { full_name: "owner/project" }, head_repository: { full_name: "owner/project" }, head_sha: revision };
    const artifact = { id: 12, name: `verified-web-${revision}`, expired: false, digest: `sha256:${"b".repeat(64)}` };
    const resolve = (run = baseRun, item = artifact) => resolveRollback({ token: "test", repository: "owner/project", runId: "123",
      fetchImpl: async (url) => Response.json(url.includes("/artifacts?") ? { total_count: 1, artifacts: [item] } : run) });
    assert.equal((await resolve()).artifactId, 12);
    for (const change of [{ conclusion: "failure" }, { event: "pull_request" }, { head_branch: "other" }, { head_repository: { full_name: "foreign/project" } }, { path: ".github/workflows/other.yml" }]) await assert.rejects(resolve({ ...baseRun, ...change }), /trusted master/);
    await assert.rejects(resolve(baseRun, { ...artifact, expired: true }), /retained/);
    await assert.rejects(resolve(baseRun, { ...artifact, digest: "" }), /retained/);
  } },
  { name: "rollback downloads verify archive digest and never forward the GitHub token to blob storage", async fn() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-download-test-"));
    try {
      const bytes = Buffer.from("synthetic archive"); const calls = [];
      const fetchImpl = async (url, init) => { calls.push({ url, init }); return url.includes("api.github.com")
        ? new Response(null, { status: 302, headers: { Location: "https://blob.example.test/archive" } }) : new Response(bytes); };
      const config = { token: "test", repository: "owner/project", artifactId: "12", output: path.join(root, "archive.zip"), fetchImpl };
      await assert.rejects(downloadRollback({ ...config, digest: `sha256:${"0".repeat(64)}` }), /digest mismatch/);
      assert.equal(fs.existsSync(config.output), false);
      await downloadRollback({ ...config, digest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}` });
      assert.ok(calls.filter((call) => call.url.includes("blob.example.test")).every((call) => call.init.headers === undefined));
      assert.deepEqual(fs.readFileSync(config.output), bytes);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  } },
];
