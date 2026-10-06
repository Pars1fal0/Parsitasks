const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-completion-controls-"));
  try {
    for (const width of [320, 390, 680, 1440]) {
      const mobile = width <= 680;
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce", locale: "ru-RU", timezoneId: "Europe/Saratov" });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(6000);
      const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
      url.search = "automation=1"; url.hash = "tasks";
      await page.clock.setFixedTime(new Date("2026-10-06T10:00:00+04:00"));
      await page.goto(url.href); await page.locator("#pageTitle").waitFor();
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
        state.tasks = [{ id: "test-task", title: "Проверить документы", date: "2026-10-06", repeat: "none", completed: {} }];
        state.habits = [{ id: "test-habit", title: "Прогулка", type: "check", repeat: "daily", startDate: "2026-10-01", logs: {} }];
        localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
        localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-06", currentToday: "2026-10-06", activeView: "tasks" }));
      });
      await page.reload();
      for (const view of ["tasks", "habits"]) {
        await page.evaluate((value) => { location.hash = value; window.scrollTo(0, 0); }, view);
        const row = page.locator(view === "tasks" ? '[data-task-id="test-task"]' : '[data-habit-id="test-habit"]');
        await row.waitFor({ state: "visible" });
        const check = row.locator(".check-button");
        if (mobile) {
          const drag = await row.locator(view === "tasks" ? ".drag-handle" : ".habit-drag-handle").boundingBox();
          const button = await check.boundingBox();
          const visual = await check.evaluate((node) => {
            const circle = getComputedStyle(node, "::before");
            return { width: parseFloat(circle.width), height: parseFloat(circle.height), background: getComputedStyle(node).backgroundColor };
          });
          assert.equal(visual.width, 28); assert.equal(visual.height, 28);
          assert.equal(visual.background, "rgba(0, 0, 0, 0)");
          assert.ok(button.width >= 44 && button.height >= 44, "completion retains a finger-sized hit target");
          assert.ok(drag.x + drag.width <= button.x - 4, `${view}: drag and check targets do not overlap at ${width}`);
          for (const target of [check, row.locator(view === "tasks" ? ".drag-handle" : ".habit-drag-handle")]) {
            const reachable = await target.evaluate((node) => {
              const rect = node.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              return node === hit || node.contains(hit);
            });
            assert.ok(reachable, "both actions receive their own pointer input");
          }
        } else assert.equal(await check.evaluate((node) => getComputedStyle(node).width), "30px", "desktop check size is unchanged");
        await check.click();
        assert.equal(await row.locator(".check-button").getAttribute("aria-pressed"), "true");
        await page.screenshot({ path: path.join(captures, `${width}-${view}.png`), animations: "disabled" });
        await row.locator(".check-button").click();
        assert.equal(await row.locator(".check-button").getAttribute("aria-pressed"), "false");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await context.close();
    }
    process.stdout.write(`Mobile completion controls passed. Captures: ${captures}\n`);
  } finally {
    await browser.close();
  }
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
