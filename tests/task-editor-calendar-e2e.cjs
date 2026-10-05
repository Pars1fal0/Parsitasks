const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-task-editor-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Europe/Saratov" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-05T10:00:00+04:00") });
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1"; url.hash = "calendar/day";
    await page.goto(url.href); await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      Object.assign(state, {
        tasks: [
          { id: "short", title: "Проверить письмо", date: "2026-10-05", repeat: "none", scheduleMode: "block", startTime: "10:00", endTime: "10:15", time: "10:15", completed: {}, dueDate: "2026-10-07", sourceNoteId: "note" },
          { id: "daily", title: "Ежедневное дело", date: "2026-10-01", repeat: "daily", scheduleMode: "block", startTime: "11:00", endTime: "12:00", time: "12:00", completed: { "2026-10-04": true } },
          { id: "marker", title: "Позвонить", date: "2026-10-05", repeat: "none", time: "13:00", completed: {} },
        ], habits: [], goals: [], notes: [], taskOrder: {},
        studySubjects: [{ id: "math", name: "Математика", color: "#7ca6ff" }],
        studyLessons: [{ id: "lesson", subjectId: "math", weekday: 1, weekType: "all", lessonType: "practice", startTime: "12:00", endTime: "13:00" }], studyFiles: [],
      });
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-05", activeView: "overview", overviewMode: "day", currentToday: "2026-10-05", accentPreference: "violet" }));
    });
    await page.reload(); await page.locator(".calendar-time-grid.is-day").waitFor();
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    const go = async (view) => {
      await page.evaluate((hash) => { location.hash = hash; window.scrollTo(0, 0); }, view);
      await page.locator(view.startsWith("calendar/") ? "#overviewView" : `#${view}View`).waitFor({ state: "visible" });
    };
    const event = (id, date = "2026-10-05") => page.locator(`.calendar-time-event[data-event-id="${id}"][data-date="${date}"]`);
    const closed = async () => {
      assert.ok(await page.locator("#taskFormPanel").evaluate((node) => node.classList.contains("is-collapsed")));
      assert.equal(await page.locator("body").evaluate((node) => node.classList.contains("has-floating-task-form")), false, "saving must remove the floating editor backdrop");
    };
    await event("short").locator(".calendar-event-open").click();
    await page.locator("#taskTitle").fill("Проверить важное письмо");
    await page.locator('#taskForm [type="submit"]').click();
    await closed();
    assert.equal((await stored()).tasks.find((task) => task.id === "short").sourceNoteId, "note");
    assert.equal((await stored()).tasks.find((task) => task.id === "short").dueDate, "2026-10-07");

    for (const view of ["calendar/day", "calendar/week"]) {
      await go(view);
      await event("short").locator(".calendar-event-check").click();
      await closed();
      assert.equal((await stored()).tasks.find((task) => task.id === "short").completed["2026-10-05"], true);
      await event("short").locator(".calendar-event-check").focus();
      await event("short").locator(".calendar-event-check").press("Space");
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks.find((task) => task.id === "short").completed["2026-10-05"] === false);
    }
    assert.equal(await page.locator(".calendar-time-event.is-lesson .calendar-event-check").count(), 0);
    await event("daily", "2026-10-06").locator(".calendar-event-check").click();
    const daily = (await stored()).tasks.find((task) => task.id === "daily");
    assert.equal(daily.completed["2026-10-06"], true);
    assert.equal(daily.completed["2026-10-04"], true);
    assert.notEqual(daily.completed["2026-10-05"], true, "completing a weekly occurrence cannot affect the selected day");

    await go("calendar/day");
    await page.evaluate(() => {
      window.originalWrite = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "rhythm-day-state-v1") throw new DOMException("Full", "QuotaExceededError");
        return window.originalWrite.call(this, key, value);
      };
    });
    await event("short").locator(".calendar-event-check").click();
    assert.equal(await event("short").locator(".calendar-event-check").getAttribute("aria-pressed"), "false", "failed completion rolls back visibly");
    await event("short").locator(".calendar-event-open").click();
    await page.locator("#taskTitle").fill("Несохранённое название");
    await page.locator('#taskForm [type="submit"]').click();
    assert.equal(await page.locator("#taskTitle").inputValue(), "Несохранённое название");
    assert.ok(await page.locator("body").evaluate((node) => node.classList.contains("has-floating-task-form")), "failed save keeps the editor open");
    await page.evaluate(() => { Storage.prototype.setItem = window.originalWrite; });
    await page.locator('#taskForm [type="submit"]').click(); await closed();
    assert.equal((await stored()).tasks.find((task) => task.id === "short").title, "Несохранённое название");

    await go("tasks");
    await page.locator("#openTaskForm").click();
    assert.equal(await page.locator("#taskExtraFields").getAttribute("open"), null);
    assert.equal(await page.locator("#taskWorkFields").getAttribute("open"), null);
    assert.equal(await page.locator("#taskDueSection").getAttribute("open"), null);
    await page.locator("#taskTitle").fill("Простая задача");
    await page.screenshot({ path: path.join(captures, "task-editor-desktop.png") });
    await page.locator('#taskForm [type="submit"]').click();
    const simple = (await stored()).tasks.find((task) => task.title === "Простая задача");
    assert.equal(simple.date, "2026-10-05"); assert.equal(simple.scheduleMode, "none");
    await page.locator("#openTaskForm").click();
    await page.locator("#taskTitle").fill("Идея без даты");
    await page.locator("#taskDeferred").check();
    await page.locator('#taskForm [type="submit"]').click();
    assert.equal((await stored()).tasks.find((task) => task.title === "Идея без даты").date, null);
    await page.locator('[data-task-pane="day"]').click();
    await page.locator("#openTaskForm").click();
    await page.locator("#taskWorkFields > summary").click();
    await page.locator('label:has(#taskScheduleBlock)').click();
    await page.locator("#taskStartTime").fill("14:00"); await page.locator("#taskEndTime").fill("14:15");
    await page.locator("#taskDueSection > summary").click();
    await page.locator("#taskDueDate").fill("2026-10-08");
    await page.locator("#taskExtraFields > summary").click();
    await page.locator("#taskTitle").fill("Полная задача");
    await page.locator("#taskPriority").selectOption("high");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.ok(await page.locator('#taskForm [type="submit"]').isVisible());
      await page.screenshot({ path: path.join(captures, `task-editor-${width}.png`) });
    }
    await page.locator('#taskForm [type="submit"]').click();
    assert.equal((await stored()).tasks.find((task) => task.title === "Полная задача").priority, "high");
    await go("calendar/day");
    await page.locator(".calendar-time-scroll").evaluate((node) => { node.scrollTop = 9 * 96; });
    await page.screenshot({ path: path.join(captures, "calendar-check-320.png") });
    const shortBox = await event("short").boundingBox();
    assert.ok(shortBox.height <= 25, "the completion control must not stretch a quarter-hour task");
    await event("short").locator(".calendar-event-open").click();
    await page.locator("#calendarEventPreview.is-interactive").getByRole("button", { name: "Изменить", exact: true }).click();
    await page.locator("#closeTaskForm").click(); await closed();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go("timeline");
    await page.locator('[data-task-id="short"] .timeline-task-check').click();
    assert.equal((await stored()).tasks.find((task) => task.id === "short").completed["2026-10-05"], true);
    await closed();
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log("Task editor/calendar checks passed. Captures: " + captures);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
