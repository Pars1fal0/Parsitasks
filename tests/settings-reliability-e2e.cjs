const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      await context.route(/^https?:/, (route) => route.abort());
      await context.addInitScript(() => {
        if (!localStorage.getItem("rhythm-day-ui-v1")) localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ backupSchedule: "0", notificationSetting: "off" }));
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
      url.search = "automation=1"; url.hash = "settings";
      await page.goto(url.href);
      await page.locator("#settingsView").waitFor({ state: "visible" });
      await page.evaluate(() => { updateSetting("accentPreference", "blue"); updateSetting("timeFormat", "12"); });
      const read = () => page.evaluate(() => ({ state: JSON.parse(localStorage.getItem("rhythm-day-state-v1")), settings: getUiSettings() }));
      const upload = async (payload) => {
        await page.locator("#settingsImportFile").setInputFiles({ name: "settings.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)) });
        await page.waitForFunction(() => !document.querySelector("#settingsImportFile").value);
      };
      let before = await read();
      await upload({ tasks: [] });
      assert.deepEqual(await read(), before, "a workspace-shaped file cannot reset settings");
      assert.match(await page.locator("#appToast").innerText(), /корректных настроек/);
      await upload({ app: "Parsitasks", type: "settings", schemaVersion: before.state.schemaVersion, settings: { themePreference: "light", remoteSyncUrl: "https://attacker.example" } });
      let after = await read();
      assert.equal(after.settings.themePreference, "light");
      assert.equal(after.settings.accentPreference, "blue");
      assert.equal(after.settings.notificationSetting, "off");
      assert.equal(after.settings.backupSchedule, "0");
      assert.equal(after.settings.remoteSyncUrl, before.settings.remoteSyncUrl);
      assert.deepEqual(after.state.profile.preferences.timeFormat, before.state.profile.preferences.timeFormat, "unrelated preference timestamps remain unchanged");
      await page.reload();
      await page.locator("#settingsView").waitFor({ state: "visible" });
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light");

      before = await read();
      await page.evaluate(() => {
        window.originalWrite = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "rhythm-day-state-v1") throw new DOMException("Quota exceeded", "QuotaExceededError");
          return window.originalWrite.call(this, key, value);
        };
      });
      await page.evaluate(() => updateTimeZone("Europe/London"));
      assert.deepEqual(await page.evaluate(() => state.profile), before.state.profile);
      assert.equal(await page.locator("#timeZoneSetting").inputValue(), before.state.profile.timeZone);
      assert.doesNotMatch(await page.locator("#appToast").innerText(), /Часовой пояс:/);
      for (const permission of ["read", "write"]) {
        await page.evaluate((permission) => updateJournalPermission(permission, "off"), permission);
        assert.deepEqual(await page.evaluate(() => state.profile), before.state.profile);
        assert.equal(await page.locator(permission === "read" ? "#mcpJournalRead" : "#mcpJournalWrite").inputValue(), "on");
        assert.doesNotMatch(await page.locator("#appToast").innerText(), /Доступ ChatGPT отключён/);
      }
      await upload({ settings: { themePreference: "dark" } });
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light", "failed account preference import rolls back interface");
      assert.doesNotMatch(await page.locator("#appToast").innerText(), /^Настройки импортированы/);
      await page.evaluate(() => { Storage.prototype.setItem = window.originalWrite; });

      await page.evaluate(() => {
        Storage.prototype.setItem = function (key, value) {
          if (key === "rhythm-day-ui-v1") throw new DOMException("Quota exceeded", "QuotaExceededError");
          return window.originalWrite.call(this, key, value);
        };
      });
      await upload({ settings: { backupSchedule: "15" } });
      assert.match(await page.locator("#appToast").innerText(), /запись на устройстве не удалась/);
      assert.equal(await page.evaluate(() => getUiSettings().backupSchedule), "15", "partial success is explicitly disclosed");
      await page.evaluate(() => { Storage.prototype.setItem = window.originalWrite; });
      await upload({ settings: { backupSchedule: "0" } });

      before = await read();
      await page.evaluate(() => {
        window.originalText = File.prototype.text;
        File.prototype.text = function () {
          return new Promise((resolve) => { window.finishSettingsRead = async () => resolve(await window.originalText.call(this)); });
        };
      });
      await page.locator("#settingsImportFile").setInputFiles({ name: "pending.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ settings: { accentPreference: "orange" } })) });
      await page.waitForFunction(() => Boolean(window.finishSettingsRead));
      await page.evaluate(() => { remoteSyncAccountId = "synthetic-switched-account"; window.finishSettingsRead(); });
      await page.waitForFunction(() => !document.querySelector("#settingsImportFile").value);
      assert.match(await page.locator("#appToast").innerText(), /Аккаунт изменился/);
      assert.equal(await page.evaluate(() => getUiSettings().accentPreference), before.settings.accentPreference);
      await page.evaluate(() => { File.prototype.text = window.originalText; remoteSyncAccountId = ""; });
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("Settings reliability passed: desktop/mobile, safe partial import, reload, account switch and storage failures; all network blocked.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
