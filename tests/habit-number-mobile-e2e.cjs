const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files"] });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-habit-numbers-"));
  try {
    for (const width of [320, 390, 439, 1440]) {
      const mobile = width <= 680;
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce", locale: "ru-RU", timezoneId: "Europe/Saratov" });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(6000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date("2026-10-06T10:00:00+04:00"));
      const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
      url.search = "automation=1";
      url.hash = "habits";
      await page.goto(url.href);
      await page.locator("#pageTitle").waitFor();
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
        state.habits = [
          { id: "water", title: "Вода", type: "number", goal: 3000, step: 100, unit: "мл" },
          { id: "push", title: "Отжимания", type: "number", goal: 30, step: 1, unit: "раз" },
          { id: "read", title: "Чтение", type: "number", goal: 60, step: 5, unit: "мин" },
          { id: "check", title: "Прогулка", type: "check" },
        ].map((habit) => ({ ...habit, repeat: "daily", startDate: "2026-10-01", logs: { "2026-10-06": habit.id === "water" ? 1200 : habit.id === "push" ? 5 : 0 } }));
        localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
        localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-06", currentToday: "2026-10-06", activeView: "habits" }));
      });
      await page.reload();
      const water = page.locator('[data-habit-id="water"]');
      const minus = water.locator(".habit-number-row > .habit-stepper").first();
      const input = water.locator('input[type="number"]');
      await minus.click();
      assert.equal(await input.inputValue(), "1100", "minus is directly accessible");
      const plus = water.locator(".habit-number-row > .habit-stepper").last();
      await plus.click();
      assert.equal(await input.inputValue(), "1200");
      for (const action of [minus, plus, water.getByRole("button", { name: "+250 мл", exact: true }), water.getByRole("button", { name: "+500 мл", exact: true }), water.locator(".habit-goal-chip")]) {
        await action.scrollIntoViewIfNeeded();
        const reachable = await action.evaluate((button) => {
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return { hit: button === hit || button.contains(hit), height: rect.height, buttonWidth: rect.width, left: rect.left, right: rect.right, width: innerWidth };
        });
        assert.ok(reachable.hit && reachable.height >= 44 && reachable.buttonWidth >= 44 && reachable.left >= 0 && reachable.right <= reachable.width, `quick actions are visible and reachable without a menu: ${JSON.stringify(reachable)}`);
      }
      if (mobile) {
        const chips = await water.locator(".habit-quick-adds").boundingBox();
        const row = await water.locator(".habit-number-row").boundingBox();
        assert.ok(chips.width >= row.width - 2, "quick amounts use the whole row on phones");
        const next = await page.locator('[data-habit-id="push"]').boundingBox();
        assert.ok(next.y >= chips.y + chips.height, "quick amounts do not overlap the next habit");
      }
      await water.getByRole("button", { name: "+500 мл", exact: true }).click();
      assert.equal(await input.inputValue(), "1700");
      await water.locator(".habit-goal-chip").click();
      assert.equal(await input.inputValue(), "3000", "the goal chip fills the remaining amount");
      assert.equal(await water.locator(".habit-goal-chip").isVisible(), false, "the goal chip hides once the goal is reached");

      // Holding a stepper keeps stepping and stores a single change on release.
      const box = await minus.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(1000);
      await page.mouse.up();
      const held = Number(await input.inputValue());
      assert.ok(held <= 2800 && held >= 2000, `holding minus repeats the step: ${held}`);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).habits.find((habit) => habit.id === "water").logs["2026-10-06"]), held);
      assert.equal(await water.locator(".habit-goal-chip").isVisible(), true);
      await input.fill("50");
      await input.dispatchEvent("change");
      await minus.click();
      await minus.click();
      assert.equal(await input.inputValue(), "0", "decrement is clamped at zero");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).habits.find((habit) => habit.id === "water").logs["2026-10-06"] || 0), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(captures, `${width}-habits.png`), animations: "disabled" });
      assert.deepEqual(errors, []);
      await context.close();
    }
    process.stdout.write(`Habit number controls passed. Captures: ${captures}\n`);
  } finally {
    await browser.close();
  }
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
