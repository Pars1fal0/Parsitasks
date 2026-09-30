const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({ args: [path.resolve(__dirname, ".."), "--e2e-test"], executablePath: require("electron") });
  const page = await app.firstWindow();
  await require("./navigation-fixture.cjs").enableAllSections(page);
  page.setDefaultTimeout(10000);
  page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function navigate(view) {
    const direct = page.locator(`.nav-tab[data-view="${view}"]:visible`).first();
    if (await direct.count()) await direct.click();
    else { await page.locator(".nav-more-summary").click(); await page.locator(`.nav-more-menu [data-view="${view}"]`).click(); }
  }
  async function day(value) { await page.locator("#activeDate").fill(value); await page.locator("#activeDate").dispatchEvent("change"); }
  async function state() { return page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1"))); }
  async function formFits(selector) {
    return page.locator(selector).evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return [...node.querySelectorAll("input, select, textarea")].every((item) => {
        const rect = item.getBoundingClientRect();
        return !rect.width || (rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1);
      });
    });
  }
  try {
    await page.waitForSelector("#pageTitle");
    await page.setViewportSize({ width: 1366, height: 900 });
    await day("2026-09-14");
    await navigate("habits");
    await page.locator("#openHabitForm").click();
    await page.locator("#habitTitle").fill("Тренировка");
    await page.locator("#habitRepeat").selectOption("weeklyGoal");
    await page.locator("#habitWeeklyTarget").fill("3");
    await page.locator("#habitReminderTime").fill("09:30");
    await page.locator("#habitForm button[type=submit]").click();
    assert.match(await page.locator(".habit-streak").innerText(), /За неделю: 0 из 3/);
    assert.equal(await page.locator("#habitDoneMetric").innerText(), "—");
    for (const date of ["2026-09-14", "2026-09-16", "2026-09-18"]) {
      await day(date); await page.locator(".habit-check-row .check-button").click();
    }
    await day("2026-09-20");
    assert.match(await page.locator(".habit-streak").innerText(), /3 из 3.*цель достигнута.*Серия: 1 нед/);
    assert.match(await page.locator(".habit-check-row").innerText(), /Цель недели достигнута/);
    await navigate("overview");
    await page.locator('[data-overview-mode="week"]').click();
    assert.equal(await page.locator("#weeklyHabitMetric").innerText(), "100%");
    await day("2026-09-21");
    assert.equal(await page.locator("#weeklyHabitMetric").innerText(), "0%");
    await navigate("habits");
    assert.match(await page.locator(".habit-streak").innerText(), /0 из 3.*Серия: 1 нед/);
    await page.locator(".habit-more summary").click();
    await page.locator(".edit-habit").click();
    assert.equal(await page.locator("#habitReminderTime").inputValue(), "09:30");
    await page.locator("#habitWeeklyTarget").fill("4");
    await page.locator("#habitForm button[type=submit]").click();
    await day("2026-09-20");
    assert.match(await page.locator(".habit-streak").innerText(), /3 из 3/);
    await day("2026-09-21");
    await page.locator("#openHabitFreeze").click();
    await page.locator("#habitFreezeList input").check();
    await page.locator('#habitFreezeForm input[value="period"]').check();
    await page.locator("#habitFreezeEnd").fill("2026-09-27");
    await page.locator("#habitFreezeSubmit").click();
    assert.equal(await page.locator("#habitFreezeDialog").isVisible(), false);
    assert.match(await page.locator(".habit-control").innerText(), /Заморожена/);
    await day("2026-09-28");
    assert.match(await page.locator(".habit-streak").innerText(), /Серия: 1 нед/);
    await page.reload(); await page.waitForSelector("#pageTitle");
    assert.equal((await state()).habits[0].weeklyTarget, 4);
    assert.equal((await state()).habits[0].reminderTime, "09:30");

    await navigate("tasks");
    await page.locator("#openTaskForm").click();
    await page.locator("#taskTitle").fill("Подготовиться к поездке");
    await page.locator("#taskExtraFields > summary").click();
    await page.locator("#taskRepeat").selectOption("daily");
    for (const title of ["Документы", "Зарядка"]) {
      await page.locator("#taskChecklistInput").fill(title); await page.locator("#taskChecklistInput").press("Enter");
    }
    await page.locator("#taskForm button[type=submit]").click();
    await page.locator(".task-checklist summary").click();
    await page.locator(".task-checklist label").filter({ hasText: "Документы" }).locator("input").check();
    await page.locator(".task-checklist label").filter({ hasText: "Зарядка" }).locator("input").check();
    assert.match(await page.locator(".task-checklist summary").innerText(), /2 из 2/);
    assert.equal((await state()).tasks[0].completed["2026-09-28"], undefined);
    await navigate("habits"); await navigate("tasks");
    assert.match(await page.locator(".task-checklist summary").innerText(), /2 из 2/);
    await day("2026-09-29");
    assert.match(await page.locator(".task-checklist summary").innerText(), /0 из 2/);
    await page.locator(".task-checklist summary").click();
    await page.locator(".task-checklist input").first().check();
    await page.reload(); await page.waitForSelector("#pageTitle");
    assert.match(await page.locator(".task-checklist summary").innerText(), /1 из 2/);
    await page.locator(".task-checklist summary").click();
    await page.locator(".task-checklist input").first().uncheck();
    await day("2026-09-28");
    assert.match(await page.locator(".task-checklist summary").innerText(), /2 из 2/);
    await page.locator("#taskList .task-more summary").click();
    await page.locator("#taskList .edit-task").click();
    await page.locator("#taskChecklistEditorList .goal-checkpoint-grip").first().press("ArrowDown");
    assert.equal(await page.locator("#taskChecklistEditorList input").first().inputValue(), "Зарядка");
    await page.locator("#taskChecklistEditorList input").first().fill("Зарядное устройство");
    await page.locator("#taskRepeatEditScope").getByText("Вся серия", { exact: true }).click();
    assert.equal(await page.locator('#taskRepeatEditScope input[value="series"]').isChecked(), true);
    await page.locator("#taskForm button[type=submit]").click();
    assert.match(await page.locator(".task-checklist summary").innerText(), /2 из 2/);

    for (const theme of ["light", "dark"]) {
      await navigate("settings");
      await page.locator("#themePreference").evaluate((field) => { field.closest("details").open = true; });
      await page.locator("#themePreference").selectOption(theme);
      await page.setViewportSize({ width: 390, height: 844 });
      for (const view of ["tasks", "habits"]) {
        await navigate(view);
        if (view === "tasks") await page.locator(".task-checklist summary").click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        if (process.env.CAPTURE_WEEKLY) await page.screenshot({ path: path.join(os.tmpdir(), `parsitasks-weekly-${view}-${theme}.png`), animations: "disabled" });
      }
      await page.locator(".habit-more summary").click();
      await page.locator(".edit-habit").click();
      assert.equal(await page.locator("#habitWeeklyTarget").inputValue(), "4");
      if (process.env.CAPTURE_WEEKLY) await page.locator("#habitForm").screenshot({ path: path.join(os.tmpdir(), `parsitasks-weekly-habit-form-${theme}.png`) });
      assert.ok(await formFits("#habitForm"));
      await page.locator("#closeHabitForm").click();
      await navigate("tasks");
      await page.locator("#taskList .task-more summary").click();
      await page.locator("#taskList .edit-task").click();
      assert.ok(await formFits("#taskForm"));
      await page.locator("#taskChecklistInput").click();
      assert.equal(await page.evaluate(() => document.activeElement.id), "taskChecklistInput");
      if (process.env.CAPTURE_WEEKLY) await page.screenshot({ path: path.join(os.tmpdir(), `parsitasks-weekly-task-form-${theme}.png`), animations: "disabled" });
      await page.locator("#closeTaskForm").click();
      await page.setViewportSize({ width: 1366, height: 900 });
    }
    assert.deepEqual(errors, []);
    console.log("e2e ok - flexible weekly habits, historical edits, freezes, reminders and per-occurrence checklists");
  } finally {
    await page.evaluate(() => document.querySelectorAll(".form-panel").forEach((panel) => panel.classList.add("is-collapsed"))).catch(() => {});
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
