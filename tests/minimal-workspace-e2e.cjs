const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const capture = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-minimal-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Europe/Saratov" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-03T10:00:00+04:00"));
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1"; url.hash = "tasks";
    await page.goto(url.href);
    await page.waitForSelector("#pageTitle");
    assert.deepEqual(errors, []);
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      Object.assign(state, {
        categories: [{ id: "work", name: "Работа", color: "#7ca6ff" }],
        tasks: [
          { id: "block", title: "Подготовить презентацию для нового проекта", date: "2026-10-03", scheduleMode: "block", startTime: "10:00", endTime: "11:30", time: "11:30", priority: "medium", repeat: "none", categoryId: "work", completed: {}, dueDate: "2026-10-05", dueTime: "12:00", sourceNoteId: "note", studySubjectId: "math", studyDetails: "Сохранить связь", studyFileIds: ["file"] },
          { id: "untimed", title: "Купить подарок", date: "2026-10-03", repeat: "none", completed: {} },
          { id: "daily", title: "Повторить слова", date: "2026-10-01", repeat: "daily", scheduleMode: "block", startTime: "12:00", endTime: "12:30", time: "12:30", completed: {} },
        ],
        habits: [
          { id: "water", title: "Вода", type: "number", goal: 2000, unit: "мл", repeat: "daily", startDate: "2026-10-01", logs: {} },
          { id: "walk", title: "Прогулка", type: "check", repeat: "daily", startDate: "2026-10-01", logs: {} },
        ],
        studySubjects: [{ id: "math", name: "Математика", color: "#aa99ee", teacher: "Анна Иванова" }],
        studyLessons: [{ id: "lesson", subjectId: "math", weekday: 6, weekType: "all", lessonType: "practice", startTime: "10:30", endTime: "12:00", room: "501" }],
        notes: [{ id: "note", title: "Важная информация", body: "Не удалять", updatedAt: new Date().toISOString() }],
      });
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-03", activeView: "tasks", navigationPreferences: { hidden: ["nutrition"], mobile: ["tasks", "habits", "overview", "study"] } }));
    });
    await page.reload(); await page.waitForSelector("#pageTitle");
    assert.equal(await page.locator('.nav-tabs > [data-view="timeline"]').isVisible(), false);
    assert.equal(await page.locator('.nav-tabs > [data-view="journal"]').isVisible(), false);
    await page.locator(".nav-more > summary").click();
    assert.equal(await page.locator('.nav-more-menu [data-view="journal"]').isVisible(), true);
    await page.locator(".nav-more > summary").click();

    await page.locator("#quickTaskInput").fill("Спланировать день");
    await page.locator("#quickTaskInput").press("Enter");
    const quick = (await stored()).tasks.find((task) => task.title === "Спланировать день");
    assert.ok(quick); assert.equal(quick.date, "2026-10-03"); assert.equal(quick.time, ""); assert.equal(quick.categoryId, "");
    await page.locator("#openTaskForm").click();
    assert.equal(await page.locator("#taskCategoryId").isVisible(), false);
    assert.equal(await page.locator("#taskTitle").isVisible(), true);
    await page.locator("#closeTaskForm").click();

    await page.evaluate(() => { location.hash = "calendar/week"; });
    await page.locator("#calendarSchedule").waitFor({ state: "visible" });
    assert.equal(await page.locator(".calendar-time-column").count(), 7);
    assert.equal(await page.locator(".calendar-hour-slot").count(), 168);
    assert.ok(await page.locator(".calendar-time-scroll").evaluate((node) => node.scrollHeight <= node.clientHeight + 2), "whole day fits vertically by default");
    assert.equal(await page.locator('.calendar-time-event[data-event-id="untimed"]').count(), 0);
    assert.equal(await page.locator('[data-agenda-task-id="untimed"]').count(), 1);
    assert.equal(await page.locator(".calendar-time-event.is-lesson").count(), 1);
    assert.match(await page.locator(".calendar-selected-agenda").innerText(), /Практика/);
    const overlap = await page.locator('.calendar-time-day[data-date="2026-10-03"] .is-block').evaluateAll((nodes) => nodes.filter((n) => ["block", "lesson:lesson:2026-10-03"].includes(n.dataset.eventId)).map((n) => ({ width: n.offsetWidth, parent: n.parentElement.clientWidth })));
    assert.ok(overlap.length === 2 && overlap.every((b) => b.width < b.parent * .6), "overlaps occupy separate columns");
    await page.screenshot({ path: path.join(capture, "calendar-desktop.png") });
    await page.locator('[data-overview-mode="day"]').click();
    assert.equal(await page.locator(".calendar-time-column").count(), 1);
    assert.match(page.url(), /calendar\/day$/);
    await page.reload(); await page.waitForSelector(".calendar-time-column");
    assert.equal(await page.locator(".calendar-time-column").count(), 1);

    await page.locator('.calendar-hour-slot[data-time="09:00"]').click();
    assert.equal(await page.locator("#taskStartTime").inputValue(), "09:00");
    assert.equal(await page.locator("#taskEndTime").inputValue(), "10:00");
    await page.locator("#taskTitle").fill("Рабочий час");
    await page.locator('#taskForm button[type="submit"]').click();
    assert.ok((await stored()).tasks.find((task) => task.title === "Рабочий час"));
    await page.locator('.calendar-time-event[data-event-id="block"] .calendar-event-open').click();
    await page.locator("#taskTitle").fill("Презентация с сохранёнными связями");
    await page.locator("#taskExtraFields > summary").click();
    assert.match(await page.locator(".task-settings-summary").innerText(), /2026-10-05/);
    await page.locator('#taskForm button[type="submit"]').click();
    const preserved = (await stored()).tasks.find((task) => task.id === "block");
    assert.equal(preserved.sourceNoteId, "note"); assert.equal(preserved.dueDate, "2026-10-05"); assert.equal(preserved.studySubjectId, "math");

    assert.equal(await page.locator("[data-calendar-scale]").count(), 0);
    const handle = page.locator('.calendar-time-event[data-event-id="block"] .calendar-event-resize');
    await handle.focus(); await handle.press("ArrowDown");
    assert.equal((await stored()).tasks.find((task) => task.id === "block").endTime, "11:45");
    const resizeBox = await handle.boundingBox();
    const quarterHourPixels = await page.locator("#calendarSchedule").evaluate((node) => Number.parseFloat(getComputedStyle(node).getPropertyValue("--calendar-hour-height")) / 4);
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2 + quarterHourPixels, { steps: 4 });
    await page.mouse.up();
    assert.equal((await stored()).tasks.find((task) => task.id === "block").endTime, "12:00", "pointer resize is saved");
    await handle.focus(); await handle.press("ArrowUp");
    assert.equal((await stored()).tasks.find((task) => task.id === "block").endTime, "11:45");
    await page.locator('[data-overview-mode="week"]').click();
    const source = page.locator('.calendar-time-event[data-event-id="block"]');
    const target = page.locator('.calendar-time-day[data-date="2026-10-04"] .calendar-hour-slot[data-time="14:00"]');
    await source.dragTo(target);
    const moved = (await stored()).tasks.find((task) => task.id === "block");
    assert.equal(moved.date, "2026-10-04"); assert.equal(moved.startTime, "14:00"); assert.equal(moved.endTime, "15:45"); assert.equal(moved.dueDate, "2026-10-05");

    const drop = async (id, from, to, at) => {
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
      await page.locator(`.calendar-time-day[data-date="${from}"] .calendar-time-event[data-event-id="${id}"]`).dispatchEvent("dragstart", { dataTransfer });
      await page.locator(`.calendar-time-day[data-date="${to}"] .calendar-hour-slot[data-time="${at}"]`).dispatchEvent("drop", { dataTransfer });
      await dataTransfer.dispose();
    };
    const beforeCancel = await stored();
    await drop("daily", "2026-10-04", "2026-10-03", "15:00");
    await page.locator("#confirmModal").waitFor({ state: "visible" });
    await page.locator("#confirmCancel").click();
    assert.deepEqual(await stored(), beforeCancel, "cancelled recurring move changes no data");
    await drop("daily", "2026-10-04", "2026-10-03", "15:00");
    await page.locator("#confirmAccept").click();
    const recurringState = await stored();
    assert.equal(recurringState.tasks.find((task) => task.id === "daily").excludedDates["2026-10-04"], true);
    assert.ok(recurringState.tasks.some((task) => task.sourceTaskId === "daily" && task.date === "2026-10-03" && task.startTime === "15:00"));
    assert.equal(recurringState.tasks.find((task) => task.id === "daily").startTime, "12:00", "other days retain original time");
    await page.evaluate(() => {
      window.originalWrite = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "rhythm-day-state-v1") throw new DOMException("Quota exceeded", "QuotaExceededError");
        return window.originalWrite.call(this, key, value);
      };
    });
    const beforeFailure = await stored();
    await drop("block", "2026-10-04", "2026-10-03", "16:00");
    assert.deepEqual(await stored(), beforeFailure, "failed calendar move keeps persisted data");
    assert.equal(await page.locator('.calendar-time-day[data-date="2026-10-04"] [data-event-id="block"]').count(), 1, "failed move restores visible position");
    assert.match(await page.locator("#appToast").innerText(), /Не удалось сохранить/);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalWrite; });
    const retryHandle = page.locator('.calendar-time-day[data-date="2026-10-04"] [data-event-id="block"] .calendar-event-resize');
    await retryHandle.focus(); await retryHandle.press("ArrowUp");
    await retryHandle.focus(); await retryHandle.press("ArrowDown");
    assert.equal((await stored()).tasks.find((task) => task.id === "block").endTime, "15:45", "calendar can retry after storage recovery");
    await page.locator('.calendar-time-column:has(.calendar-time-day[data-date="2026-10-04"]) .calendar-time-heading').click();

    await page.locator('[data-overview-mode="month"]').click();
    assert.equal(await page.locator("#calendarSchedule").isVisible(), false);
    assert.equal(await page.locator("#monthGrid").isVisible(), true);
    await page.locator('[data-overview-mode="year"]').click();
    assert.equal(await page.locator("#heatmapGrid").isVisible(), true);
    await page.locator('[data-overview-mode="week"]').click();
    await page.locator('#overviewView [data-study-layer]').uncheck();
    assert.equal(await page.locator(".calendar-time-event.is-lesson").count(), 0);
    await page.locator('#overviewView [data-study-layer]').check();
    assert.equal(await page.locator(".calendar-time-event.is-lesson").count(), 1);
    for (const width of [320, 390, 599, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `page fits ${width}px; week alone scrolls horizontally`);
      if (width < 901) assert.equal(await page.locator('.nav-tabs > button[data-view]:visible').count(), 4);
      const rail = await page.locator(".calendar-hour-rail").boundingBox();
      const scroller = await page.locator(".calendar-time-scroll").boundingBox();
      assert.ok(Math.abs(rail.x - scroller.x) < 3, "hour labels remain visible while week scrolls horizontally");
      await page.screenshot({ path: path.join(capture, `calendar-${width}.png`) });
    }
    await page.evaluate(() => { location.hash = "habits"; });
    await page.locator("#habitsView").waitFor({ state: "visible" });
    await page.locator('[data-habit-id="water"] .habit-quick-adds button').first().click();
    assert.equal((await stored()).habits.find((habit) => habit.id === "water").logs["2026-10-04"], 250);
    await page.locator('[data-habit-id="walk"] .check-button').click();
    assert.equal((await stored()).habits.find((habit) => habit.id === "walk").logs["2026-10-04"], true);
    await page.screenshot({ path: path.join(capture, "habits-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(capture, "habits-mobile.png") });
    await page.evaluate(() => { location.hash = "tasks"; });
    await page.locator("#tasksView").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(capture, "tasks-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(capture, "tasks-desktop.png") });
    assert.equal((await stored()).notes[0].body, "Не удалять");
    assert.deepEqual(errors, []);
    console.log(`minimal workspace ok; isolated screenshots: ${capture}`);
    await context.close();
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
