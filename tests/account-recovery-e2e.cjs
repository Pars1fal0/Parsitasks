const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-account-recovery-"));
  const userId = "00000000-0000-4000-8000-000000000001";
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", locale: "ru-RU" });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [], unexpected = [], writes = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let cloud, versions, restoreError = "40001", storageError = true, deleted = false;
      // Every HTTP request is intercepted, including hosted configuration: no real account or network access.
      await context.route(/^https?:/, async (route) => {
        const request = route.request(), url = new URL(request.url());
        const reply = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
        if (url.host !== "test.supabase.co") return reply({}, 404);
        const method = request.method(), endpoint = url.pathname;
        if (method !== "GET") writes.push({ endpoint, method, body: request.postDataJSON() });
        if (method === "GET" && endpoint === "/rest/v1/rhythm_states") return reply([cloud]);
        if (method === "GET" && endpoint === "/rest/v1/rhythm_state_snapshots") {
          return reply(url.searchParams.has("id") ? versions.filter((item) => `eq.${item.id}` === url.searchParams.get("id")) : versions);
        }
        if (endpoint === "/rest/v1/rpc/restore_parsitasks_snapshot" && method === "POST") {
          if (restoreError) return reply({ code: restoreError, message: restoreError === "40001" ? "Remote state changed" : "restore_parsitasks_snapshot unavailable" }, restoreError === "40001" ? 409 : 404);
          const body = request.postDataJSON();
          assert.equal(body.expected_updated_at, cloud.updated_at);
          const selected = versions.find((item) => String(item.id) === body.snapshot_id);
          assert.ok(selected);
          versions.push({ id: versions.length + 1, state: structuredClone(cloud.state), created_at: new Date().toISOString(), summary: { tasks: cloud.state.tasks.length } });
          cloud = { ...cloud, state: structuredClone(selected.state), updated_at: new Date(Date.parse(cloud.updated_at) + 1000).toISOString() };
          return reply({ snapshot: selected, row: cloud });
        }
        if (endpoint === "/storage/v1/object/list/board-images" && method === "POST") return reply([{ id: "test-image", name: "test.png" }]);
        if (endpoint === "/storage/v1/object/board-images" && method === "DELETE") return reply(storageError ? { message: "Storage unavailable" } : [], storageError ? 503 : 200);
        if (endpoint === "/rest/v1/rpc/delete_parsitasks_account" && method === "POST") { deleted = true; return reply(null); }
        if (endpoint === "/auth/v1/logout" && method === "POST") return reply(null);
        if (endpoint === "/auth/v1/user" && method === "GET") return reply({ id: userId, email: "disposable@example.test" });
        unexpected.push(`${method} ${endpoint}`);
        return reply({}, 404);
      });
      await context.addInitScript(({ userId }) => {
        localStorage.setItem("rhythm-supabase-session-v1", JSON.stringify({ access_token: "synthetic-token", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: userId, email: "disposable@example.test" } }));
        if (!localStorage.getItem("rhythm-day-ui-v1")) localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ remoteSyncEnabled: "off", remoteSyncUrl: "https://test.supabase.co", remoteSyncAnonKey: "synthetic-public-key", remoteSyncAccountId: userId, backupSchedule: "0" }));
      }, { userId });
      const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
      url.search = "automation=1"; url.hash = "settings";
      await page.goto(url.href);
      await page.locator("#pageTitle").waitFor();
      const initial = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
      const makeState = (id, title) => ({ ...initial, tasks: [{ id, title, date: "2026-10-06", repeat: "none", completed: {} }], taskOrder: {} });
      cloud = { state: makeState("cloud-before", "До восстановления"), updated_at: "2026-10-06T12:00:00Z", ui_state: {}, schema_version: initial.schemaVersion };
      versions = [{ id: 1, state: makeState("restored", "Сохранённое дело"), created_at: "2026-10-05T12:00:00Z", summary: { tasks: 1 }, schema_version: initial.schemaVersion }];
      await page.locator("#settingsView").waitFor({ state: "visible" });
      await page.locator("#remoteSnapshotsLoadButton").evaluate((button) => {
        for (let node = button.parentElement; node; node = node.parentElement) if (node.tagName === "DETAILS") node.open = true;
      });
      await page.locator("#remoteSnapshotsLoadButton").click();
      await page.waitForFunction(() => document.querySelector("#remoteSnapshotSelect").options.length === 2);
      const choose = async () => {
        await page.locator("#remoteSnapshotSelect").selectOption("1", { force: true });
        await page.waitForFunction(() => document.querySelector("#remoteSnapshotPreview").textContent.includes("Сохранённое дело"));
      };
      const restore = async () => { await page.locator("#remoteSnapshotRestoreButton").click(); await page.locator("#confirmAccept").click(); };
      await choose();
      await restore();
      await page.waitForFunction(() => document.querySelector("#remoteSnapshotsStatus").textContent.includes("Облако изменилось"));
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1"))), initial);
      restoreError = "PGRST202";
      await restore();
      await page.waitForFunction(() => document.querySelector("#remoteSnapshotsStatus").textContent.includes("SQL Editor"));
      assert.equal(cloud.state.tasks[0].id, "cloud-before");
      restoreError = "";
      await restore();
      await page.waitForFunction(() => document.querySelector("#remoteSnapshotsStatus").textContent.startsWith("Версия восстановлена"));
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks[0].id), "restored");
      assert.equal(versions[1].state.tasks[0].id, "cloud-before");
      assert.ok(writes.every((item) => item.endpoint !== "/rest/v1/rhythm_states"), "no fallback client overwrite");
      await page.screenshot({ path: path.join(captures, `recovery-${width}.png`), animations: "disabled" });
      const requestDelete = async () => {
        await page.locator("#remoteAccountDeleteButton").click();
        await page.locator("#confirmVerificationInput").fill("disposable@example.test");
        await page.locator("#confirmAccept").click();
      };
      await requestDelete();
      await page.waitForFunction(() => document.querySelector("#remoteSnapshotsStatus").textContent.includes("Storage unavailable"));
      assert.equal(deleted, false, "storage failure preserves the account");
      storageError = false;
      await requestDelete();
      await page.waitForFunction(() => document.querySelector("#remoteSnapshotsStatus").textContent.includes("Облачный аккаунт удалён"));
      assert.equal(deleted, true);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks[0].id), "restored", "local data remains after cloud deletion");
      assert.equal(await page.evaluate(() => localStorage.getItem("rhythm-supabase-session-v1")), null);
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      await context.close();
    }
    console.log(`e2e ok - isolated mobile/desktop recovery preview, conflicts, missing migration, local save and guarded deletion; screenshots: ${captures}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
