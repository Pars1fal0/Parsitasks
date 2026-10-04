const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-appearance-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(6000); const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1"; url.hash = "settings";
    await page.goto(url.href); await page.waitForSelector("#settingsView:visible");
    const appearance = page.locator('details[aria-labelledby="appearanceHeading"]');
    await appearance.locator(":scope > summary").click();
    assert.equal(await appearance.locator(".settings-block").count(), 2);
    assert.equal(await appearance.locator(".accent-option").count(), 8);
    await page.locator('.accent-option.is-rose').click();
    assert.equal(await page.locator("html").getAttribute("data-accent"), "rose");
    await page.locator("#customAccentHex").fill("nothex"); await page.locator("#customAccentHex").press("Enter");
    assert.equal(await page.locator("#customAccentHex").getAttribute("aria-invalid"), "true");
    assert.equal(await page.locator("html").getAttribute("data-accent"), "rose");
    await page.locator("#customAccentHex").fill("#FAB"); await page.locator("#customAccentHex").press("Enter");
    assert.equal(await page.locator("html").getAttribute("data-accent"), "#ffaabb");
    assert.equal(await page.locator('[name="accentPreference"]:checked').count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).profile.preferences.accentPreference.value), "#ffaabb");
    await page.locator("#themePreference").selectOption("light");
    const lightAccent = await page.locator("html").evaluate((node) => node.style.getPropertyValue("--teal"));
    await page.locator("#themePreference").selectOption("dark");
    assert.notEqual(await page.locator("html").evaluate((node) => node.style.getPropertyValue("--teal")), lightAccent);
    await page.locator("#themePreference").selectOption("system");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    assert.equal(await page.locator("html").evaluate((node) => node.style.getPropertyValue("--teal")), lightAccent);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    await page.locator("#themePreference").selectOption("dark");
    await page.locator("#customAccentPicker").fill("#6bc6d1"); await page.locator("#customAccentPicker").dispatchEvent("change");
    assert.equal(await page.locator("html").getAttribute("data-accent"), "#6bc6d1");
    await page.screenshot({ path: path.join(captures, "settings-desktop.png") });
    await page.reload(); await page.waitForSelector("#settingsView:visible");
    assert.equal(await page.locator("html").getAttribute("data-accent"), "#6bc6d1");
    await appearance.locator(":scope > summary").click();
    await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "rhythm-day-state-v1") throw new DOMException("Full", "QuotaExceededError"); return originalSetItem.call(this, key, value); }; });
    await page.locator("#customAccentHex").fill("#ffaa00"); await page.locator("#customAccentHex").press("Enter");
    assert.equal(await page.locator("html").getAttribute("data-accent"), "#6bc6d1");
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await page.locator("#customAccentHex").fill("#6bc6d1"); await page.locator("#customAccentHex").press("Enter");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      if (await page.locator(".toast-close").isVisible()) await page.locator(".toast-close").click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(captures, `settings-${width}.png`) });
      for (const node of await page.locator(".accent-option").all()) assert.ok((await node.boundingBox()).height >= 44);
      await appearance.locator(":scope > summary").click();
      assert.equal(await page.locator("#customAccentForm").isVisible(), false);
      await appearance.locator(":scope > summary").click();
    }
    await page.locator('.accent-option.is-blue').click();
    assert.equal(await page.locator("html").evaluate((node) => node.style.getPropertyValue("--teal")), "");
    for (const group of await page.locator(".settings-primary-group").all()) {
      await group.evaluate((node) => { node.open = true; });
      for (const child of await group.locator("details.settings-subsection").all()) await child.evaluate((node) => { node.open = true; });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "every settings group fits mobile width");
    }
    assert.deepEqual(errors, []); console.log(`Appearance checks passed. Captures: ${captures}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
