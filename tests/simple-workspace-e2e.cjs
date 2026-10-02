const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({ args: [path.resolve(__dirname, ".."), "--e2e-test"], executablePath: require("electron") });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
  async function settings() {
    const direct = page.locator('.nav-tabs > [data-view="settings"]:visible');
    if (await direct.count()) await direct.click();
    else { await page.locator(".nav-more-summary:visible").click(); await page.locator('.nav-more-menu [data-view="settings"]').click(); }
    const appearance = page.locator('[aria-labelledby="appearanceHeading"]');
    if (await appearance.getAttribute("open") === null) await appearance.locator(":scope > summary").click();
  }
  try {
    await page.waitForSelector("#pageTitle");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.deepEqual(await page.locator('.nav-tabs > button[data-view]:visible').evaluateAll((buttons) => buttons.map((button) => button.dataset.view)), ["tasks", "habits", "overview"]);
    const date = await page.locator("#activeDate").inputValue();
    await page.evaluate((dateKey) => {
      const key = "rhythm-day-state-v1";
      const data = JSON.parse(localStorage.getItem(key));
      data.tasks = [{ id: "plain", title: "Купить хлеб", date: dateKey, repeat: "none", completed: {} },
        { id: "list", title: "Подготовить материалы к встрече", date: dateKey, repeat: "none", completed: {},
          checklist: Array.from({ length: 8 }, (_, index) => ({ id: `item-${index}`, title: `Пункт ${index + 1}` })),
          checklistLogs: { [dateKey]: { "item-0": { done: true, updatedAt: new Date().toISOString() }, "item-1": { done: true, updatedAt: new Date().toISOString() } } } }];
      data.notes = [{ id: "retained-note", title: "Скрытый раздел", text: "Данные остаются", createdAt: new Date().toISOString() }];
      localStorage.setItem(key, JSON.stringify(data));
    }, date);
    await page.reload(); await page.waitForSelector("#pageTitle");
    const plain = page.locator('.task-item[data-task-id="plain"]');
    const task = page.locator('.task-item[data-task-id="list"]');
    assert.equal(await plain.locator(".task-meta").isVisible(), false);
    assert.equal(await task.locator(".task-checklist summary").innerText(), "Шаги: 2 из 8");
    assert.equal(await task.locator('.task-checklist input').first().isVisible(), false);
    assert.equal(await task.locator(".edit-task").isVisible(), false);
    await task.locator(".task-checklist summary").focus();
    await page.keyboard.press("Enter");
    await task.locator('.task-checklist input').nth(2).check();
    assert.equal(await task.locator(".task-checklist summary").innerText(), "Шаги: 3 из 8");
    await task.locator(".check-button").click();
    assert.ok(await task.locator('.task-checklist input').first().isVisible(), "expanded checklist survives task rerender");
    await task.locator(".task-checklist summary").click();
    await task.locator(".task-more > summary").click();
    await task.locator(".duplicate-task").click();
    const copy = (await state()).tasks.find((item) => item.title.includes("копия"));
    assert.ok(copy);
    assert.equal(copy.checklist.length, 8);
    assert.deepEqual(copy.checklistLogs, {});
    await page.locator("#openTaskForm").click();
    assert.deepEqual(await page.locator('#taskForm input:visible, #taskForm select:visible, #taskForm textarea:visible').evaluateAll((fields) => fields.map((field) => field.id)), ["taskTitle", "taskDate", "taskDeferred", "taskCategoryId", "taskPriority"]);
    assert.equal(await page.locator('#taskForm button[type="submit"]').innerText(), "Создать");
    await page.locator("#taskTitle").fill("Позвонить другу");
    await page.locator('#taskForm button[type="submit"]').click();
    assert.equal((await state()).tasks.find((item) => item.title === "Позвонить другу").scheduleMode, "none");
    await plain.locator(".task-more > summary").click();
    await plain.locator(".edit-task").click();
    assert.equal(await page.locator('#taskForm button[type="submit"]').innerText(), "Сохранить");
    await page.locator("#resetTaskForm").click();
    await page.locator("#closeTaskForm").click();
    await page.locator("#taskFilterSummary").click();
    const categoryId = await page.locator('#taskCategoryFilter option').evaluateAll((options) => options.find((option) => !["all", "none"].includes(option.value)).value);
    await page.locator("#taskCategoryFilter").selectOption(categoryId);
    await page.locator("#openTaskForm").click();
    assert.equal(await page.locator("#taskCategoryId").inputValue(), categoryId);
    assert.equal(await page.locator("#taskExtraFields").getAttribute("open"), null, "default category must not expand the simple form");
    await page.locator("#closeTaskForm").click();
    await page.locator("#taskCategoryFilter").selectOption("all");
    await page.locator("#taskFilterSummary").click();
    await settings();
    await page.locator('[aria-labelledby="navigationSettingsHeading"] > summary').click();
    await page.locator('[data-navigation-key="visible-study"]').check();
    await page.locator('[data-navigation-key="pin-3"]').selectOption("study");
    await page.reload(); await page.waitForSelector("#pageTitle");
    assert.ok(await page.locator('.nav-tabs > [data-view="study"]').isVisible());
    assert.equal((await state()).notes[0].id, "retained-note");
    await page.locator('[aria-labelledby="appearanceHeading"] > summary').click();
    await page.locator('[aria-labelledby="navigationSettingsHeading"] > summary').click();
    await page.getByRole("button", { name: "Только основные разделы" }).click();
    assert.equal(await page.locator('.nav-tabs > [data-view="study"]').isVisible(), false);
    assert.deepEqual(await page.locator('.nav-tabs > button[data-view]:visible').evaluateAll((buttons) => buttons.map((button) => button.dataset.view)), ["tasks", "habits", "overview"]);
    assert.equal((await state()).notes[0].id, "retained-note");
    for (const theme of ["light", "dark"]) {
      await page.locator("#themePreference").evaluate((field) => { field.closest("details").open = true; });
      await page.locator("#themePreference").selectOption(theme);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await page.locator('.nav-tabs > [data-view="tasks"]').click();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: path.join(os.tmpdir(), `parsitasks-simple-tasks-${theme}-${width}.png`), animations: "disabled" });
        await page.locator("#openTaskForm").click();
        assert.equal(await page.locator("#taskExtraFields").getAttribute("open"), null);
        await page.screenshot({ path: path.join(os.tmpdir(), `parsitasks-simple-form-${theme}-${width}.png`), animations: "disabled" });
        await page.locator("#taskExtraFields > summary").click();
        assert.ok(await page.locator("#taskRepeat").isVisible());
        assert.ok(await page.locator("#taskChecklistInput").isVisible());
        await page.locator("#closeTaskForm").click();
        await settings();
      }
    }
    assert.deepEqual(errors, []);
    console.log("e2e ok - three default sections, optional sections, short task form, compact cards and collapsible persistent checklists");
  } finally { await app.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
