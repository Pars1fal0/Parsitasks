const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-material-toolbar-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1"; url.hash = "study";
    await page.goto(url.href); await page.locator("#pageTitle").waitFor();
    await page.locator('[data-study-tab="materials"]').click();
    for (const width of [1440, 1000, 900, 599, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const upload = page.locator("#studyNewMaterial");
      const filter = page.locator("#studyMaterialFilter");
      const search = page.getByRole("searchbox", { name: "Поиск материалов", exact: true });
      const [buttonBox, filterBox, searchBox] = await Promise.all([upload.boundingBox(), filter.boundingBox(), search.boundingBox()]);
      assert.equal(buttonBox.height, 44, `upload has one-line stable height at ${width}`);
      assert.ok(Math.abs(buttonBox.y - filterBox.y) <= 1, "filter aligns with upload");
      assert.ok(Math.abs(filterBox.height - buttonBox.height) <= 1);
      if (width > 900) {
        assert.ok(Math.abs(buttonBox.y - searchBox.y) <= 1, "desktop search shares toolbar row");
        assert.ok(buttonBox.x + buttonBox.width < searchBox.x && searchBox.x + searchBox.width < filterBox.x);
      } else {
        assert.ok(buttonBox.x + buttonBox.width < filterBox.x, "mobile upload does not overlap filter");
        assert.ok(searchBox.y >= buttonBox.y + buttonBox.height + 7, "mobile search has its own full-width row");
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator(".study-material-tools").evaluate((node) => node.scrollWidth > node.clientWidth + 1), false);
      await page.screenshot({ path: path.join(captures, `materials-${width}.png`), animations: "disabled" });
      await upload.click();
      await page.locator("#studyMaterialFormDialog").waitFor({ state: "visible" });
      await page.locator('#studyMaterialFormDialog [aria-label="Закрыть форму"]').click();
      await page.locator("#studyMaterialFormDialog").waitFor({ state: "hidden" });
    }
    assert.deepEqual(errors, []);
    console.log(`Material toolbar checks passed. Captures: ${captures}`);
    await context.close();
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
