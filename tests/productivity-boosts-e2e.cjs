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

      // Quick amounts only add, always visible; the goal chip fills what is left.
      const water = page.locator('[data-habit-id="water"]');
      const input = water.locator('input[type="number"]');
      assert.equal(await water.locator(".habit-sign-switch, .habit-number-more").count(), 0, "no mode switch or hidden menu");
      await water.getByRole("button", { name: "+500 мл", exact: true }).click();
      assert.equal(await input.inputValue(), "1500");
      await water.getByRole("button", { name: "Вода: до цели, ещё 1 500 мл", exact: true }).click();
      assert.equal(await input.inputValue(), "3000");
      assert.equal(await water.locator(".habit-goal-chip").isVisible(), false);
      await page.locator("#appToast").getByRole("button", { name: "Отменить", exact: true }).click();
      assert.equal(await page.locator('[data-habit-id="water"] input[type="number"]').inputValue(), "1500", "a slip is undone from the toast");
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

      // Focus sessions: pick a length and a task, pause, extend, then finish into a break.
      await page.locator("[data-focus-start]:visible").first().click();
      const setup = page.locator(".focus-setup");
      await setup.waitFor();
      assert.equal(await setup.getByRole("radio", { name: "25 мин" }).getAttribute("aria-checked"), "true");
      await setup.getByRole("radio", { name: "15 мин" }).click();
      await setup.locator("select").selectOption({ label: "Позвонить" });
      assert.equal(await setup.locator(".focus-setup-start").innerText(), "Начать · 15 мин");
      await page.keyboard.press("Escape");
      assert.equal(await setup.isVisible(), false, "Escape closes the setup");
      await page.locator("[data-focus-start]:visible").first().click();
      assert.equal(await setup.getByRole("radio", { name: "15 мин" }).getAttribute("aria-checked"), "true", "the chosen length is remembered");
      await setup.locator("select").selectOption({ label: "Позвонить" });
      await setup.locator(".focus-setup-start").click();
      const timer = page.locator(".focus-timer");
      await timer.waitFor();
      assert.equal(await timer.locator(".focus-timer-clock").innerText(), "15:00");
      assert.equal(await timer.locator(".focus-timer-task").innerText(), "Позвонить");
      await page.clock.runFor(60000);
      assert.equal(await timer.locator(".focus-timer-clock").innerText(), "14:00");
      assert.match(await page.title(), /^14:00 · Фокус/);
      await timer.getByRole("button", { name: "Пауза" }).click();
      await page.clock.runFor(3 * 60000);
      assert.equal(await timer.locator(".focus-timer-clock").innerText(), "14:00", "a paused session does not count down");
      assert.match(await page.title(), /^14:00 · Пауза/);
      await timer.getByRole("button", { name: "Продолжить" }).click();
      await timer.getByRole("button", { name: "Добавить 5 минут" }).click();
      assert.equal(await timer.locator(".focus-timer-clock").innerText(), "19:00");
      await page.clock.runFor(19 * 60000);
      assert.equal(await timer.locator(".focus-timer-mode").innerText(), "Перерыв");
      const done = page.locator("#appToast", { hasText: "Сессия завершена · сегодня 1" });
      await done.waitFor();
      await done.getByRole("button", { name: "Задача готова" }).click();
      assert.equal(await page.evaluate(({ day }) => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks.find((item) => item.id === "soon").completed?.[day], { day: DAY }), true, "the linked task is completed from the toast");
      await timer.getByRole("button", { name: "Пропустить перерыв" }).click();
      assert.equal(await timer.isVisible(), false);
      assert.match(await page.locator("[data-focus-start]:visible").first().innerText(), /· 1/);
      assert.match(await page.locator("[data-focus-start]:visible").first().getAttribute("title"), /1 сессия, 20 мин/);
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
      await page.locator('[data-task-id="later"] .task-more > summary').click();
      await page.locator('[data-task-id="later"] .focus-task').click();
      assert.equal(await page.locator(".focus-timer-task").innerText(), "Отчёт", "a focus session starts straight from the task menu");
      await page.locator(".focus-timer").getByRole("button", { name: "Остановить фокус-сессию" }).click();
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
