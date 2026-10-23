const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

const DAY = "2026-10-06";

function task(id, title, extra = {}) {
  return {
    id, title, date: DAY, time: "", scheduleMode: "none", startTime: "", endTime: "", categoryId: "", priority: "medium",
    repeat: "none", reminderOffset: "none", completed: {}, acknowledgedOverdue: {}, excludedDates: {}, notified: {},
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...extra,
  };
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files"] });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-productivity-"));
  try {
    for (const width of [390, 1440]) {
      const mobile = width <= 680;
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce", locale: "ru-RU", timezoneId: "Europe/Saratov" });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(6000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.install({ time: new Date(`${DAY}T10:00:00+04:00`) });
      const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
      url.search = "automation=1";
      url.hash = "habits";
      await page.goto(url.href);
      await page.locator("#pageTitle").waitFor();
      await page.evaluate(({ day, tasks }) => {
        const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
        state.habits = [{ id: "water", title: "Вода", type: "number", goal: 3000, unit: "мл", repeat: "daily", startDate: "2026-10-01", logs: { [day]: 1000 } }];
        state.tasks = tasks;
        localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
        localStorage.removeItem("rhythm-focus-timer-v1");
        localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: day, currentToday: day, activeView: "habits" }));
      }, { day: DAY, tasks: [task("soon", "Позвонить", { time: "10:03", scheduleMode: "deadline" }), task("later", "Отчёт", { time: "15:00", scheduleMode: "deadline" })] });
      await page.reload();

      // Quick amounts subtract once the habit is switched to the minus mode.
      const water = page.locator('[data-habit-id="water"]');
      const input = water.locator('input[type="number"]');
      if (mobile) await water.locator(".habit-number-more > summary").click();
      await water.getByRole("button", { name: "Вода: убавлять" }).click();
      assert.equal(await water.getByRole("button", { name: "Вода: убавлять" }).getAttribute("aria-pressed"), "true");
      await water.getByRole("button", { name: "−500 мл", exact: true }).click();
      assert.equal(await input.inputValue(), "500");
      if (mobile) await water.locator(".habit-number-more > summary").click();
      await water.getByRole("button", { name: "−500 мл", exact: true }).click();
      assert.equal(await input.inputValue(), "0", "subtracting is clamped at zero");
      if (mobile) await water.locator(".habit-number-more > summary").click();
      await water.getByRole("button", { name: "Вода: прибавлять" }).click();
      await water.getByRole("button", { name: "+250 мл", exact: true }).click();
      assert.equal(await input.inputValue(), "250");
      await page.screenshot({ path: path.join(captures, `${width}-habits.png`) });

      // The "now" marker follows the clock without a reload and flags tasks that slipped past.
      await page.evaluate(() => { location.hash = "timeline"; });
      await page.locator('body[data-view="timeline"]').waitFor();
      const line = page.locator(".timeline-now-line");
      assert.match(await line.innerText(), /10:00/);
      assert.equal(await page.locator('[data-task-id="soon"]').evaluate((node) => node.classList.contains("is-overdue")), false);
      const gridBefore = await page.locator("#timelineGrid > :first-child").elementHandle();
      await page.clock.runFor(5 * 60000);
      assert.match(await line.innerText(), /10:05/);
      assert.equal(await line.evaluate((node) => node.style.getPropertyValue("--now-offset")), "8%");
      assert.equal(await page.locator('[data-task-id="soon"]').evaluate((node) => node.classList.contains("is-overdue")), true);
      assert.match(await page.locator('[data-task-id="soon"] .timeline-task-meta').innerText(), /просрочено/);
      assert.equal(await gridBefore.evaluate((node) => node.isConnected), true, "the grid is updated in place, not rebuilt");
      await page.clock.runFor(60 * 60000);
      assert.equal(await page.locator('.timeline-hour-slot[data-hour="11"] .timeline-now-line').count(), 1, "the marker moves into the next hour");

      // Focus sessions count down, roll into a break and are counted for the day.
      await page.locator("[data-focus-start]:visible").first().click();
      const timer = page.locator(".focus-timer");
      await timer.waitFor();
      assert.equal(await timer.locator(".focus-timer-clock").innerText(), "25:00");
      await page.clock.runFor(60000);
      assert.equal(await timer.locator(".focus-timer-clock").innerText(), "24:00");
      assert.match(await page.title(), /^24:00 · Фокус/);
      await page.clock.runFor(24 * 60000);
      assert.equal(await timer.locator(".focus-timer-mode").innerText(), "Перерыв");
      assert.match(await page.locator("#appToast").innerText(), /Фокус-сессия завершена · сегодня 1/);
      await timer.getByRole("button", { name: "Пропустить перерыв" }).click();
      assert.equal(await timer.isVisible(), false);
      assert.match(await page.locator("[data-focus-start]:visible").first().innerText(), /· 1/);
      assert.doesNotMatch(await page.title(), /Фокус/);

      // Finishing the last open item celebrates the closed day once.
      await page.evaluate(() => { location.hash = "tasks"; });
      await page.locator('body[data-view="tasks"]').waitFor();
      await page.evaluate(({ day }) => {
        const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
        state.habits[0].logs[day] = 3000;
        state.tasks.find((item) => item.id === "soon").completed = { [day]: true };
        localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      }, { day: DAY });
      await page.reload();
      await page.locator('[data-task-id="later"] .check-button, [data-task-id="later"] .task-check').first().click();
      const toast = page.locator("#appToast", { hasText: "День закрыт на 100%" });
      await toast.waitFor();
      assert.match(await toast.innerText(), /^Задача выполнена · День закрыт на 100%/);
      assert.equal(await toast.getByRole("button", { name: "Отменить", exact: true }).count(), 1, "the completing action keeps its undo");
      await page.screenshot({ path: path.join(captures, `${width}-celebration.png`) });

      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await context.close();
    }
    process.stdout.write(`Productivity boosts passed. Captures: ${captures}\n`);
  } finally {
    await browser.close();
  }
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
