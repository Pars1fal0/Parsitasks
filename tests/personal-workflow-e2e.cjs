const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files"] });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-personal-"));
  try {
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 680, isMobile: width < 680, reducedMotion: "reduce", timezoneId: "Europe/Saratov", locale: "ru-RU" });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      const errors = []; page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.install({ time: new Date("2026-10-23T08:00:00+04:00") });
      const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
      url.search = "automation=1"; url.hash = "calendar/day";
      await page.goto(url.href); await page.waitForFunction(() => window.calendarSchedule && window.render);
      await page.evaluate(() => {
        const task = (id, title, extra = {}) => ({ id, title, date: "2026-10-23", repeat: "none", completed: {}, time: "", scheduleMode: "none", ...extra });
        state = normalizeState({
          tasks: [task("block", "Занято", { scheduleMode: "block", startTime: "09:00", endTime: "10:00", time: "10:00" }), task("later", "Отложенное дело", { date: null }),
            task("homework", "Подготовить доклад", { date: "2026-10-25", dueDate: "2026-10-25", dueTime: "11:30", studySubjectId: "math", studyFileIds: ["book"] })],
          studySubjects: [{ id: "math", name: "Математика", color: "#f0bf58" }],
          studyLessons: [{ id: "practice", subjectId: "math", weekday: 5, startTime: "10:00", endTime: "11:30", lessonType: "practice", weekType: "every" }],
          studyFiles: [{ id: "book", name: "Учебник", subjectId: "math", googleId: "test-book", url: "https://drive.google.com/file/d/test-book/view" }],
        });
        activeDate = "2026-10-23"; overviewMode = "day"; activeView = "overview"; saveState(); render();
      });
      if (width < 680) await page.locator(".calendar-touch-options > summary").click();
      await page.locator('[data-calendar-focus="planner"]').click();
      const dialog = page.locator(".calendar-planner-dialog");
      await dialog.getByRole("combobox", { name: "Задача для планирования" }).selectOption("later");
      assert.equal(await dialog.locator(".planner-slot").count(), 2, "a lesson and a block partition the day");
      await dialog.locator(".planner-slot").first().click();
      assert.equal(await dialog.locator('input[aria-label="Начало работы"]').getAttribute("type"), "time");
      await dialog.locator('input[aria-label="Начало работы"]').fill("08:15");
      assert.equal(await dialog.getByRole("button", { name: "Запланировать", exact: true }).isEnabled(), false, "the full hour must fit");
      await dialog.locator('input[aria-label="Начало работы"]').fill("08:00");
      assert.equal(await page.evaluate(() => state.tasks.find((item) => item.id === "later").date), null, "preview never moves the task");
      await page.screenshot({ path: path.join(captures, `${width}-planner-dark.png`) });
      const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await dialog.getByRole("button", { name: "Запланировать", exact: true }).click();
      await page.waitForFunction(() => state.tasks.find((item) => item.id === "later").startTime === "08:00");
      assert.equal(await page.evaluate(() => state.tasks.find((item) => item.id === "later").endTime), "09:00");
      await page.evaluate(() => { activeView = "study"; render(); });
      const row = page.locator("#studyHomeworkList .study-item", { hasText: "Подготовить доклад" });
      await row.locator("summary").click();
      await row.getByRole("button", { name: "Найти время для подготовки", exact: true }).click();
      await dialog.waitFor({ state: "visible" });
      assert.equal(await dialog.getByRole("combobox", { name: "Период поиска" }).inputValue(), "week");
      await dialog.getByRole("combobox", { name: "Длительность" }).selectOption("30");
      await dialog.locator(".planner-slot").first().click();
      await page.evaluate(() => document.documentElement.dataset.theme = "light");
      await page.screenshot({ path: path.join(captures, `${width}-planner-light.png`) });
      await dialog.getByRole("button", { name: "Запланировать", exact: true }).click();
      await page.waitForFunction(() => state.tasks.find((item) => item.id === "homework").date === "2026-10-23");
      const homework = await page.evaluate(() => state.tasks.find((item) => item.id === "homework"));
      assert.equal(homework.dueDate, "2026-10-25"); assert.equal(homework.dueTime, "11:30"); assert.deepEqual(homework.studyFileIds, ["book"]);
      await page.evaluate(() => {
        focusTimer.startFocus({ minutes: 15, taskId: "homework" });
      });
      await page.clock.fastForward(15 * 60000);
      const history = await page.evaluate(() => state.focusSessions);
      assert.equal(history.length, 1); assert.equal(history[0].count, 1); assert.equal(history[0].minutes, 15);
      await page.reload(); await page.waitForFunction(() => window.focusTimer);
      assert.equal(await page.evaluate(() => state.focusSessions.length), 1, "reopening cannot duplicate a finished session");
      await page.evaluate(() => {
        focusTimer.stop();
        state.tasks.push({ id: "overnight", title: "Читать", date: "2026-10-23", repeat: "daily", completed: {} });
        saveState();
      });
      await page.clock.setSystemTime(new Date("2026-10-23T23:55:00+04:00"));
      await page.evaluate(() => focusTimer.startFocus({ minutes: 15, taskId: "overnight" }));
      await page.clock.fastForward(15 * 60000);
      await page.locator("#appToast").getByRole("button", { name: "Задача готова", exact: true }).click();
      const overnight = await page.evaluate(() => state.tasks.find((item) => item.id === "overnight"));
      assert.equal(overnight.completed["2026-10-23"], true, "midnight completion belongs to the original occurrence");
      assert.notEqual(overnight.completed["2026-10-24"], true);
      assert.equal(await page.evaluate(() => state.focusSessions.find((item) => item.date === "2026-10-24").minutes), 15);
      await page.evaluate(() => {
        focusTimer.stop();
        const native = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === "rhythm-day-state-v1") throw new DOMException("synthetic quota", "QuotaExceededError");
          return native.call(this, key, value);
        };
        focusTimer.startFocus({ minutes: 15, taskId: "overnight" });
      });
      await page.clock.fastForward(15 * 60000);
      assert.equal(await page.evaluate(() => state.focusSessions.length), 2, "failed primary save is rolled back");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-focus-timer-v1")).pendingSessions.length), 1, "the unsaved session remains in the local outbox");
      await page.reload(); await page.waitForFunction(() => window.focusTimer);
      assert.equal(await page.evaluate(() => state.focusSessions.length), 3, "the outbox is replayed after storage recovers");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-focus-timer-v1")).pendingSessions.length), 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(`Personal workflow passed. Captures: ${captures}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
