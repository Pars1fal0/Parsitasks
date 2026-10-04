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
  const reload = async () => { await page.reload(); await page.waitForSelector("#pageTitle"); };
  try {
    await page.waitForSelector("#pageTitle");
    const dates = await page.evaluate(() => {
      const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const now = new Date();
      const today = key(now);
      now.setDate(now.getDate() - 1);
      const yesterday = key(now);
      now.setDate(now.getDate() + 2);
      const tomorrow = key(now);
      const stamp = new Date().toISOString();
      const stored = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      stored.tasks = [
        { id: "done", title: "Готовый отчёт", date: today, repeat: "none", completed: { [today]: true } },
        { id: "partial", title: "Посмотреть курс", date: today, repeat: "none", completed: {},
          checklist: [{ id: "step", title: "Выбрать курс" }], checklistLogs: { [today]: { step: { done: true, updatedAt: stamp } } } },
        { id: "overdue", title: "Старая задача", date: yesterday, repeat: "none", completed: {} },
        { id: "series", title: "Повторение", date: today, repeat: "daily", completed: {} },
      ];
      stored.habits = [];
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(stored));
      return { today, yesterday, tomorrow };
    });
    await reload();
    const logo = page.locator(".brand-mark");
    assert.equal(await logo.getAttribute("src"), "assets/icons/logo.png");
    assert.ok(await logo.evaluate((img) => img.complete && img.naturalWidth === 1254));
    assert.equal(await page.locator('link[rel="icon"]').getAttribute("href"), "assets/icons/icon-32.png");
    assert.match(await page.locator("#saveStatus").innerText(), /Сохранено на устройстве/);

    const partial = page.locator('#taskList [data-task-id="partial"]');
    await partial.locator(".task-more > summary").click();
    await partial.locator(".edit-task").click();
    await page.locator("#taskDeferred").check();
    assert.equal(await page.locator("#taskDate").isDisabled(), true);
    await page.locator('#taskForm button[type="submit"]').click();
    assert.equal((await state()).tasks.find((task) => task.id === "partial").date, null);
    assert.equal(await page.locator('#laterTaskList [data-task-id="partial"]').count(), 1);
    assert.equal(await partial.count(), 0);
    assert.equal(await page.locator("#taskCounter").innerText(), "1 отложено");
    assert.equal(await page.locator("#dayProgressValue").innerText(), "50%");
    await page.locator("#addLaterTask").click();
    assert.equal(await page.locator("#taskDeferred").isChecked(), true);
    await page.locator("#taskTitle").fill("Изучить новый язык");
    await page.locator('#taskForm button[type="submit"]').click();
    assert.equal((await state()).tasks.find((task) => task.title === "Изучить новый язык").date, null);
    await reload();
    assert.equal(await page.locator("#laterTaskCount").innerText(), "2");
    await page.locator("#globalSearchButton").click();
    await page.locator("#globalSearchInput").fill("Посмотреть курс");
    assert.match(await page.locator("#globalSearchResults").innerText(), /Позже · без даты/);
    await page.locator("#globalSearchInput").press("Enter");
    await page.locator("#laterTaskPanel[open]").waitFor();
    assert.notEqual(await page.locator("#laterTaskPanel").getAttribute("open"), null);
    const parked = page.locator('#laterTaskList [data-task-id="partial"]');
    await parked.locator(".task-more > summary").click();
    await parked.getByRole("button", { name: "Изменить", exact: true }).click();
    await page.locator("#taskDeferred").uncheck();
    await page.locator("#taskDate").fill(dates.today);
    await page.locator('#taskForm button[type="submit"]').click();
    assert.equal((await state()).tasks.find((task) => task.id === "partial").checklistLogs[dates.today].step.done, true);
    assert.equal(await partial.locator(".task-checklist summary").innerText(), "Подзадачи: 1 из 1");

    await page.locator("#taskSelectMode").click();
    assert.equal(await page.locator("#taskBulkForm").isVisible(), true);
    assert.equal(await page.locator('#taskBulkForm button[type="submit"]').isDisabled(), true);
    await page.locator('#taskList [data-task-id="done"] .task-select-control input').check();
    await partial.locator(".task-select-control input").check();
    await page.locator("#taskBulkDate").fill(dates.tomorrow);
    await page.locator('#taskBulkForm button[type="submit"]').click();
    const moved = (await state()).tasks;
    assert.equal(moved.find((task) => task.id === "done").completed[dates.tomorrow], true);
    assert.equal(moved.find((task) => task.id === "partial").checklistLogs[dates.tomorrow].step.done, true);
    await page.locator("#appToast").getByRole("button", { name: "Отменить", exact: true }).click();
    assert.equal((await state()).tasks.find((task) => task.id === "done").date, dates.today);
    assert.equal(await partial.count(), 1);

    await page.locator('[data-task-pane="backlog"]').click();
    const overdue = page.locator(".historical-task-item").filter({ hasText: "Старая задача" });
    await overdue.locator(".task-more > summary").click();
    await overdue.getByRole("button", { name: "Не выполнять", exact: true }).click();
    const hidden = (await state()).tasks.find((task) => task.id === "overdue");
    assert.equal(hidden.acknowledgedOverdue[dates.yesterday], true);
    assert.notEqual(hidden.completed[dates.yesterday], true);
    await page.locator('[data-task-pane="day"]').click();
    const recurring = page.locator('#taskList [data-task-id="series"]');
    await recurring.locator(".task-more > summary").click();
    await recurring.locator(".edit-task").click();
    assert.ok(await page.locator("#taskRepeatEditScope").isVisible());
    assert.match(await page.locator("#taskRepeatEditScope").innerText(), /Только выполнение на эту дату/);
    await page.locator("#closeTaskForm").click();

    await page.locator("#taskFilterSummary").click();
    await page.locator("#taskSearch").fill("Несуществующая формулировка");
    assert.equal(await page.locator("#taskEmpty").innerText(), "По этим фильтрам ничего не найдено");
    await page.locator("#taskEmptyReset").click();
    assert.equal(await page.locator("#taskSearch").inputValue(), "");
    await page.locator("#taskFilterSummary").click();

    await page.locator('.nav-tabs > [data-view="habits"]').click();
    await page.locator("#openHabitForm").click();
    assert.equal(await page.locator('#habitForm button[type="submit"]').innerText(), "Создать");
    assert.equal(await page.locator("#habitReminderTime").isVisible(), false);
    assert.equal(await page.locator('#habitType option[value="check"]').innerText(), "Выполнено");
    await page.locator("#habitTitle").fill("Прогулка");
    await page.locator('#habitForm button[type="submit"]').click();
    await page.locator('.nav-tabs > [data-view="tasks"]').click();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        const ui = JSON.parse(localStorage.getItem("rhythm-day-ui-v1"));
        ui.themePreference = value;
        localStorage.setItem("rhythm-day-ui-v1", JSON.stringify(ui));
      }, theme);
      await reload();
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator("#taskSelectMode").click();
        await partial.locator(".task-select-control input").check();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: path.join(os.tmpdir(), `parsitasks-later-${theme}-${width}.png`), animations: "disabled" });
        await page.locator("#taskBulkCancel").click();
      }
    }
    assert.deepEqual(errors, []);
    console.log("e2e ok - new branding, undated tasks, checklist retention, batch move and undo, clear labels and filters");
  } catch (error) {
    console.error("page errors", errors);
    await page.screenshot({ path: path.join(os.tmpdir(), "parsitasks-later-failed.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
