const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({ args: [path.resolve(__dirname, ".."), "--e2e-test"], executablePath: require("electron") });
  const page = await app.firstWindow();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  const capture = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-planning-"));
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
  const go = async (view) => {
    await page.evaluate((hash) => { location.hash = hash; }, view === "overview" ? "calendar/week" : view);
    await page.locator(`#${view === "overview" ? "overview" : view}View`).waitFor({ state: "visible" });
  };
  try {
    await require("./navigation-fixture.cjs").enableAllSections(page);
    const dates = await page.evaluate(() => {
      const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
      const today = day(0), yesterday = day(-1), old = day(-40), due = day(4), tomorrow = day(1);
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      state.tasks = [
        { id: "hw", title: "Подготовить решение", studySubjectId: "math", date: today, dueDate: due, dueTime: "08:00", repeat: "none", completed: {} },
        { id: "old", title: "Старая задача", date: old, repeat: "none", completed: {} },
        { id: "yesterday", title: "Вчерашняя задача", date: yesterday, repeat: "none", completed: {} },
        { id: "later", title: "Идея на будущее", date: null, repeat: "none", completed: {} },
        { id: "daily", title: "Ежедневное чтение", date: yesterday, repeat: "daily", completed: { [yesterday]: true } },
      ];
      state.habits = [{ id: "water", title: "Вода", type: "number", goal: 2000, unit: "мл", startDate: today, repeat: "daily", logs: {} }];
      state.studySubjects = [{ id: "math", name: "Математика", color: "#6dbfac", teacher: "Преподаватель" }];
      state.studyLessons = [{ id: "lesson", subjectId: "math", weekday: new Date().getDay(), weekType: "all", lessonType: "practice", startTime: "08:00", endTime: "09:30", room: "501" }];
      state.goals = [{ id: "g", title: "Учебная цель", linkedTaskIds: ["daily"], taskTargets: [{ taskId: "daily", mode: "count", targetCount: 3, startDate: today }], steps: [] }];
      state.notes = []; state.boardItems = [{ id: "board-text", type: "text", text: "Секретный проект орбита", x: 8000, y: 8000, width: 360, height: 140, fontSize: 32 }];
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      return { today, yesterday, old, due, tomorrow };
    });
    await page.reload(); await page.waitForSelector("#pageTitle"); await go("tasks");
    await page.locator('[data-task-pane="later"]').click();
    assert.equal(await page.locator("#laterTaskPanel").isVisible(), true);
    assert.equal(await page.locator("#taskList").isVisible(), false);
    await page.reload(); await page.waitForSelector("#pageTitle");
    assert.equal(await page.locator('#tasksView').getAttribute("data-pane"), "later");
    await page.locator('[data-task-pane="backlog"]').click();
    assert.equal(await page.locator(".historical-task-item").count(), 2);
    await page.locator("#activeDate").evaluate((input, date) => { input.value = date; input.dispatchEvent(new Event("change", { bubbles: true })); }, dates.old);
    assert.equal(await page.locator(".historical-task-item").count(), 2, "backlog always uses today, not browsed date");
    await page.locator("#taskSelectMode").click(); await page.locator("#taskSelectAll").click();
    await page.locator("#taskBulkLater").click();
    assert.equal((await stored()).tasks.filter((task) => task.date === null).length, 3);
    await page.locator("#appToast").getByRole("button", { name: "Отменить", exact: true }).click();
    assert.equal((await stored()).tasks.filter((task) => task.date === null).length, 1);
    await page.locator('[data-task-pane="day"]').click();
    await page.locator("#activeDate").fill(dates.today); await page.locator("#activeDate").dispatchEvent("change");
    const hw = page.locator('#taskList [data-task-id="hw"]');
    await page.locator("#taskSelectMode").click(); await hw.locator('.task-select-control input').check();
    await page.locator("#taskBulkDate").fill(dates.tomorrow); await page.locator('#taskBulkForm button[type="submit"]').click();
    assert.equal((await stored()).tasks.find((task) => task.id === "hw").dueDate, dates.due);
    await go("study"); await page.locator('[data-study-tab="homework"]').click();
    assert.match(await page.locator("#studyHomeworkList").innerText(), /Подготовка/);
    await go("overview");
    await page.locator('[data-overview-mode="week"]').click();
    assert.ok(await page.locator("#weekBoardGrid .calendar-study-event").count());
    await page.locator('#overviewView [data-study-layer]').uncheck();
    assert.equal(await page.locator("#weekBoardGrid .calendar-study-event").count(), 0);
    await page.locator('#overviewView [data-study-layer]').check();
    await go("timeline"); await page.locator("#activeDate").fill(dates.today); await page.locator("#activeDate").dispatchEvent("change");
    const lesson = page.locator(".timeline-task.is-study-event");
    assert.equal(await lesson.count(), 1); assert.equal(await lesson.locator(".timeline-menu-button,.timeline-resize-handle").count(), 0);
    await lesson.locator(".timeline-task-main").click(); assert.equal(await page.locator("#studyView").isVisible(), true);
    await go("goals"); assert.equal(await page.locator('[data-goal-id="g"] [role="progressbar"]').getAttribute("aria-valuenow"), "0");
    await page.locator("#openGoalForm").click(); await page.locator("#goalTitle").fill("Три дня чтения");
    await page.locator('[data-goal-task-link="daily"]').check();
    assert.equal(await page.locator('[data-goal-task-mode="daily"]').inputValue(), "count");
    assert.equal(await page.locator('[data-goal-task-start="daily"]').inputValue(), dates.today);
    await page.locator('[data-goal-task-count="daily"]').fill("3");
    await page.locator('[data-goal-task-count="daily"]').dispatchEvent("change");
    assert.match(await page.locator(".goal-task-target").innerText(), /Уже засчитано: 0 из 3/);
    await page.locator('#goalForm button[type="submit"]').click();
    assert.equal((await stored()).goals.find((goal) => goal.title === "Три дня чтения").taskTargets[0].targetCount, 3);
    await go("tasks"); await page.locator("#openTaskForm").click(); await page.locator("#taskTitle").fill("Разовый план со сроком");
    await page.locator("#taskDueSection > summary").click();
    await page.locator("#taskDueDate").fill(dates.due); await page.locator("#taskDueTime").fill("16:00");
    await page.locator("#taskDueReminder").selectOption("60");
    await page.locator('#taskForm button[type="submit"]').click();
    const withDeadline = (await stored()).tasks.find((task) => task.title === "Разовый план со сроком");
    assert.equal(withDeadline.date, dates.today); assert.equal(withDeadline.dueDate, dates.due); assert.equal(withDeadline.dueReminderOffset, "60");
    await go("journal"); await page.locator("#noteNew").click();
    await page.locator("#noteTitle").fill("Черновик для проверки"); await page.locator("#noteBody").fill("Несохранённая информация");
    assert.match(await page.locator("#noteStatus").innerText(), /Черновик/);
    await page.reload(); await page.waitForSelector("#pageTitle"); await go("journal");
    assert.equal(await page.locator("#noteBody").inputValue(), "Несохранённая информация");
    await page.locator('.note-save').click(); assert.equal((await stored()).notes.length, 1);
    await page.locator("#noteBody").fill("Продолжить после перехода");
    await page.locator("#globalSearchButton").click(); await page.locator("#globalSearchInput").fill("Ежедневное чтение");
    await page.locator("#globalSearchInput").press("Enter");
    await page.locator("#confirmModal").waitFor({ state: "visible" });
    assert.match(await page.locator("#confirmModal").innerText(), /черновик/);
    await page.locator("#confirmAccept").click(); await go("journal");
    assert.equal(await page.locator("#noteBody").inputValue(), "Продолжить после перехода"); await page.locator('.note-save').click();
    await page.locator("#globalSearchButton").click(); await page.locator("#globalSearchInput").fill("орбита");
    await page.locator("#globalSearchInput").press("Enter"); await page.locator("#boardView").waitFor({ state: "visible" });
    await page.locator('.board-item.is-selected').waitFor({ state: "visible" });
    assert.equal(await page.locator('.board-item.is-selected').count(), 1);
    await page.locator("#globalSearchButton").click(); await page.locator("#globalSearchInput").fill("Математика");
    await page.locator('.global-search-result').filter({ has: page.locator('.is-subject') }).click();
    await page.locator("#studyView").waitFor({ state: "visible" });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const view of ["tasks", "overview", "journal", "habits", "settings"]) {
        await go(view);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} fits ${width}px`);
        if (width < 680) {
          assert.ok((await page.locator(".sidebar").boundingBox()).height <= 66, "consistent compact mobile header");
          if (view === "overview") {
            assert.equal(await page.locator(".calendar-insights, .goal-week-review").count(), 0);
            assert.ok((await page.locator(".calendar-time-scroll").boundingBox()).y < 500, "calendar on first screen");
          }
          if (view === "journal") {
            const title = await page.locator("#noteTitle").boundingBox();
            const header = await page.locator(".notes-form-top").boundingBox();
            assert.ok(title.y >= header.y + header.height, "note title must not be covered by sticky toolbar");
          }
        }
        await page.screenshot({ path: path.join(capture, `${view}-${width}.png`), animations: "disabled" });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await go("settings");
    const before = await stored();
    const payload = { app: "Parsitasks", exportedAt: new Date().toISOString(), state: { notes: [{ id: "imported", title: "Из копии", body: "Текст" }] } };
    const upload = () => page.locator("#importFile").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)) });
    await upload(); await page.locator("#confirmModal").waitFor({ state: "visible" });
    const noteCount = page.locator(".confirm-details dt").filter({ hasText: /^заметок$/ });
    assert.equal(await noteCount.evaluate((node) => node.nextElementSibling.textContent), "1");
    await page.locator("#confirmCancel").click(); assert.deepEqual((await stored()).tasks, before.tasks);
    await upload(); await page.locator("#confirmAccept").click();
    assert.equal((await stored()).notes[0].id, "imported"); assert.equal((await stored()).tasks.length, 0);
    assert.deepEqual(errors, []);
    console.log(`e2e ok - planning tabs, all backlog, deadline isolation, study layers, goal counts, note recovery, search, import, mobile; screenshots: ${capture}`);
  } catch (error) {
    console.error("planning page errors", errors);
    await page.screenshot({ path: path.join(capture, "failed.png"), fullPage: true }).catch(() => {});
    console.error(`planning failure screenshot: ${capture}`);
    throw error;
  } finally { await app.evaluate(({ app: main }) => main.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
