const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const devices = [];
    const errors = [];
    for (const theme of ["dark", "light"]) {
      const context = await browser.newContext();
      await context.route(/^https?:/, (route) => route.abort());
      await context.addInitScript((themePreference) => {
        if (!localStorage.getItem("rhythm-day-ui-v1")) localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ themePreference, notificationSetting: "off", backupSchedule: "0" }));
      }, theme);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      const url = pathToFileURL(path.resolve(__dirname, "../app/index.html"));
      url.search = "automation=1";
      await page.goto(url.href);
      await page.waitForSelector("#pageTitle");
      devices.push(page);
    }
    const [pc, laptop] = devices;
    const snapshot = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    const receive = (page, remote) => page.evaluate((incoming) => {
      replaceState(window.RhythmStateMerge.mergeStates(state, incoming));
      saveState({ skipRemote: true });
      render();
    }, remote);
    await pc.evaluate(() => { migrateAccountPreferences(); updateSetting("accentPreference", "blue"); updateSetting("densityPreference", "compact"); });
    await receive(laptop, await snapshot(pc));
    assert.equal(await laptop.locator("html").getAttribute("data-accent"), "blue");
    assert.equal(await laptop.locator("html").getAttribute("data-theme"), "dark");
    assert.equal(await laptop.locator("html").getAttribute("data-density"), "compact");
    assert.equal(await laptop.evaluate(() => getUiSettings().notificationSetting), "off");
    assert.equal(await laptop.evaluate(() => getUiSettings().backupSchedule), "0");
    await pc.evaluate(() => updateSetting("themePreference", "light"));
    await laptop.evaluate(() => { updateSetting("firstDayOfWeek", "sunday"); updateSetting("timeFormat", "12"); updateSetting("navigationPreferences", { hidden: ["board"], mobile: ["tasks", "habits", "study"] }); });
    const pcOffline = await snapshot(pc), laptopOffline = await snapshot(laptop);
    await receive(pc, laptopOffline); await receive(laptop, pcOffline);
    assert.deepEqual((await snapshot(pc)).profile.preferences, (await snapshot(laptop)).profile.preferences);
    assert.equal(await pc.evaluate(() => getUiSettings().firstDayOfWeek), "sunday");
    assert.equal(await laptop.locator("html").getAttribute("data-theme"), "light");
    assert.equal(await pc.evaluate(() => getUiSettings().navigationPreferences.hidden.includes("board")), true);
    await laptop.reload(); await laptop.waitForSelector("#pageTitle");
    assert.equal(await laptop.locator("html").getAttribute("data-theme"), "light");
    assert.equal(await laptop.evaluate(() => getUiSettings().timeFormat), "12");
    await pc.evaluate(() => updateSetting("accentPreference", "#FAC"));
    await receive(laptop, await snapshot(pc));
    assert.equal(await laptop.locator("html").getAttribute("data-accent"), "#ffaacc");
    assert.ok(await laptop.locator("html").evaluate((node) => node.style.getPropertyValue("--teal")));
    await laptop.reload(); await laptop.waitForSelector("#pageTitle");
    assert.equal(await laptop.locator("html").getAttribute("data-accent"), "#ffaacc");
    await laptop.evaluate(() => { location.hash = "settings"; });
    await laptop.locator("#settingsImportFile").setInputFiles({ name: "settings.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ settings: { themePreference: "light", accentPreference: "orange" } })) });
    await laptop.waitForFunction(() => state.profile.preferences.accentPreference.value === "orange");
    await receive(pc, await snapshot(laptop));
    assert.equal(await pc.locator("html").getAttribute("data-accent"), "orange");
    await pc.evaluate(() => resetInterfacePreferences());
    await receive(laptop, await snapshot(pc));
    assert.equal(await laptop.locator("html").getAttribute("data-accent"), "emerald");
    assert.equal(await laptop.evaluate(() => getUiSettings().timeFormat), "24");
    assert.equal(await laptop.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error("quota"); };
      try { return updateSetting("themePreference", "light"); }
      finally { Storage.prototype.setItem = original; }
    }), false);
    assert.equal(await laptop.locator("html").getAttribute("data-theme"), "dark");
    await laptop.evaluate(() => { replaceState(null); applyAccountPreferences(true); render(); });
    assert.equal(await laptop.locator("html").getAttribute("data-accent"), "emerald");
    assert.deepEqual(await laptop.evaluate(() => state.profile.preferences), {});
    assert.deepEqual(errors, []);
    console.log("account preferences ok - isolated devices, offline merge, reload, reset, quota rollback and account switch; network blocked");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
