const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const observe = process.argv.includes("--observe");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const capture = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-persona-fixes-"));
  const findings = [];
  const check = (name, condition, evidence) => {
    findings.push({ name, passed: Boolean(condition), evidence });
    if (!observe) assert.ok(condition, `${name}: ${JSON.stringify(evidence)}`);
  };
  try {
    const context = await browser.newContext({ viewport: { width: 320, height: 800 }, locale: "ru-RU", timezoneId: "Europe/Saratov" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-02T10:00:00+04:00"));
    const url = pathToFileURL(path.resolve(__dirname, "../app/index.html"));
    url.search = "automation=1";
    url.hash = "tasks";
    await page.goto(url.href);
    await page.waitForSelector("#pageTitle");
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    const seed = async (extra) => {
      await page.evaluate((extra) => {
        const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
        Object.assign(state, { tasks: [], habits: [], goals: [], notes: [], boardItems: [], studySubjects: [], studyLessons: [], studyFiles: [], categories: [{ id: "health", name: "Здоровье", color: "#7ca6ff" }] }, extra);
        localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
        localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-02", activeView: "tasks", navigationPreferences: { hidden: ["nutrition"], mobile: ["tasks", "habits", "overview", "study"] } }));
        history.replaceState(null, "", "?automation=1#tasks");
      }, extra);
      await page.reload();
      await page.waitForSelector("#pageTitle");
    };
    await seed({});
    await page.locator("#openTaskForm").click();
    await page.locator("#taskTitle").fill("Черновик без потери текста");
    await page.locator("#closeTaskForm").click();
    await page.locator("#confirmModal").waitFor({ state: "visible" });
    for (const width of [320, 360, 390, 599, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const geometry = await page.locator(".confirm-dialog").evaluate((dialog) => {
        const box = dialog.getBoundingClientRect();
        return { left: box.left, right: box.right, width: innerWidth, overflow: dialog.scrollWidth > dialog.clientWidth,
          actions: [...dialog.querySelectorAll("button")].filter((button) => !button.hidden).map((button) => { const b = button.getBoundingClientRect(); return { left: b.left, right: b.right }; }) };
      });
      await page.screenshot({ path: path.join(capture, `confirm-${width}.png`) });
      check(`confirmation fits ${width}px`, geometry.left >= 0 && geometry.right <= width && !geometry.overflow && geometry.actions.every((b) => b.left >= 0 && b.right <= width), geometry);
    }
    await page.locator("#confirmCancel").click();
    assert.equal(await page.locator("#taskTitle").inputValue(), "Черновик без потери текста");
    await page.locator("#closeTaskForm").click();
    await page.locator("#confirmAccept").click();

    await seed({ tasks: [{ id: "old", title: "Записать ребёнка на обследование", date: "2026-09-29", dueDate: "2026-10-03", dueTime: "12:00", categoryId: "health", priority: "high", repeat: "none", completed: {} }] });
    await page.locator('[data-task-pane="backlog"]').click();
    const backlog = await page.locator("#historicalTaskList").innerText();
    check("backlog exposes deadline/category/priority", /Здоровье/.test(backlog) && /Высокий/.test(backlog) && /12:00/.test(backlog), backlog);

    await seed({});
    const title = "Подготовить финальную версию презентации для клиента: проверить тексты, согласовать иллюстрации и приложить исходные материалы";
    await page.locator("#quickTaskInput").fill(title);
    await page.locator("#quickTaskInput").press("Enter");
    await page.locator("#appToast .toast-close").click();
    await page.locator("#taskList .task-more > summary").click();
    await page.getByRole("button", { name: "Изменить", exact: true }).filter({ visible: true }).click();
    await page.locator("#taskTitle").press("End");
    await page.locator("#taskTitle").pressSequentially(" уточнить");
    check("long title remains editable", (await page.locator("#taskTitle").inputValue()) === `${title} уточнить`, await page.locator("#taskTitle").inputValue());
    await page.locator('#taskForm button[type="submit"]').click();
    assert.equal((await state()).tasks[0].title, `${title} уточнить`);
    assert.equal(await page.locator("#taskTitle").getAttribute("maxlength"), "240");
    assert.equal(await page.locator("#quickTaskInput").getAttribute("maxlength"), "240");
    assert.equal(await page.locator('#studyHomeworkForm [name="title"]').getAttribute("maxlength"), "240");

    await seed({ goals: [{ id: "done-goal", title: "Готовое портфолио", dueDate: "", status: "done", steps: [] }] });
    await page.evaluate(() => { location.hash = "goals"; });
    await page.locator("#goalsView").waitFor({ state: "visible" });
    check("active goal filter excludes completed", await page.locator('#goalList [data-goal-id="done-goal"]').count() === 0, await page.locator("#goalList").innerText());
    if (!observe) {
      await page.locator("#goalFilter").selectOption("done");
      assert.equal(await page.locator('#goalList [data-goal-id="done-goal"]').count(), 1);
    }

    await seed({ goals: [{ id: "quota-goal", title: "Цель с двумя этапами", dueDate: "", status: "active", steps: [{ id: "step-1", title: "Первый этап", done: false }, { id: "step-2", title: "Второй этап", done: false }] }] });
    await page.evaluate(() => { location.hash = "goals"; });
    await page.locator("#goalsView").waitFor({ state: "visible" });
    await page.locator(".goal-details > summary").click();
    await page.evaluate(() => {
      window.originalGoalWrite = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "rhythm-day-state-v1") throw new DOMException("Quota exceeded", "QuotaExceededError");
        return window.originalGoalWrite.call(this, key, value);
      };
    });
    await page.locator(".goal-step").first().click();
    const goalQuota = { progress: await page.locator('.goal-item [role="progressbar"]').getAttribute("aria-valuenow"), persisted: (await state()).goals[0].steps[0].done,
      toast: await page.locator("#appToast").innerText() };
    check("goal progress rolls back on storage failure", goalQuota.progress === "0" && goalQuota.persisted === false && !/Этап выполнен/.test(goalQuota.toast), goalQuota);
    if (!observe) {
      const goalBeforeFailure = (await state()).goals[0];
      await page.locator("#openGoalForm").click();
      await page.locator("#goalTitle").fill("Несохранённая новая цель");
      await page.locator("#goalCheckpointInput").fill("Сохранить этап");
      await page.locator("#addGoalCheckpoint").click();
      await page.locator('#goalForm button[type="submit"]').click();
      assert.equal((await state()).goals.length, 1);
      assert.equal(await page.locator("#goalTitle").inputValue(), "Несохранённая новая цель");
      assert.equal(await page.locator("#goalFormPanel").isVisible(), true);
      assert.doesNotMatch(await page.locator("#appToast").innerText(), /Цель добавлена/);
      await page.locator("#closeGoalForm").click();
      await page.locator("#confirmAccept").click();
      await page.locator(".goal-menu > summary").click();
      await page.getByRole("button", { name: "Редактировать", exact: true }).click();
      await page.locator("#goalTitle").fill("Несохранённое исправление цели");
      await page.locator('#goalForm button[type="submit"]').click();
      assert.deepEqual((await state()).goals[0], goalBeforeFailure);
      assert.equal(await page.locator("#goalTitle").inputValue(), "Несохранённое исправление цели");
      await page.locator("#closeGoalForm").click();
      await page.locator("#confirmAccept").click();
      for (const action of ["Поставить на паузу", "В архив"]) {
        await page.locator(".goal-menu > summary").click();
        await page.getByRole("button", { name: action, exact: true }).click();
        assert.deepEqual((await state()).goals[0], goalBeforeFailure);
        assert.equal(await page.locator('#goalList [data-goal-id="quota-goal"]').count(), 1);
      }
      await page.locator(".goal-menu > summary").click();
      await page.getByRole("button", { name: "Удалить", exact: true }).click();
      await page.locator("#confirmAccept").click();
      assert.deepEqual((await state()).goals[0], goalBeforeFailure);
      assert.equal(await page.locator('#goalList [data-goal-id="quota-goal"]').count(), 1);
      assert.doesNotMatch(await page.locator("#appToast").innerText(), /Цель удалена/);
    }
    await page.evaluate(() => { Storage.prototype.setItem = window.originalGoalWrite; });
    if (!observe) {
      if ((await page.locator(".goal-details").getAttribute("open")) === null) await page.locator(".goal-details > summary").click();
      await page.locator(".goal-step").first().click();
      assert.equal((await state()).goals[0].steps[0].done, true);
      assert.equal(await page.locator('.goal-item [role="progressbar"]').getAttribute("aria-valuenow"), "50");
    }

    await seed({ tasks: [{ id: "daily", title: "Ежедневное семейное дело", date: "2026-09-01", repeat: "daily", categoryId: "health", priority: "high", dueDate: "2026-10-03", dueTime: "12:00", completed: {}, excludedDates: {} }] });
    await page.locator('[data-task-pane="backlog"]').click();
    const groupMeta = page.locator(".backlog-group > summary .backlog-group-meta");
    assert.equal(await groupMeta.isVisible(), true);
    assert.match(await groupMeta.innerText(), /Здоровье/);
    assert.match(await groupMeta.innerText(), /12:00/);
    assert.match(await groupMeta.innerText(), /Высокий/);
    await page.locator(".backlog-group > summary").click();
    const groupPriority = await groupMeta.locator(".priority-high").evaluate((el) => getComputedStyle(el).color);
    const rowPriority = await page.locator(".historical-task-item .priority-high").first().evaluate((el) => getComputedStyle(el).color);
    assert.equal(rowPriority, groupPriority);
    await page.locator(".backlog-group > summary").click();
    await page.locator("#taskSelectMode").click();
    await page.locator("#taskSelectAll").click();
    await page.locator("#taskBulkDate").fill("2026-10-02");
    await page.locator('#taskBulkForm button[type="submit"]').click();
    const confirmation = await page.locator("#confirmModal").isVisible();
    check("bulk repeats require an explicit strategy", confirmation, { taskCount: (await state()).tasks.length });
    if (!observe) {
      assert.match(await page.locator("#confirmMessage").innerText(), /31/);
      await page.locator("#confirmCancel").click();
      assert.equal((await state()).tasks.length, 1);
      await page.locator('#taskBulkForm button[type="submit"]').click();
      await page.locator("#confirmSecondary").click();
      const consolidated = await state();
      assert.equal(consolidated.tasks.length, 1);
      assert.equal(Object.keys(consolidated.tasks[0].acknowledgedOverdue).length, 31);
      assert.equal(Object.keys(consolidated.tasks[0].excludedDates).length, 0);
      await page.locator('[data-task-pane="day"]').click();
      await page.locator("#activeDate").fill("2026-09-30");
      await page.locator("#activeDate").dispatchEvent("change");
      assert.equal(await page.locator('#taskList [data-task-id="daily"]').count(), 1);
      assert.equal(await page.locator('#taskList [data-task-id="daily"] .check-button').getAttribute("aria-pressed"), "false");
      await page.locator('#appToast button').filter({ hasText: "Отменить" }).click();
      assert.equal(Object.keys((await state()).tasks[0].acknowledgedOverdue).length, 0);
      await page.locator('[data-task-pane="backlog"]').click();
      await page.locator("#taskSelectMode").click();
      await page.locator("#taskSelectAll").click();
      await page.locator('#taskBulkForm button[type="submit"]').click();
      await page.locator("#confirmAccept").click();
      assert.equal((await state()).tasks.length, 32);
      await page.locator('#appToast button').filter({ hasText: "Отменить" }).click();
      await page.locator("#taskSelectMode").click();
      await page.locator("#taskSelectAll").click();
      await page.locator("#taskBulkLater").click();
      await page.locator("#confirmSecondary").click();
      const later = await state();
      assert.equal(later.tasks.length, 2); assert.equal(later.tasks[1].date, null);
      assert.equal(Object.keys(later.tasks[0].acknowledgedOverdue).length, 31);
      await page.locator('#appToast button').filter({ hasText: "Отменить" }).click();
      const beforeQuota = await state();
      await page.locator("#taskSelectMode").click();
      await page.locator("#taskSelectAll").click();
      await page.evaluate(() => {
        window.originalStorageWrite = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "rhythm-day-state-v1") throw new DOMException("Quota exceeded", "QuotaExceededError");
          return window.originalStorageWrite.call(this, key, value);
        };
      });
      await page.locator('#taskBulkForm button[type="submit"]').click();
      await page.locator("#confirmSecondary").click();
      assert.deepEqual(await state(), beforeQuota);
      await page.locator('[data-task-pane="day"]').click();
      assert.equal(await page.locator('#taskList [data-task-id="daily"]').count(), 1);
      await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageWrite; });
      await seed({ tasks: [
        { id: "source", title: "Серия", date: "2026-09-01", repeat: "daily", completed: {}, excludedDates: {}, acknowledgedOverdue: { "2026-09-30": true } },
        { id: "consolidated", title: "Актуальное действие", date: null, repeat: "none", sourceTaskId: "source", movedFromDate: "2026-09-30", completed: {} },
      ] });
      await page.locator('[data-task-pane="later"]').click();
      await page.locator(".later-task-row .task-more > summary").click();
      await page.getByRole("button", { name: "Удалить", exact: true }).filter({ visible: true }).click();
      assert.equal(await page.locator("#confirmModal").isVisible(), false);
      assert.equal((await state()).tasks.length, 1);
      assert.equal((await state()).tasks[0].acknowledgedOverdue["2026-09-30"], true);
      await page.locator('#appToast button').filter({ hasText: "Отменить" }).click();
      assert.equal((await state()).tasks.length, 2);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ findings, capture, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
