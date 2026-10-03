const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({
    args: [path.resolve(__dirname, ".."), "--e2e-test"],
    executablePath: require("electron"),
  });
  const page = await app.firstWindow();
  await require("./navigation-fixture.cjs").enableAllSections(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    await page.waitForSelector("#pageTitle");
    await require("./navigation-fixture.cjs").navigate(page, "tasks");
    await page.locator("#openTaskForm").click();
    await page.locator("#taskTitle").fill("Подготовить презентацию");
    await page.locator('#taskForm button[type="submit"]').click();
    const task = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks.find((item) => item.title === "Подготовить презентацию"));
    assert.ok(task);

    await require("./navigation-fixture.cjs").navigate(page, "habits");
    await page.locator("#openHabitForm").click();
    await page.locator("#habitTitle").fill("Повторять материал");
    await page.locator('#habitForm button[type="submit"]').click();
    const habit = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).habits.find((item) => item.title === "Повторять материал"));
    assert.ok(habit);

    await require("./navigation-fixture.cjs").navigate(page, "goals");
    await page.locator("#openGoalForm").click();
    await page.locator("#goalTitle").fill("Сдать проект");
    await page.locator("#goalDueDate").fill(task.date);
    await page.locator(`[data-goal-task-link="${task.id}"]`).check();
    await page.locator(`[data-goal-habit-link="${habit.id}"]`).check();
    await page.locator(`[data-goal-habit-count="${habit.id}"]`).fill("1");
    if (process.env.CAPTURE_GOALS) {
      const formDesktopPath = path.join(os.tmpdir(), "parsitasks-goal-form-desktop.png");
      const formMobilePath = path.join(os.tmpdir(), "parsitasks-goal-form-mobile.png");
      await page.screenshot({ path: formDesktopPath, animations: "disabled", timeout: 10000 });
      await page.setViewportSize({ width: 390, height: 844 });
      const formBox = await page.locator("#goalFormPanel").boundingBox();
      assert.ok(formBox && formBox.x >= 0 && formBox.x + formBox.width <= 390.5);
      await page.screenshot({ path: formMobilePath, animations: "disabled", timeout: 10000 });
      await page.setViewportSize({ width: 1200, height: 800 });
      console.log(`goal form screenshots: ${formDesktopPath}, ${formMobilePath}`);
    }
    await page.locator('#goalForm button[type="submit"]').click();

    let state = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    const goal = state.goals.find((item) => item.title === "Сдать проект");
    assert.ok(goal);
    assert.deepEqual(goal.linkedTaskIds, [task.id]);
    assert.equal(goal.habitTargets[0].habitId, habit.id);
    assert.equal(goal.habitTargets[0].targetCount, 1);
    assert.equal(goal.steps.length, 0);
    assert.equal(goal.status, "active");
    const goalRow = page.locator(`[data-goal-id="${goal.id}"]`);
    assert.equal(await goalRow.locator('[role="progressbar"]').getAttribute("aria-valuenow"), "0");

    await require("./navigation-fixture.cjs").navigate(page, "tasks");
    await page.locator(`[data-task-id="${task.id}"] .check-button`).click();
    await require("./navigation-fixture.cjs").navigate(page, "goals");
    assert.equal(await goalRow.locator('[role="progressbar"]').getAttribute("aria-valuenow"), "50");

    await require("./navigation-fixture.cjs").navigate(page, "habits");
    await page.locator(`[data-habit-id="${habit.id}"] .check-button`).click();
    await require("./navigation-fixture.cjs").navigate(page, "goals");
    assert.equal(await goalRow.count(), 0);
    await page.locator("#goalFilter").selectOption("done");
    assert.equal(await goalRow.locator('[role="progressbar"]').getAttribute("aria-valuenow"), "100");
    assert.match(await goalRow.innerText(), /Достигнута/);
    state = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    assert.equal(state.goals.find((item) => item.id === goal.id).status, "done");

    await require("./navigation-fixture.cjs").navigate(page, "overview");
    await page.locator(".calendar-insights > summary").click();
    assert.equal(await page.locator("#goalWeekList .goal-week-row").count(), 1);
    assert.match(await page.locator("#goalWeekSummary").innerText(), /1 из 1/);
    assert.match(await page.locator("#goalWeekList").innerText(), /1 задача · 1 отметка привычек/);
    if (process.env.CAPTURE_GOAL_REVIEW) {
      await page.screenshot({ path: path.join(os.tmpdir(), "parsitasks-goal-week-desktop.png"), animations: "disabled" });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: path.join(os.tmpdir(), "parsitasks-goal-week-mobile.png"), animations: "disabled" });
      await page.setViewportSize({ width: 1200, height: 800 });
    }
    await page.locator("#goalWeekList .goal-week-title").click();
    assert.equal(await page.locator("#goalFilter").inputValue(), "done");
    assert.equal(await goalRow.isVisible(), true);

    await goalRow.locator(".goal-details summary").click();
    assert.match(await goalRow.innerText(), /Подготовить презентацию/);
    assert.match(await goalRow.innerText(), /Дней: 1\/1/);
    if (process.env.CAPTURE_GOALS) {
      const desktopPath = path.join(os.tmpdir(), "parsitasks-goals-activity-desktop.png");
      const mobilePath = path.join(os.tmpdir(), "parsitasks-goals-activity-mobile.png");
      await page.screenshot({ path: desktopPath, animations: "disabled", timeout: 10000 });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: mobilePath, animations: "disabled", timeout: 10000 });
      await page.setViewportSize({ width: 1200, height: 800 });
      console.log(`goal screenshots: ${desktopPath}, ${mobilePath}`);
    }
    await goalRow.locator(".goal-activity-row").first().click();
    assert.equal(await page.locator("#tasksView").isVisible(), true);
    await page.locator("#closeTaskForm").click();

    await require("./navigation-fixture.cjs").navigate(page, "habits");
    await page.locator(`[data-habit-id="${habit.id}"] .check-button`).click();
    await require("./navigation-fixture.cjs").navigate(page, "goals");
    assert.equal(await goalRow.count(), 0);
    await page.locator("#goalFilter").selectOption("active");
    assert.equal(await goalRow.locator('[role="progressbar"]').getAttribute("aria-valuenow"), "50");
    state = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    assert.equal(state.goals.find((item) => item.id === goal.id).status, "active");
    assert.deepEqual(errors, []);
    console.log("e2e ok - goal links, automatic task and habit progress, reversal, and navigation");
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
