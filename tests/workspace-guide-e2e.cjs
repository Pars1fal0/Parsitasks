const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron, chromium } = require("playwright-core");

(async () => {
  let app = null; let browser = null; let page;
  if (process.env.PARSITASKS_ONBOARDING_WEB_URL) {
    const base = new URL(process.env.PARSITASKS_ONBOARDING_WEB_URL);
    assert.ok(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname), "Web UI test is restricted to a local server");
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    await page.goto(new URL("/app?automation=1#tasks", base).href);
  } else {
    app = await electron.launch({ args: [path.resolve(__dirname, ".."), "--e2e-test"], executablePath: require("electron") });
    page = await app.firstWindow();
  }
  page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  const capture = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-workspace-guide-"));
  const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-ui-v1")).navigationPreferences);
  const openHelp = async () => {
    await page.evaluate(() => { location.hash = "settings"; });
    await page.locator("#settingsView").waitFor({ state: "visible" });
    await page.locator("#helpSettings").evaluate((element) => { element.open = true; });
  };
  const audit = async () => {
    const violations = await page.evaluate(async () => (await window.axe.run(document)).violations.filter((item) => ["critical", "serious"].includes(item.impact)).map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(", ")}`));
    assert.deepEqual(violations, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  };
  try {
    await page.waitForSelector("#workspaceSetupBanner:not([hidden])");
    const initial = await prefs();
    await page.locator("#workspaceSetupBanner [data-workspace-setup]").click();
    await page.locator('#workspaceSetupForm [value="study"]').check();
    await page.keyboard.press("Escape");
    assert.deepEqual(await prefs(), initial, "closing the dialog must not apply its draft");
    assert.equal(await page.locator("#workspaceSetupBanner [data-workspace-setup]").evaluate((element) => element === document.activeElement), true);
    await page.locator("#workspaceSetupDismiss").click();
    await page.reload(); await page.waitForSelector("#pageTitle");
    assert.equal(await page.locator("#workspaceSetupBanner").isVisible(), false);
    await openHelp();
    await page.locator("#helpSettings [data-workspace-setup]").click();
    await page.locator('#workspaceSetupForm [value="study"]').check();
    await page.locator('#workspaceSetupForm button[type="submit"]').click();
    assert.deepEqual((await prefs()).mobile, ["tasks", "habits", "overview", "study"]);
    await page.reload(); await page.waitForSelector("#pageTitle");
    assert.deepEqual((await prefs()).mobile, ["tasks", "habits", "overview", "study"]);
    await openHelp();
    await page.evaluate(() => {
      window.originalStorageWrite = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "rhythm-day-ui-v1") throw new DOMException("Quota exceeded", "QuotaExceededError");
        return window.originalStorageWrite.call(this, key, value);
      };
    });
    await page.locator("#helpSettings [data-workspace-setup]").click();
    await page.locator('#workspaceSetupForm [value="basic"]').check();
    await page.locator('#workspaceSetupForm button[type="submit"]').click();
    assert.match(await page.locator("#workspaceSetupError").innerText(), /Не удалось сохранить/);
    assert.deepEqual((await prefs()).mobile, ["tasks", "habits", "overview", "study"]);
    await page.keyboard.press("Escape");
    await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageWrite; });
    await page.locator("#supportPreviewButton").click();
    const report = JSON.parse(await page.locator("#supportReportPreview").inputValue());
    assert.equal(report.format, "parsitasks-support-v1"); assert.equal(report.platform, app ? "desktop" : "web");
    assert.deepEqual(Object.keys(report).sort(), ["format", "localSaveError", "online", "platform", "schemaVersion", "sync", "version"]);
    const downloadedFile = path.join(capture, "diagnostics.json");
    if (app) await app.evaluate(({ BrowserWindow }, filePath) => {
      global.supportDownloadPromise = new Promise((resolve) => {
        BrowserWindow.getAllWindows()[0].webContents.session.once("will-download", (_event, item) => {
          const filename = item.getFilename(); item.setSavePath(filePath);
          item.once("done", (_event, state) => resolve({ filename, state }));
        });
      });
    }, downloadedFile);
    const webDownloadPromise = app ? null : page.waitForEvent("download");
    await page.locator("#supportDownloadButton").click();
    let downloaded;
    if (app) {
      downloaded = await app.evaluate(async () => Promise.race([global.supportDownloadPromise, new Promise((resolve) => setTimeout(() => resolve({ state: "timeout" }), 10000))]));
    } else {
      const download = await webDownloadPromise;
      await download.saveAs(downloadedFile);
      downloaded = { filename: download.suggestedFilename(), state: "completed" };
    }
    assert.deepEqual(downloaded, { filename: "parsitasks-diagnostics.json", state: "completed" });
    assert.deepEqual(JSON.parse(fs.readFileSync(downloadedFile, "utf8")), report);
    await page.locator("#helpNavigationButton").click();
    assert.equal(await page.locator("#navigationPreferences").isVisible(), true);
    await page.locator("#helpSyncButton").click();
    assert.equal(await page.locator("#remoteSyncCheckButton").isVisible(), true);
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      state.notes = [{ id: "existing-note", title: "Личная запись", content: "Личный текст", createdAt: new Date().toISOString() }];
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      localStorage.removeItem("rhythm-day-workspace-local-v1:local:workspace-setup-v1");
    });
    await page.reload(); await page.waitForSelector("#pageTitle");
    await page.evaluate(() => { location.hash = "tasks"; });
    assert.equal(await page.locator("#workspaceSetupBanner").isVisible(), false, "existing notes must suppress the setup offer");
    await openHelp();
    const before = await page.evaluate(() => localStorage.getItem("rhythm-day-state-v1"));
    await page.locator("#helpSettings [data-workspace-setup]").click();
    await page.locator('#workspaceSetupForm button[type="submit"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem("rhythm-day-state-v1")), before);
    await page.evaluate(fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"));
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator("#helpSettings").scrollIntoViewIfNeeded();
      await page.locator("#supportPreviewButton").click(); await audit();
      await page.screenshot({ path: path.join(capture, `help-${width}.png`), animations: "disabled" });
      await page.locator("#helpSettings [data-workspace-setup]").click(); await audit();
      await page.screenshot({ path: path.join(capture, `setup-${width}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
    }
    assert.deepEqual(errors, []);
    console.log(`e2e ok - optional setup, persisted navigation, quota rollback, existing-data preservation, private diagnostics, download and mobile accessibility; screenshots: ${capture}`);
  } catch (error) {
    await page.screenshot({ path: path.join(capture, "failed.png"), fullPage: true }).catch(() => {});
    console.error(`workspace guide failure screenshot: ${capture}`); throw error;
  } finally {
    if (app) {
      await app.evaluate(({ app: main }) => main.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
    if (browser) await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
