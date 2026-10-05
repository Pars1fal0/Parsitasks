const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-mobile-layout-"));
  try {
    for (const width of [320, 390, 439, 1440]) {
      const mobile = width < 680;
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce", locale: "ru-RU", timezoneId: "Europe/Saratov" });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(6000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date("2026-10-06T10:00:00+04:00"));
      const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
      url.search = "automation=1";
      url.hash = "tasks";
      await page.goto(url.href);
      await page.locator("#pageTitle").waitFor();
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
        state.tasks = [{ id: "layout-task", title: "Проверить макет", date: "2026-10-06", dueDate: "2026-10-06", repeat: "none", completed: {} }];
        state.boardItems = [];
        localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
        localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-06", currentToday: "2026-10-06", activeView: "tasks", navigationPreferences: { hidden: [], mobile: ["tasks", "habits", "overview", "study"] } }));
      });
      await page.reload();
      const go = async (hash) => {
        await page.evaluate((value) => { document.activeElement?.blur(); location.hash = value; window.scrollTo(0, 0); }, hash);
        await page.locator(`#${hash.startsWith("calendar/") ? "overview" : hash}View`).waitFor({ state: "visible" });
      };
      const fits = async (selector) => {
        const boxes = await page.locator(selector).evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length).map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: innerWidth };
        }));
        assert.ok(boxes.length, selector);
        assert.ok(boxes.every((rect) => rect.left >= 0 && rect.right <= rect.width + 1), `${selector} stays in viewport at ${width}`);
      };
      for (const mode of ["day", "week"]) {
        await go(`calendar/${mode}`);
        await page.waitForFunction((value) => document.querySelector("#overviewView").dataset.mode === value, mode);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await fits(".calendar-schedule-controls > button, .calendar-touch-options > summary");
        if (mobile) {
          const now = await page.locator(".calendar-schedule-controls").getByRole("button", { name: "Сейчас", exact: true }).boundingBox();
          const settings = await page.locator(".calendar-touch-options > summary").boundingBox();
          assert.ok(Math.abs(now.y - settings.y) < 1 && Math.abs(now.height - settings.height) < 1, "calendar actions align");
          assert.ok(settings.x - now.x - now.width <= 10, "Now and settings are adjacent");
          const grid = await page.locator(".calendar-time-scroll").boundingBox();
          assert.ok(grid.height >= 280 && grid.y + grid.height <= 724, `timeline leaves page scrolling space: ${width}/${mode} ${JSON.stringify(grid)}`);
        }
        await page.screenshot({ path: path.join(captures, `${width}-${mode}.png`), animations: "disabled" });
      }
      await go("board");
      if (mobile) await page.locator(".board-space-controls > .ghost-button").click();
      await page.locator("#boardAddMenu > summary").click();
      await page.locator("#boardAddText").click();
      await page.locator("#boardTextControls").waitFor({ state: "visible" });
      await fits("#boardColorPresets button, #boardTextColor, .board-object-actions > button");
      await page.locator('[data-board-text-color="#8958d5"]').click();
      assert.equal(await page.locator("#boardTextColor").inputValue(), "#8958d5");
      if (mobile) {
        const contained = await page.locator("#boardSelectionToolbar").evaluate((toolbar) => {
          const bounds = toolbar.getBoundingClientRect();
          return { scrollLeft: toolbar.scrollLeft, bounds: { left: bounds.left, right: bounds.right }, tools: [...toolbar.querySelectorAll("input, button")].filter((node) => node.getClientRects().length).map((node) => {
            const rect = node.getBoundingClientRect();
            return { id: node.id || node.title, left: rect.left, right: rect.right };
          }) };
        });
        assert.ok(contained.tools.every((tool) => tool.left >= contained.bounds.left && tool.right <= contained.bounds.right), `board tools stay inside panel: ${JSON.stringify(contained)}`);
        const stage = await page.locator("#boardViewport").boundingBox();
        assert.ok(contained.bounds.left >= stage.x && contained.bounds.right <= stage.x + stage.width, "palette panel remains inside board after focusing a color");
      }
      await page.screenshot({ path: path.join(captures, `${width}-board-text.png`), animations: "disabled" });
      await page.locator("#boardAddMenu > summary").click();
      await page.locator("#boardAddLink").click();
      await page.locator('[data-board-source="task"]').click();
      await page.locator("#boardLinkControls").waitFor({ state: "visible" });
      await fits("#boardLinkControls button, .board-object-actions > button");
      await page.locator('[data-board-link-color="#efeaff"]').click();
      assert.equal(await page.locator('[data-board-link-color="#efeaff"]').getAttribute("aria-pressed"), "true");
      await page.screenshot({ path: path.join(captures, `${width}-board-card.png`), animations: "disabled" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await context.close();
    }
    process.stdout.write(`Mobile board/calendar layout passed. Captures: ${captures}\n`);
  } finally {
    await browser.close();
  }
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
