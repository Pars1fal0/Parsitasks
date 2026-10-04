const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-daily-flow-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Europe/Saratov" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-04T10:00:00+04:00") });
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1"; url.hash = "calendar/day";
    await page.goto(url.href); await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      Object.assign(state, {
        tasks: [
          { id: "plain", title: "Дело без времени", date: "2026-10-04", repeat: "none", completed: {}, checklist: [{ id: "one", title: "Первый пункт" }] },
          { id: "block", title: "Короткое занятие", date: "2026-10-04", repeat: "none", completed: {}, scheduleMode: "block", startTime: "11:45", endTime: "12:00", time: "12:00" },
          { id: "due", title: "Сдать отчёт", date: "2026-10-03", dueDate: "2026-10-04", dueTime: "12:00", repeat: "none", completed: {}, studySubjectId: "math" },
          { id: "daily", title: "Ежедневная задача", date: "2026-10-01", repeat: "daily", completed: {}, checklist: [{ id: "old", title: "Первый шаг" }] },
          { id: "future", title: "Занятие в другой день", date: "2026-10-05", repeat: "none", completed: {}, scheduleMode: "block", startTime: "15:00", endTime: "16:00", time: "16:00" },
        ],
        habits: [{ id: "water", title: "Вода", type: "number", goal: 3000, unit: "мл", repeat: "daily", startDate: "2026-10-01", logs: { "2026-10-01": 3000, "2026-10-02": 3000, "2026-10-03": 3000 }, freezeDays: {} }],
        studySubjects: [{ id: "math", name: "Математика", color: "#7ca6ff" }],
        studyLessons: [{ id: "practice", subjectId: "math", weekday: 5, weekType: "all", lessonType: "practice", startTime: "11:30", endTime: "13:00" }],
        studyFiles: [], goals: [], notes: [], boardItems: [{ id: "card", type: "text", text: "Важная информация", x: 0, y: 0, width: 240, height: 160 }],
      });
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-04", activeView: "overview", overviewMode: "day", accentPreference: "orange" }));
    });
    await page.reload();
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    const go = async (hash) => {
      await page.evaluate((value) => { location.hash = value; window.scrollTo(0, 0); }, hash);
      await page.locator(`#${hash.startsWith("calendar/") ? "overview" : hash}View`).waitFor({ state: "visible" });
    };
    assert.ok(await page.locator(".calendar-time-scroll").evaluate((node) => node.scrollTop > 600), "today starts around current time");
    assert.ok(await page.locator(".calendar-untimed").isVisible());
    assert.match(await page.locator(".calendar-untimed").innerText(), /Дело без времени/);
    assert.match(await page.locator(".calendar-untimed").innerText(), /Сдать отчёт/);
    const calendarSpace = async () => {
      await page.waitForFunction(() => {
        const node = document.querySelector(".calendar-time-scroll");
        return node?.clientHeight >= (innerWidth <= 680 ? 420 : 700);
      });
      const size = await page.locator(".calendar-time-scroll").evaluate((node) => ({ width: innerWidth, height: node.clientHeight, min: parseFloat(getComputedStyle(node).minHeight) }));
      assert.ok(size.height >= (size.width <= 680 ? 420 : 700), "calendar viewport is not squeezed by the header: " + JSON.stringify(size));
      assert.ok(await page.locator(".calendar-untimed").evaluate((node) => Boolean(node.compareDocumentPosition(document.querySelector(".calendar-time-scroll")) & Node.DOCUMENT_POSITION_PRECEDING)), "untimed tasks follow the timeline");
    };
    await calendarSpace();
    await page.locator("#activeDate").fill("2026-10-02"); await page.locator("#activeDate").dispatchEvent("change");
    assert.equal(await page.locator(".calendar-time-event.is-lesson").count(), 1);
    assert.equal(await page.locator(".calendar-selected-agenda").count(), 0, "a lesson-only timed schedule needs no repeated agenda");
    assert.match(await page.locator(".calendar-untimed").innerText(), /Ежедневная задача/, "untimed tasks stay available on study days");
    await page.locator("#activeDate").fill("2026-10-04"); await page.locator("#activeDate").dispatchEvent("change");
    await page.locator('.calendar-untimed [data-agenda-task-id="plain"] input').check();
    assert.equal((await stored()).tasks.find((task) => task.id === "plain").completed["2026-10-04"], true);
    await page.locator(".toast-close").click();
    const slot = page.locator('.calendar-time-day[data-date="2026-10-04"] .calendar-hour-slot[data-time="09:00"]');
    const box = await slot.boundingBox();
    await slot.click({ position: { x: box.width - 12, y: box.height * .76 } });
    assert.equal(await page.locator("#taskStartTime").inputValue(), "09:45");
    await page.locator('#taskFormPanel [aria-label="Закрыть форму"]').click();
    if (await page.locator("#confirmModal").isVisible()) await page.locator("#confirmAccept").click();
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await page.locator('[data-event-id="block"]').dispatchEvent("dragstart", { dataTransfer: transfer });
    const drop = page.locator('.calendar-time-day[data-date="2026-10-04"] .calendar-hour-slot[data-time="10:00"]');
    const dropBox = await drop.boundingBox();
    await drop.dispatchEvent("drop", { dataTransfer: transfer, clientY: dropBox.y + dropBox.height * .76 });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks.find((task) => task.id === "block").startTime === "10:45");
    assert.equal((await stored()).tasks.find((task) => task.id === "block").endTime, "11:00");
    await page.locator("#activeDate").fill("2026-10-05"); await page.locator("#activeDate").dispatchEvent("change");
    assert.ok(await page.locator(".calendar-time-scroll").evaluate((node) => node.scrollTop >= 14 * 96 - 1), "another day starts near its first event");
    await page.locator("#activeDate").fill("2026-10-04"); await page.locator("#activeDate").dispatchEvent("change");
    await go("habits");
    assert.match(await page.locator(".habit-streak").innerText(), /Серия: 3 дн/);
    assert.match(await page.locator(".habit-streak").innerText(), /Сегодня ещё не выполнено/);
    assert.match(await page.locator(".habit-stepper").last().innerText(), /100.*мл/);
    await page.locator(".habit-more > summary").click();
    await page.locator(".edit-habit:visible").click();
    await page.locator("#habitNumberStep").fill("250");
    await page.locator('#habitForm [type="submit"]').click();
    assert.match(await page.locator(".habit-stepper").last().innerText(), /250.*мл/);
    await page.reload();
    assert.equal((await stored()).habits[0].numberStep, 250);
    await page.locator(".habit-stepper").last().click();
    assert.equal((await stored()).habits[0].logs["2026-10-04"], 250);
    await page.setViewportSize({ width: 320, height: 850 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(captures, "habit-320.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go("tasks");
    const plainChecklist = page.locator('[data-task-id="plain"] .task-checklist');
    await plainChecklist.locator("summary").click();
    const fieldSize = await plainChecklist.locator('input[name="title"]').boundingBox();
    assert.ok(fieldSize.width > 200 && fieldSize.height >= 36, "inline text field does not inherit checkbox dimensions");
    for (const title of ["Второй пункт", "Третий пункт"]) {
      await plainChecklist.locator('input[name="title"]').fill(title);
      await plainChecklist.locator('input[name="title"]').press("Enter");
    }
    assert.equal((await stored()).tasks.find((task) => task.id === "plain").checklist.length, 3);
    await plainChecklist.locator('input[name="title"]').fill("Несохранённый пункт");
    await plainChecklist.getByRole("button", { name: "Удалить подзадачу: Второй пункт", exact: true }).click();
    assert.deepEqual((await stored()).tasks.find((task) => task.id === "plain").checklist.map((item) => item.title), ["Первый пункт", "Третий пункт"]);
    assert.equal(await plainChecklist.locator('input[name="title"]').inputValue(), "Несохранённый пункт");
    await page.locator("#appToast").getByRole("button", { name: "Отменить", exact: true }).click();
    assert.equal((await stored()).tasks.find((task) => task.id === "plain").checklist.length, 3);
    await page.locator(".toast-close").click();
    await page.setViewportSize({ width: 390, height: 850 });
    await plainChecklist.locator('input[name="title"]').fill("Следующий пункт");
    await plainChecklist.locator('input[name="title"]').focus();
    await plainChecklist.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const pins = page.locator(".nav-tabs > button.is-mobile-pin:visible");
    assert.equal(await pins.count(), 3);
    for (const button of await pins.all()) {
      assert.ok(await button.getAttribute("aria-label"));
      assert.equal(await button.locator("span").isVisible(), false);
      const size = await button.boundingBox(); assert.ok(size.height >= 56 && size.width >= 44);
      const symbol = await button.locator("use").getAttribute("href"); assert.match(symbol, /^#icon-nav-/);
    }
    await page.screenshot({ path: path.join(captures, "subtasks-390.png") });
    await page.setViewportSize({ width: 320, height: 850 });
    await plainChecklist.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(captures, "subtasks-320.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator(".nav-more > summary").click();
    assert.ok(await page.locator('.nav-more-menu [data-view="settings"] span').isVisible(), "expanded menu keeps readable names");
    await page.locator(".nav-more > summary").click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.ok(await page.locator('.nav-tabs > [data-view="tasks"] span').isVisible(), "desktop keeps section names");
    await page.screenshot({ path: path.join(captures, "subtasks-desktop.png") });
    const recurring = page.locator('[data-task-id="daily"] .task-checklist');
    await recurring.locator("summary").click();
    await recurring.locator('input[name="title"]').fill("Только сегодня");
    await recurring.locator('input[name="title"]').press("Enter");
    const records = (await stored()).tasks;
    assert.equal(records.find((task) => task.id === "daily").checklist.length, 1);
    const occurrence = records.find((task) => task.sourceTaskId === "daily");
    assert.equal(occurrence.checklist.length, 2); assert.equal(occurrence.date, "2026-10-04");
    await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "rhythm-day-state-v1") throw new DOMException("Full", "QuotaExceededError"); return window.originalSetItem.call(this, key, value); }; });
    await plainChecklist.locator('input[name="title"]').fill("Сохранить после ошибки");
    await plainChecklist.locator('input[name="title"]').press("Enter");
    assert.equal(await plainChecklist.locator('input[name="title"]').inputValue(), "Сохранить после ошибки");
    assert.match(await plainChecklist.locator('[role="alert"]').innerText(), /Не удалось сохранить/);
    await plainChecklist.getByRole("button", { name: "Удалить подзадачу: Первый пункт", exact: true }).click();
    assert.equal((await stored()).tasks.find((task) => task.id === "plain").checklist.length, 3);
    assert.equal(await plainChecklist.locator('input[name="title"]').inputValue(), "Сохранить после ошибки");
    assert.ok(await plainChecklist.getByRole("button", { name: "Удалить подзадачу: Первый пункт", exact: true }).isVisible());
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await plainChecklist.locator('input[name="title"]').press("Enter");
    assert.equal((await stored()).tasks.find((task) => task.id === "plain").checklist.length, 4);
    for (let count = 4; count > 0; count -= 1) await plainChecklist.locator(".task-checklist-remove").first().click();
    assert.equal(await plainChecklist.count(), 0, "deleting last item removes the whole subtask block");
    assert.ok(await page.locator('[data-task-id="plain"]').isVisible(), "the parent task remains");
    await page.locator("#appToast").getByRole("button", { name: "Отменить", exact: true }).click();
    assert.ok(await plainChecklist.locator('input[name="title"]').isVisible(), "undo restores the last item and expanded block");
    await plainChecklist.locator('input[name="title"]').fill("Новый первый пункт");
    await plainChecklist.locator('input[name="title"]').press("Enter");
    assert.equal((await stored()).tasks.find((task) => task.id === "plain").checklist.length, 2);
    await plainChecklist.locator("summary").click();
    assert.equal(await plainChecklist.locator('input[name="title"]').isVisible(), false);
    await page.locator('[data-task-pane="backlog"]').click();
    assert.ok(await page.locator(".task-backlog-hint").isVisible());
    await go("calendar/year");
    await page.locator('[data-chart-days="7"]').click();
    assert.match(await page.locator("#weeklyTaskText").innerText(), /за 7 дней/);
    await page.locator('[data-chart-days="90"]').click();
    assert.match(await page.locator("#weeklyHabitText").innerText(), /за 90 дней/);
    await go("study");
    assert.equal(await page.locator("#studyHomeworkForm").isVisible(), false);
    await page.locator("#studyJumpToHomeworkForm").click();
    await page.locator('#studyHomeworkForm [name="subjectId"]').selectOption("math");
    assert.equal(await page.locator('#studyHomeworkForm [name="date"]').inputValue(), "2026-10-09");
    assert.equal(await page.locator('#studyHomeworkForm [name="time"]').inputValue(), "11:30");
    await page.locator('#studyHomeworkForm [name="title"]').fill("Новый черновик");
    await page.locator("#studyHomeworkCancel").click();
    assert.equal(await page.locator("#studyHomeworkForm").isVisible(), false);
    await page.locator("#studyJumpToHomeworkForm").click();
    assert.equal(await page.locator('#studyHomeworkForm [name="title"]').inputValue(), "Новый черновик");
    await page.locator('#studyHomeworkForm [type="submit"]').click();
    assert.equal(await page.locator("#studyHomeworkForm").isVisible(), false);
    assert.equal((await stored()).tasks.filter((task) => task.title === "Новый черновик").length, 1);
    await page.locator('[data-study-tab="schedule"]').click();
    assert.equal(await page.locator("#studyLessonForm").isVisible(), false);
    assert.equal(await page.locator("[data-study-lesson-delete]").isVisible(), false);
    await page.locator("#studyNewLesson").click();
    await page.setViewportSize({ width: 320, height: 640 });
    await page.locator('#studyLessonForm [name="room"]').fill("204");
    await page.locator("#studyLessonCancel").click();
    await page.screenshot({ path: path.join(captures, "study-confirm-320.png") });
    await page.locator("#confirmCancel").click();
    assert.ok(await page.locator("#studyLessonForm").isVisible());
    assert.equal(await page.locator('#studyLessonForm [name="room"]').inputValue(), "204");
    await page.locator("#studyLessonCancel").click();
    await page.locator("#confirmAccept").click();
    assert.equal(await page.locator("#studyLessonForm").isVisible(), false);
    await page.locator("#studyNewLesson").click();
    await page.locator("#studyLessonCancel").click();
    assert.equal(await page.locator("#confirmModal").isVisible(), false, "blank lesson closes without warning");
    await page.locator("#studyScheduleList .study-row-menu > summary").click();
    assert.ok(await page.locator("[data-study-lesson-edit]").isVisible());
    await page.locator("[data-study-lesson-edit]").click();
    await page.locator('#studyLessonForm [name="room"]').fill("305");
    await page.locator('#studyLessonForm [type="submit"]').click();
    assert.equal((await stored()).studyLessons[0].room, "305");
    await go("board");
    assert.ok(await page.locator("#boardCardList").isVisible());
    assert.equal(await page.locator("#boardViewport").isVisible(), false);
    assert.ok(await page.getByRole("button", { name: "Добавить карточку на доску" }).isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(captures, "board-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator("#boardViewport").waitFor({ state: "visible" });
    const accent = await page.evaluate(() => ({ theme: getComputedStyle(document.documentElement).getPropertyValue("--teal").trim(), button: getComputedStyle(document.querySelector(".board-add-trigger")).backgroundColor }));
    assert.notEqual(accent.button, "rgb(8, 121, 105)");
    await go("calendar/day");
    await calendarSpace();
    await page.screenshot({ path: path.join(captures, "calendar-desktop.png") });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await calendarSpace();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(captures, `calendar-${width}.png`) });
      await go("calendar/week");
      await calendarSpace();
      await page.screenshot({ path: path.join(captures, `calendar-week-${width}.png`) });
      await go("calendar/day");
    }
    assert.deepEqual(errors, []);
    console.log(`Daily flow checks passed. Captures: ${captures}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
