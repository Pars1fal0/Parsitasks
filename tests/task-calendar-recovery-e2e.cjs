const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const observe = process.argv.includes("--observe"), findings = [];
  function check(name, passed, evidence) {
    findings.push({ name, passed: Boolean(passed), evidence });
    if (!observe) assert.ok(passed, name + ": " + JSON.stringify(evidence));
  }
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-task-recovery-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Europe/Saratov", locale: "ru-RU" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-04T10:00:00+04:00") });
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1"; url.hash = "tasks";
    await page.goto(url.href); await page.waitForSelector("#pageTitle");
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    const seed = async (tasks, view = "tasks") => {
      await page.evaluate(({ tasks, view }) => {
        if (window.originalWrite) Storage.prototype.setItem = window.originalWrite;
        const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
        Object.assign(state, { tasks, habits: [], goals: [], notes: [], studySubjects: [], studyLessons: [], studyFiles: [], taskOrder: {} });
        localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
        localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-04", activeView: view === "calendar/day" ? "overview" : view, overviewMode: "day", currentToday: "2026-10-04" }));
        location.hash = view;
      }, { tasks, view });
      const viewSelector = { "calendar/day": "#overviewView", timeline: "#timelineView", habits: "#habitsView", archive: "#archiveView" }[view] || "#tasksView";
      await page.reload(); await page.locator(viewSelector).waitFor({ state: "visible" });
    };
    const failWrites = () => page.evaluate(() => {
      window.originalWrite = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "rhythm-day-state-v1") throw new DOMException("Full", "QuotaExceededError");
        return window.originalWrite.call(this, key, value);
      };
    });
    const resumeWrites = () => page.evaluate(() => { Storage.prototype.setItem = window.originalWrite; });
    const task = (id) => page.locator('#taskList [data-task-id="' + id + '"]');
    const base = [
      { id: "a", title: "Первая задача", date: "2026-10-04", repeat: "none", completed: {} },
      { id: "b", title: "Вторая задача", date: "2026-10-04", repeat: "none", completed: {} },
    ];
    for (const action of ["complete", "delete", "reorder"]) {
      await seed(base);
      const before = await page.locator("#taskList .task-item").evaluateAll((nodes) => nodes.map((node) => node.dataset.taskId));
      await failWrites();
      if (action === "complete") await task("a").locator(".check-button").click();
      if (action === "delete") { await task("a").locator(".task-more > summary").click(); await task("a").locator(".delete-task").click(); }
      if (action === "reorder") await task(before[0]).locator(".drag-handle").press("ArrowDown");
      const current = await page.locator("#taskList .task-item").evaluateAll((nodes) => nodes.map((node) => ({ id: node.dataset.taskId, done: node.classList.contains("is-done") })));
      const toast = await page.locator("#appToast").innerText();
      check(action + " rollback restores the visible list", action === "reorder" ? JSON.stringify(current.map((item) => item.id)) === JSON.stringify(before) : current.some((item) => item.id === "a" && !item.done), { current, toast });
      check(action + " does not claim success on save failure", !/Задача выполнена|Задача удалена|порядок обновлен/.test(toast), toast);
      await resumeWrites();
      await page.locator("#quickTaskInput").fill("Контрольное сохранение");
      await page.locator('#quickTaskForm [type="submit"]').click();
      const saved = await stored();
      check(action + " failed mutation does not leak into the next save", saved.tasks.some((item) => item.id === "a" && item.completed["2026-10-04"] !== true) && (action !== "reorder" || !saved.taskOrder["2026-10-04"]), saved.taskOrder);
    }
    await seed([{ id: "old", title: "Вчерашнее дело", date: "2026-10-03", repeat: "none", completed: {} }]);
    await page.locator('[data-task-pane="backlog"]').click();
    await failWrites();
    await page.locator(".historical-task-item .task-more > summary").click();
    await page.locator(".historical-task-item").getByRole("button", { name: "Готово", exact: true }).click();
    check("failed backlog completion keeps the item unfinished", await page.locator(".historical-task-item").count() === 1, await page.locator("#appToast").innerText());
    await resumeWrites();
    await page.locator(".historical-task-item .task-more > summary").click();
    await page.locator(".historical-task-item").getByRole("button", { name: "Готово", exact: true }).click();
    check("backlog completion can be retried", (await stored()).tasks[0].completed["2026-10-03"] === true);
    await seed([{ id: "later", title: "Отложенное дело", date: null, repeat: "none", completed: {} }]);
    await page.locator('[data-task-pane="later"]').click();
    await failWrites();
    await page.locator("#laterTaskList .task-more > summary").click();
    await page.locator("#laterTaskList").getByRole("button", { name: "Удалить", exact: true }).click();
    check("failed deletion in Later preserves the item", await page.locator('#laterTaskList [data-task-id="later"]').count() === 1, await page.locator("#appToast").innerText());
    await seed(base);
    await task("a").locator(".check-button").click();
    await failWrites();
    await page.locator("#appToast").getByRole("button", { name: "Отменить", exact: true }).click();
    check("failed undo keeps the last successfully saved completion", await task("a").evaluate((node) => node.classList.contains("is-done")), await page.locator("#appToast").innerText());
    await resumeWrites();
    await page.locator("#quickTaskInput").fill("После неудачной отмены");
    await page.locator('#quickTaskForm [type="submit"]').click();
    check("failed undo cannot leak into the next save", (await stored()).tasks.find((item) => item.id === "a").completed["2026-10-04"] === true);
    await seed([
      { id: "series", title: "Повтор", date: "2026-10-01", repeat: "daily", excludedDates: { "2026-10-03": true }, completed: {} },
      { id: "moved", title: "Перенесённый повтор", date: "2026-10-04", repeat: "none", sourceTaskId: "series", movedFromDate: "2026-10-03", completed: {} },
    ]);
    await task("moved").locator(".task-more > summary").click(); await task("moved").locator(".delete-task").click();
    const confirmation = await page.locator("#confirmModal").isVisible();
    check("moved occurrence deletion offers to restore its original date", confirmation, await page.locator("#appToast").innerText());
    if (confirmation) {
      await page.locator("#confirmSecondary").click();
      const saved = await stored();
      check("restoring a moved occurrence preserves its recurring source", !saved.tasks.some((item) => item.id === "moved") && saved.tasks.find((item) => item.id === "series").excludedDates["2026-10-03"] !== true, saved.tasks);
    }
    await seed([
      { id: "series", title: "Старый повтор", date: "2026-10-01", repeat: "daily", excludedDates: { "2026-10-04": true }, completed: {} },
      { id: "legacy", title: "Старое перенесённое выполнение", date: "2026-10-04", repeat: "none", sourceTaskId: "series", completed: {} },
    ]);
    await task("legacy").locator(".task-more > summary").click(); await task("legacy").locator(".delete-task").click();
    check("legacy replacements still offer restoration", await page.locator("#confirmModal").isVisible());
    if (await page.locator("#confirmModal").isVisible()) {
      await page.locator("#confirmSecondary").click();
      check("legacy restoration uses the replacement date", (await stored()).tasks[0].excludedDates["2026-10-04"] !== true);
    }
    const archived = [{ id: "archived-task", title: "Завершённое дело", date: "2026-10-03", repeat: "none", completed: { "2026-10-03": true } }];
    for (const action of ["restoreOriginal", "restoreToday", "delete", "restoreBulk", "deleteBulk"]) {
      await seed(archived, "archive");
      await failWrites();
      if (action.endsWith("Bulk")) {
        await page.locator(".archive-item-select").check();
        await page.locator(action === "restoreBulk" ? "#archiveBulkRestore" : "#archiveBulkDelete").click();
      } else await page.locator(action === "delete" ? ".archive-delete-entry" : ".restore-task").click();
      await page.locator(action === "restoreOriginal" ? "#confirmSecondary" : "#confirmAccept").click();
      check("archive " + action + " rolls back visibly", await page.locator(".archive-item").count() === 1, await page.locator("#appToast").innerText());
      if (action.endsWith("Bulk")) check("archive " + action + " keeps selection for retry", await page.locator(".archive-item-select").count() > 0 && await page.locator(".archive-item-select").isChecked());
      await resumeWrites();
      await page.evaluate(() => { location.hash = "tasks"; });
      await page.locator("#tasksView").waitFor({ state: "visible" });
      await page.locator("#quickTaskInput").fill("После сбоя в архиве");
      await page.locator('#quickTaskForm [type="submit"]').click();
      const entry = (await stored()).tasks.find((item) => item.id === "archived-task");
      check("archive " + action + " cannot leak into a later save", entry?.date === "2026-10-03" && entry.completed["2026-10-03"] === true, entry);
      await page.evaluate(() => { location.hash = "archive"; });
      await page.locator("#archiveView").waitFor({ state: "visible" });
      if (action.endsWith("Bulk")) {
        await page.locator(".archive-item-select").check();
        await page.locator(action === "restoreBulk" ? "#archiveBulkRestore" : "#archiveBulkDelete").click();
      } else await page.locator(action === "delete" ? ".archive-delete-entry" : ".restore-task").click();
      await page.locator(action === "restoreOriginal" ? "#confirmSecondary" : "#confirmAccept").click();
      check("archive " + action + " can be retried", await page.locator(".archive-item").count() === 0);
      await page.locator("#appToast").getByRole("button", { name: "Отменить", exact: true }).click();
      const undone = (await stored()).tasks.find((item) => item.id === "archived-task");
      check("archive " + action + " successful action can be undone", undone?.date === "2026-10-03" && undone.completed["2026-10-03"] === true);
    }
    await seed(archived, "archive");
    await page.locator(".restore-task").click();
    await page.locator("#confirmAccept").click();
    await page.locator("#appToast").getByRole("button", { name: "Отменить", exact: true }).click();
    check("undoing archive restoration restores the original completion", (await stored()).tasks[0].date === "2026-10-03" && (await stored()).tasks[0].completed["2026-10-03"] === true);
    await seed([]);
    await page.locator("#openTaskForm").click();
    await page.locator("#taskTitle").fill("   ");
    await page.locator('#taskForm [type="submit"]').click();
    check("task form rejects a whitespace-only title without closing", (await stored()).tasks.length === 0 && await page.locator("#taskForm").isVisible());
    await page.locator("#taskTitle").fill("Проверка после исправления названия");
    await page.locator('#taskForm [type="submit"]').click();
    check("task creation can be retried after title validation", (await stored()).tasks[0]?.title === "Проверка после исправления названия");
    await seed([{ id: "full", title: "Полный список", date: "2026-10-04", repeat: "none", checklist: Array.from({ length: 50 }, (_, i) => ({ id: "item-" + i, title: "Пункт " + (i + 1) })) }]);
    await task("full").locator(".task-more > summary").click();
    await task("full").locator(".edit-task").click();
    await page.locator("#taskChecklistInput").fill("Не потерять новый пункт");
    await page.locator('#taskForm [type="submit"]').click();
    check("full checklist keeps the pending item and form open", await page.locator("#taskForm").isVisible() && await page.locator("#taskChecklistInput").inputValue() === "Не потерять новый пункт");
    if (await page.locator("#taskForm").isVisible()) {
      await page.locator("#taskChecklistEditorList .goal-checkpoint-remove").first().click();
      await page.locator('#taskForm [type="submit"]').click();
      const savedChecklist = (await stored()).tasks[0].checklist;
      check("checklist save can be retried after making room", savedChecklist.length === 50 && savedChecklist.some((item) => item.title === "Не потерять новый пункт"));
    }
    await seed([], "habits");
    await page.locator("#openHabitForm").click();
    await page.locator("#habitTitle").fill("   ");
    await page.locator('#habitForm [type="submit"]').click();
    check("habit form rejects a whitespace-only title without closing", (await stored()).habits.length === 0 && await page.locator("#habitForm").isVisible());
    await page.locator("#habitTitle").fill("Читать каждый день");
    await page.locator('#habitForm [type="submit"]').click();
    check("habit creation can be retried after title validation", (await stored()).habits[0]?.title === "Читать каждый день");
    await seed([], "timeline");
    const timelineSlot = page.locator('.timeline-hour-slot[data-hour="23"]');
    await timelineSlot.scrollIntoViewIfNeeded();
    const timelineBounds = await timelineSlot.boundingBox();
    await timelineSlot.click({ position: { x: timelineBounds.width - 20, y: timelineBounds.height * .8 } });
    check("timeline creation keeps the last quarter-hour", await page.locator("#taskStartTime").inputValue() === "23:45" && await page.locator("#taskEndTime").inputValue() === "23:59");
    await seed([{ id: "timeline-late", title: "Последний блок", date: "2026-10-04", repeat: "none", scheduleMode: "block", startTime: "23:45", endTime: "23:59", time: "23:59" }], "timeline");
    await page.locator('[data-task-id="timeline-late"] .timeline-create-neighbor-button').click();
    check("timeline neighboring task has a valid end-of-day interval", await page.locator("#taskStartTime").inputValue() === "23:45" && await page.locator("#taskEndTime").inputValue() === "23:59");
    await seed([{ id: "timeline-late", title: "Растянуть вечерний блок", date: "2026-10-04", repeat: "none", scheduleMode: "block", startTime: "23:30", endTime: "23:45", time: "23:45" }], "timeline");
    await page.locator('[data-task-id="timeline-late"] .timeline-resize-handle.is-end').press("ArrowDown");
    check("timeline resize can reach the day boundary", (await stored()).tasks[0].endTime === "23:59", (await stored()).tasks[0]);
    await seed([{ id: "timeline-move", title: "Перенос на конец дня", date: "2026-10-04", repeat: "none", scheduleMode: "block", startTime: "22:30", endTime: "22:59", time: "22:59" }], "timeline");
    const dragCard = page.locator('[data-task-id="timeline-move"]');
    await dragCard.scrollIntoViewIfNeeded();
    const dragBounds = await dragCard.boundingBox();
    const hourHeight = await dragCard.evaluate((node) => node.closest(".timeline-hour-slot").clientHeight);
    await dragCard.dispatchEvent("pointerdown", { button: 0, pointerId: 1, pointerType: "mouse", clientX: dragBounds.x + 40, clientY: dragBounds.y + 10 });
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: x, clientY: y, cancelable: true }));
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: x, clientY: y }));
    }, { x: dragBounds.x + 40, y: dragBounds.y + 10 + hourHeight });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks[0].startTime !== "22:30");
    check("timeline pointer drag preserves late start and duration", (await stored()).tasks[0].startTime === "23:30" && (await stored()).tasks[0].endTime === "23:59", (await stored()).tasks[0]);
    await seed([], "calendar/day");
    const slot = page.locator('.calendar-time-day[data-date="2026-10-04"] .calendar-hour-slot[data-time="23:00"]');
    await slot.scrollIntoViewIfNeeded();
    const size = await slot.boundingBox();
    await slot.click({ position: { x: size.width - 12, y: size.height * .8 } });
    const start = await page.locator("#taskStartTime").inputValue(), end = await page.locator("#taskEndTime").inputValue();
    check("last quarter-hour opens a valid task interval", start === "23:45" && end > start, { start, end });
    if (end > start) {
      await page.locator("#taskTitle").fill("Последняя задача дня");
      await page.locator('#taskForm [type="submit"]').click();
      check("late task survives saving", (await stored()).tasks.some((item) => item.startTime === "23:45" && item.endTime === "23:59"), (await stored()).tasks);
    }
    await seed([{ id: "late", title: "Вечернее дело", date: "2026-10-04", repeat: "none", completed: {}, scheduleMode: "block", startTime: "23:30", endTime: "23:45", time: "23:45" }], "calendar/day");
    await page.locator('[data-event-id="late"] .calendar-event-resize[data-edge="end"]').press("ArrowDown");
    const resized = (await stored()).tasks.find((item) => item.id === "late");
    check("late block can extend to the end of the day", resized.endTime === "23:59", { start: resized.startTime, end: resized.endTime });
    await seed([{ id: "late-move", title: "Вечерний перенос", date: "2026-10-04", repeat: "none", completed: {}, scheduleMode: "block", startTime: "22:30", endTime: "22:59", time: "22:59" }], "calendar/day");
    const dragTo = async (date) => {
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await page.locator('[data-event-id="late-move"]').dispatchEvent("dragstart", { dataTransfer: transfer });
      const target = page.locator('.calendar-time-day[data-date="' + date + '"] .calendar-hour-slot[data-time="23:00"]');
      const bounds = await target.boundingBox();
      await target.dispatchEvent("drop", { dataTransfer: transfer, clientY: bounds.y + bounds.height * .51 });
    };
    await dragTo("2026-10-04");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks[0].startTime !== "22:30");
    let moved = (await stored()).tasks[0];
    check("evening drag preserves the requested start and duration", moved.startTime === "23:30" && moved.endTime === "23:59", moved);
    await page.evaluate(() => { location.hash = "calendar/week"; });
    await page.locator(".calendar-time-grid.is-week").waitFor({ state: "visible" });
    await dragTo("2026-10-03");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks[0].date === "2026-10-03");
    moved = (await stored()).tasks[0];
    check("cross-date calendar drag uses the same day boundary", moved.startTime === "23:30" && moved.endTime === "23:59", moved);
    await page.evaluate(() => { location.hash = "calendar/day"; });
    await page.locator(".calendar-time-grid.is-day").waitFor({ state: "visible" });
    await page.setViewportSize({ width: 390, height: 850 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (await page.locator("#appToast .toast-close").isVisible()) await page.locator("#appToast .toast-close").click();
    await page.locator(".calendar-time-scroll").evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await page.screenshot({ path: path.join(captures, "late-calendar-mobile.png") });
    check("no runtime errors", errors.length === 0, errors);
    console.log(observe ? JSON.stringify({ findings, captures }, null, 2) : "Task/calendar recovery checks passed: " + findings.length + ". Captures: " + captures);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
