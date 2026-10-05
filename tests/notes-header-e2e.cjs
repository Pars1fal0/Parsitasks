const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-notes-header-"));
  try {
    for (const width of [320, 390, 900, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", locale: "ru-RU" });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(6000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
      url.search = "automation=1";
      url.hash = "journal";
      await page.goto(url.href);
      await page.locator("#pageTitle").waitFor();
      await page.locator("#noteNew").click();
      const verify = async (name) => {
        await page.mouse.move(0, 0);
        const controls = page.locator("#noteForm .note-save, #noteForm .notes-pin-toggle, #noteDelete:not([hidden])");
        const boxes = await controls.evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length).map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, height: rect.height };
        }));
        assert.ok(boxes.length >= 2);
        assert.ok(boxes.every((box) => box.height === 44 && Math.abs(box.top - boxes[0].top) < 1 && box.left >= 0 && box.right <= width), `${name}: actions align at ${width}: ${JSON.stringify(boxes)}`);
        const status = await page.locator("#noteStatus").boundingBox();
        assert.ok(!status || status.y >= boxes[0].top + 44 || status.x + status.width <= boxes[0].left, `status does not overlap actions: ${width}/${name} ${JSON.stringify({ status, boxes })}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(captures, `${width}-${name}.png`), animations: "disabled" });
      };
      await verify("new");
      await page.locator("#noteTitle").fill("Важные договорённости");
      await page.locator("#noteBody").fill("Обсудить сроки проекта и сохранить результат.");
      await page.locator("#notePinned").check();
      await verify("draft");
      await page.locator("#noteForm .note-save").click();
      await page.locator("#noteDelete").waitFor({ state: "visible" });
      await verify("saved");
      await page.locator('[data-note-mode="read"]').click();
      assert.equal(await page.locator("#noteReadView").isVisible(), true);
      if (width <= 680) {
        assert.equal(await page.locator("#noteForm .note-save").isVisible(), false);
        const pin = await page.locator("#noteForm .notes-pin-toggle").boundingBox();
        assert.ok(pin.x + pin.width <= width);
      }
      await page.screenshot({ path: path.join(captures, `${width}-read.png`), animations: "disabled" });
      assert.deepEqual(errors, []);
      await context.close();
    }
    process.stdout.write(`Notes header checks passed. Captures: ${captures}\n`);
  } finally {
    await browser.close();
  }
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
