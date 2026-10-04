const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-requested-polish-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Europe/Saratov" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage(); const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-04T10:00:00+04:00") });
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1"; url.hash = "calendar/week";
    await page.goto(url.href); await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      Object.assign(state, { tasks: [
        { id: "parent", title: "Подготовить проект", date: "2026-10-04", repeat: "none", completed: {}, dueDate: "2026-10-09", studySubjectId: "math" },
        { id: "daily", title: "Повторить материал", date: "2026-10-02", repeat: "daily", completed: { "2026-10-02": true }, checklist: [{ id: "old", title: "Прочитать" }], checklistLogs: { "2026-10-02": { old: { done: true, updatedAt: "2026-10-02T10:00:00Z" } } } },
        { id: "later", title: "Идея на потом", date: null, repeat: "none", completed: {} },
      ], habits: [], goals: [], notes: [], studyFiles: [], studySubjects: [{ id: "math", name: "Математика", color: "#7ca6ff" }], studyLessons: [{ id: "practice", subjectId: "math", weekday: 5, weekType: "all", lessonType: "practice", startTime: "11:30", endTime: "13:00" }] });
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-04", activeView: "overview", overviewMode: "week", densityPreference: "comfortable", accentPreference: "emerald" }));
    });
    await page.reload();
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    const go = async (hash) => {
      await page.evaluate((value) => { location.hash = value; window.scrollTo(0, 0); }, hash);
      const view = hash.startsWith("calendar/") ? "overview" : hash;
      await page.locator(`#${view}View`).waitFor({ state: "visible" });
    };
    for (const width of [1440, 900, 599, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      let anchor;
      for (const mode of ["day", "week", "month", "year", "week"]) {
        await page.locator(`[data-overview-mode="${mode}"]`).click();
        const box = await page.locator(".overview-mode-control").boundingBox();
        anchor ||= box;
        assert.ok(Math.abs(anchor.x - box.x) <= 1 && Math.abs(anchor.y - box.y) <= 1 && Math.abs(anchor.width - box.width) <= 1, `calendar tabs stay in place: ${width}/${mode}`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.setViewportSize({ width: 2560, height: 1200 });
    await page.locator(".calendar-time-scroll").waitFor({ state: "visible" });
    const comfortable = await page.locator(".calendar-time-scroll").boundingBox();
    await go("settings");
    await page.locator('[aria-labelledby="appearanceHeading"] > summary').click();
    const paletteSurfaces = [];
    for (const accent of ["emerald", "blue", "orange", "violet"]) {
      await page.locator(`.accent-option:has(input[value="${accent}"])`).click();
      const colors = await page.evaluate(() => ({ accent: document.documentElement.dataset.accent, sidebar: getComputedStyle(document.querySelector(".sidebar")).backgroundColor, nav: getComputedStyle(document.querySelector('.nav-tab[data-view="settings"]')).color, filter: getComputedStyle(document.querySelector(".brand-mark")).filter }));
      assert.equal(colors.accent, accent);
      if (accent !== "emerald") assert.notEqual(colors.nav, "rgb(41, 185, 156)");
      assert.equal(colors.filter === "none", accent === "emerald"); paletteSurfaces.push(colors.sidebar);
      await page.screenshot({ path: path.join(captures, `palette-${accent}.png`) });
    }
    assert.equal(new Set(paletteSurfaces).size, 4, "sidebar tint follows every palette");
    await page.locator("#densityPreference").selectOption("compact", { force: true });
    await go("calendar/week");
    await page.locator(".calendar-time-scroll").waitFor({ state: "visible" });
    const compact = await page.locator(".calendar-time-scroll").boundingBox();
    const sidebar = await page.locator(".sidebar").boundingBox();
    assert.ok(compact.width > comfortable.width + 500, "compact layout uses available width instead of a centered capped workspace");
    assert.ok(compact.x - sidebar.width <= 14, "compact layout removes wide sidebar gutter");
    await page.screenshot({ path: path.join(captures, "calendar-compact.png") });
    await page.reload(); assert.equal(await page.evaluate(() => document.documentElement.dataset.density), "compact");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), "violet");
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator("#activeDate").fill("2026-10-10"); await page.locator("#activeDate").dispatchEvent("change");
    await go("study");
    await page.locator('#studyHomeworkForm [name="subjectId"]').selectOption("math");
    assert.equal(await page.locator('#studyHomeworkForm [name="date"]').inputValue(), "2026-10-09", "homework deadline uses actual today, not selected Oct 10");
    assert.equal(await page.locator('#studyHomeworkForm [name="time"]').inputValue(), "11:30");
    await page.locator('#studyHomeworkForm [name="time"]').fill("10:15");
    await page.locator('#studyHomeworkForm [name="subjectId"]').dispatchEvent("change");
    assert.equal(await page.locator('#studyHomeworkForm [name="time"]').inputValue(), "10:15");
    await page.screenshot({ path: path.join(captures, "homework-mobile.png") });
    await go("calendar/week");
    await page.locator("#activeDate").fill("2026-10-04"); await page.locator("#activeDate").dispatchEvent("change");
    await go("tasks");
    const openSubtask = async (id) => {
      const row = page.locator(`[data-task-id="${id}"]`).first();
      await row.locator(".task-more > summary").click();
      await page.locator(".create-subtask:visible").click();
      await page.locator("#taskSubtaskDialog").waitFor({ state: "visible" });
    };
    await openSubtask("parent");
    const dialog = page.locator("#taskSubtaskDialog");
    assert.equal(await dialog.locator("fieldset").isVisible(), false);
    await dialog.locator('[name="title"]').fill("Собрать материалы");
    await page.screenshot({ path: path.join(captures, "subtask-mobile.png") });
    await dialog.locator('[type="submit"]').click();
    const parent = (await stored()).tasks.find((task) => task.id === "parent");
    assert.equal(parent.checklist.length, 1); assert.equal(parent.dueDate, "2026-10-09");
    assert.equal((await stored()).tasks.length, 3, "subtask is nested, not an extra task");
    await page.locator('[data-task-id="parent"] .task-checklist input').check();
    assert.equal((await stored()).tasks.find((task) => task.id === "parent").completed["2026-10-04"], undefined);
    await page.setViewportSize({ width: 320, height: 640 });
    await openSubtask("parent");
    await dialog.locator('[name="title"]').fill("Проверить расчёты");
    const dialogBox = await dialog.boundingBox();
    assert.ok(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 320 && dialogBox.y >= 0 && dialogBox.y + dialogBox.height <= 640);
    await page.screenshot({ path: path.join(captures, "subtask-small-mobile.png") });
    await dialog.locator('[type="submit"]').click();
    assert.equal((await stored()).tasks.find((task) => task.id === "parent").checklist.length, 2);
    await page.locator('#appToast').getByRole("button", { name: "Отменить", exact: true }).click();
    const undone = (await stored()).tasks.find((task) => task.id === "parent");
    assert.equal(undone.checklist.length, 1);
    assert.equal(undone.checklistLogs["2026-10-04"][undone.checklist[0].id].done, true, "undo preserves previous subtask completion");
    await page.setViewportSize({ width: 390, height: 900 });
    await openSubtask("daily"); await dialog.locator('[name="title"]').fill("Решить пример");
    assert.equal(await dialog.locator("fieldset").isVisible(), true);
    await dialog.locator('[type="submit"]').click();
    const recurring = (await stored()).tasks.find((task) => task.id === "daily");
    assert.equal(recurring.checklist.length, 1); assert.equal(recurring.completed["2026-10-02"], true);
    assert.ok((await stored()).tasks.some((task) => task.sourceTaskId === "daily" && task.date === "2026-10-04" && task.checklist.length === 2));
    await page.locator('[data-task-pane="later"]').click();
    await openSubtask("later"); await dialog.locator('[name="title"]').fill("Уточнить детали");
    await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "rhythm-day-state-v1") throw new DOMException("Full", "QuotaExceededError"); return window.originalSetItem.call(this, key, value); }; });
    await dialog.locator('[type="submit"]').click();
    assert.equal(await dialog.isVisible(), true); assert.equal(await dialog.locator('[name="title"]').inputValue(), "Уточнить детали");
    assert.equal((await stored()).tasks.find((task) => task.id === "later").checklist.length, 0);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await dialog.locator('[type="submit"]').click();
    assert.equal((await stored()).tasks.find((task) => task.id === "later").checklist.length, 1);
    await page.reload(); assert.ok(await page.locator('[data-task-id="later"] .task-checklist').count());
    assert.deepEqual(errors, []);
    console.log(`requested polish ok; isolated screenshots: ${captures}`);
    await context.close();
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
