const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const capture = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-ux-polish-"));
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: "ru-RU" });
    // A fresh profile and blocked network keep fixtures completely separate from real accounts.
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = pathToFileURL(path.resolve(__dirname, "../app/index.html"));
    url.search = "automation=1";
    url.hash = "tasks";
    await page.goto(url.href);
    await page.waitForSelector("#pageTitle");
    const dates = await page.evaluate(() => {
      const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
      const today = day(0), tomorrow = day(1);
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      state.tasks = Array.from({ length: 11 }, (_, index) => ({ id: `t${index}`, title: `Длинное название учебной задачи номер ${index}`, date: today, dueDate: index === 0 ? tomorrow : "", dueTime: index === 0 ? "11:30" : "", repeat: "none", completed: {} }));
      state.categories = [{ id: "work", name: "Работа", color: "#7ca6ff" }];
      state.habits = [{ id: "water", title: "Вода", goal: 8, unit: "стаканов", type: "number", startDate: today, repeat: "daily", logs: { [today]: 2 } }];
      state.studySubjects = [{ id: "math", name: "Математика", semester: "Осень", color: "#7ca6ff" }, { id: "language", name: "Язык", semester: "Осень", color: "#ffc47b" }];
      const weekday = new Date(`${tomorrow}T12:00:00`).getDay();
      state.studyLessons = [{ id: "practice", subjectId: "math", weekday, weekType: "all", lessonType: "practice", startTime: "11:30", endTime: "13:00" }, { id: "lecture", subjectId: "language", weekday, weekType: "all", lessonType: "lecture", startTime: "08:00", endTime: "09:30" }];
      state.studyFiles = []; state.notes = []; state.goals = []; state.boardItems = [];
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: today, activeView: "tasks", taskPane: "day", navigationPreferences: { hidden: ["nutrition"], mobile: ["tasks", "habits", "overview", "study"] } }));
      return { today, tomorrow };
    });
    await page.reload();
    await page.waitForSelector("#pageTitle");
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    const go = async (route, selector) => { await page.evaluate((hash) => { location.hash = hash; window.scrollTo(0, 0); }, route); await page.locator(selector).waitFor({ state: "visible" }); };

    assert.ok((await page.locator("#taskList .task-item").first().boundingBox()).y < 390);
    await page.locator("#quickTaskInput").fill("Спланировать день");
    await page.locator("#quickTaskInput").press("Enter");
    const quick = (await stored()).tasks.find((task) => task.title === "Спланировать день");
    assert.ok(quick); assert.equal(quick.time, "");
    assert.ok((await page.locator("#appToast").boundingBox()).height <= 80);
    await page.locator("#appToast").getByRole("button", { name: "Отменить", exact: true }).click();
    assert.equal((await stored()).tasks.some((task) => task.id === quick.id), false);
    await page.locator("#quickTaskInput").fill("Подготовить материалы к занятию и проверить все документы ".repeat(3));
    await page.locator("#quickTaskInput").press("Enter");
    assert.ok((await page.locator("#appToast").boundingBox()).height <= 80);
    await page.locator("#appToast").getByRole("button", { name: "Отменить", exact: true }).click();

    await page.locator("#openTaskForm").click();
    assert.equal(await page.locator("#taskCategoryId").isVisible(), true);
    assert.equal(await page.locator("#closeTaskForm").isVisible(), true);
    await page.locator("#taskTitle").fill("Раздельные даты");
    await page.locator("#taskExtraFields > summary").click();
    await page.locator("#taskDueDate").fill(dates.tomorrow);
    await page.locator("#taskDueTime").fill("11:30");
    await page.locator('.schedule-mode-control label:has(#taskScheduleDeadline)').click();
    await page.locator("#taskTime").fill("18:00");
    await page.setViewportSize({ width: 320, height: 900 });
    assert.equal(await page.locator('.schedule-mode-control span').evaluateAll((spans) => spans.every((span) => parseFloat(getComputedStyle(span).lineHeight) > 0 && span.scrollWidth <= span.clientWidth)), true);
    await page.screenshot({ path: path.join(capture, "task-form-320.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('#taskForm button[type="submit"]').click();
    const separate = (await stored()).tasks.find((task) => task.title === "Раздельные даты");
    assert.equal(separate.date, dates.today); assert.equal(separate.dueDate, dates.tomorrow);
    assert.equal(separate.time, "18:00"); assert.equal(separate.dueTime, "11:30");
    await page.locator("#appToast .toast-close").click();
    assert.equal(await page.locator("#appToast").isVisible(), false);

    await go("habits", "#habitsView");
    assert.equal(await page.locator(".habit-quick-adds button").count(), 1);
    assert.match(await page.locator(".habit-quick-adds button").innerText(), /\+5/);
    await page.getByRole("button", { name: "Увеличить Вода", exact: true }).click();
    assert.equal((await stored()).habits[0].logs[dates.today], 3);
    await page.locator("#appToast").getByRole("button", { name: "Отменить", exact: true }).click();
    assert.equal((await stored()).habits[0].logs[dates.today], 2);
    await page.locator(".habit-quick-adds button").click();
    assert.equal((await stored()).habits[0].logs[dates.today], 7);
    await page.locator("#appToast .toast-close").click();

    await go("study", "#studyView");
    assert.equal(await page.getByRole("button", { name: "Завершить семестр", exact: true }).isVisible(), false);
    await page.locator(".study-period-menu > summary").click();
    assert.equal(await page.getByRole("button", { name: "Завершить семестр", exact: true }).isVisible(), true);
    await page.locator(".study-period-menu > summary").press("Escape");
    assert.equal(await page.locator(".study-period-menu").getAttribute("open"), null);
    await page.locator(".study-period-menu > summary").click();
    await page.getByRole("button", { name: "Архив семестров", exact: true }).click();
    assert.equal(await page.locator(".study-archive-notice").isVisible(), true);
    await page.getByRole("button", { name: "К текущим предметам", exact: true }).click();
    assert.equal(await page.locator(".study-archive-notice").isVisible(), false);
    const subject = page.locator('#studyHomeworkForm [name="subjectId"]');
    const time = page.locator('#studyHomeworkForm [name="time"]');
    await subject.selectOption("math");
    assert.equal(await page.locator('#studyHomeworkForm [name="date"]').inputValue(), dates.tomorrow);
    assert.equal(await time.inputValue(), "11:30");
    assert.match(await page.locator("#studyDeadlineSuggestion").innerText(), /практика.*11:30/);
    await subject.selectOption("language");
    assert.equal(await time.inputValue(), "08:00");
    await time.fill("10:15"); await subject.selectOption("math");
    assert.equal(await time.inputValue(), "10:15");
    await time.fill(""); await subject.selectOption("language");
    assert.equal(await time.inputValue(), "");
    await page.locator("#studyJumpToHomeworkForm").click();
    assert.equal(await page.locator('#studyHomeworkForm [name="title"]').evaluate((input) => input === document.activeElement), true);

    await go("calendar/week", "#weekBoardGrid");
    assert.ok((await page.locator("#weekBoardGrid").boundingBox()).height < 140);
    const dayButton = page.locator(`.week-board-day[data-date="${dates.tomorrow}"] .week-board-header`);
    if (await dayButton.count()) {
      await dayButton.click();
      assert.equal(await page.locator("#activeDate").inputValue(), dates.tomorrow);
      assert.equal(await page.locator("#calendarWeekAgenda .calendar-study-event").count(), 2);
      assert.equal(await page.locator("#calendarWeekAgenda .calendar-deadline").count(), 2);
      assert.match(await page.locator("#calendarWeekAgenda").innerText(), /11:30/);
    }
    for (const width of [320, 390, 599, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [route, selector] of [["tasks", "#tasksView"], ["habits", "#habitsView"], ["study", "#studyView"], ["calendar/week", "#weekBoardGrid"], ["calendar/month", "#monthGrid"], ["goals", "#goalsView"]]) {
        await go(route, selector);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route} overflows at ${width}`);
        await page.screenshot({ path: path.join(capture, `${route.replace("/", "-")}-${width}.png`) });
      }
    }
    assert.deepEqual(errors, []);
    console.log(`ux polish ok - isolated local data - screenshots ${capture}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
