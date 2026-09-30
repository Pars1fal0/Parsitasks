const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({ args: [path.resolve(__dirname, ".."), "--e2e-test"], executablePath: require("electron") });
  const page = await app.firstWindow();
  await require("./navigation-fixture.cjs").enableAllSections(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  async function navigate(view) {
    const direct = page.locator(`.nav-tab[data-view="${view}"]:visible`).first();
    if (await direct.count()) await direct.click();
    else { await page.locator(".nav-more-summary:visible").click(); await page.locator(`.nav-more-menu [data-view="${view}"]`).click(); }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  async function state() { return page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1"))); }
  async function capture(name) {
    if (process.env.CAPTURE_STREAMLINING) await page.screenshot({ path: path.join(os.tmpdir(), `parsitasks-streamlined-${name}.png`), animations: "disabled" });
  }
  try {
    await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const date = "2026-09-30";
      const createdAt = "2026-09-01T06:00:00.000Z";
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify({ schemaVersion: 23, defaultsSeeded: true,
        tasks: Array.from({ length: 12 }, (_, index) => ({ id: `task-${index}`, title: index ? `Дело ${index}` : "Подготовить презентацию к встрече", date, createdAt, repeat: "none", priority: "medium", completed: {},
          checklist: index ? [] : [{ id: "a", title: "Собрать данные" }], checklistLogs: {} })),
        nutritionFoods: [{ id: "rice", name: "Рис", unit: "г", calories: 350, nutritionKnown: true }, { id: "unknown", name: "Неизвестный продукт", nutritionKnown: false }, { id: "zero", name: "Вода", calories: 0, nutritionKnown: true }],
      }));
      const now = new Date();
      const currentToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: date, currentToday, activeView: "tasks" }));
    });
    await page.reload(); await page.waitForSelector("#pageTitle");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator("#quickTaskInput").isVisible());
    assert.ok(await page.locator("#openTaskForm > span").isVisible());
    assert.equal(await page.locator("#openTaskForm").innerText(), "Новая задача");
    assert.equal(await page.locator("#sideProgressValue").textContent(), "0%");
    await capture("tasks-position");
    assert.ok((await page.locator("#taskList").boundingBox()).y < 440, `mobile tasks and pane navigation must start before 440px, got ${(await page.locator("#taskList").boundingBox()).y}`);
    assert.equal(await page.locator("#taskCounter").innerText(), "Выполнено 0 из 12");
    assert.equal(await page.locator("#taskList h3").first().evaluate((node) => getComputedStyle(node).webkitLineClamp), "none");
    await capture("tasks-dark-390");
    await page.locator("#openTaskForm").click();
    assert.equal(await page.locator("#taskExtraFields").getAttribute("open"), null);
    assert.equal(await page.locator("#taskRepeat").isVisible(), false);
    await capture("task-form-dark-390");
    await page.locator("#taskTitle").fill("Простая задача");
    await page.locator("#taskForm button[type=submit]").click();
    assert.equal((await state()).tasks.find((task) => task.title === "Простая задача").repeat, "none");
    await navigate("overview");
    for (const mode of ["week", "month", "year"]) {
      await page.locator(`[data-overview-mode="${mode}"]`).click();
      assert.equal(await page.locator("#weeklyTaskMetric").textContent(), "0%");
      assert.equal(await page.locator("#weeklyHabitMetric").textContent(), "—");
      assert.match(await page.locator("#weeklyTaskText").textContent(), /Выполнено 0 из 13/);
    }
    const calendarDay = page.locator('.heatmap-cell[data-date="2026-09-30"]');
    assert.match(await calendarDay.getAttribute("aria-label"), /задачи 0 из 13, привычки 0 из 0/);
    await calendarDay.hover();
    assert.match(await page.locator("[data-heatmap-tooltip]").innerText(), /задачи 0 из 13/);
    assert.equal((await page.locator("[data-heatmap-tooltip]").innerText()).includes("%"), false);
    await capture("calendar-year-dark-390");
    await navigate("tasks");
    await page.locator("#globalSearchButton").click();
    await page.locator("#globalSearchInput").fill("собрать данные");
    assert.match(await page.locator("#globalSearchResults").innerText(), /Презентац|презентац/);
    await page.locator("#globalSearchInput").press("Enter");
    await page.waitForFunction(() => document.querySelector(".task-checklist").open);
    assert.ok(await page.locator(".task-checklist input").isVisible());
    await page.locator(".task-filter-disclosure > summary").click();
    await page.locator("#taskSearch").fill("Собрать данные");
    assert.equal(await page.locator("#taskList .task-item").count(), 1);
    await page.locator("#clearTaskSearch").click();
    await page.locator("#globalSearchButton").click();
    await page.locator("#globalSearchInput").fill("Неизвестный продукт");
    assert.match(await page.locator("#globalSearchResults").innerText(), /Нет данных/);
    await page.locator("#globalSearchInput").fill("Вода");
    assert.match(await page.locator("#globalSearchResults").innerText(), /0 ккал/);
    await page.locator("#globalSearchClose").click();
    await navigate("study");
    assert.ok(await page.locator("#studySubjectForm").isVisible());
    assert.ok((await page.locator("#studySubjectForm").boundingBox()).y < 450);
    assert.equal(await page.locator("#studyHomeworkForm").isVisible(), false);
    await capture("study-first-dark-390");
    await page.locator('#studySubjectForm [name="name"]').fill("Математика");
    await page.locator('#studySubjectForm button[type=submit]').click();
    assert.ok(await page.locator("#studyHomeworkForm").isVisible());
    await page.locator('#studyHomeworkForm [name="title"]').fill("Сохранить этот черновик");
    await page.locator('[data-study-add-subject="homework"]').click();
    await page.locator('#studySubjectForm [name="name"]').fill("Физика");
    await page.locator('#studySubjectForm button[type=submit]').click();
    assert.equal(await page.locator('#studyHomeworkForm [name="title"]').inputValue(), "Сохранить этот черновик");
    const physics = (await state()).studySubjects.find((subject) => subject.name === "Физика");
    assert.equal(await page.locator('#studyHomeworkForm [name="subjectId"]').inputValue(), physics.id);
    await navigate("nutrition");
    assert.equal(await page.locator('[data-nutrition-period="day"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".nutrition-day-column").count(), 1);
    assert.equal(await page.locator(".nutrition-day-column").getAttribute("data-date"), "2026-09-30");
    await page.locator("#nutritionAddMeal").click();
    await page.locator("#nutritionMealTitle").fill("Обед");
    await page.locator("#nutritionMealIngredients").fill("Рис");
    await page.locator("#nutritionMealForm button[type=submit]").click();
    assert.equal((await state()).nutritionMeals.length, 0);
    assert.match(await page.locator("#nutritionIngredientsError").innerText(), /Строка 1/);
    await page.locator("#nutritionMealIngredients").fill("Рис 100 г");
    await page.locator("#nutritionMealForm button[type=submit]").click();
    assert.equal((await state()).nutritionMeals[0].ingredients[0].quantity, 100);
    assert.equal(await page.locator("#nutritionCaloriesMetric").innerText(), "350");
    await page.locator("#nutritionAddMeal").click();
    await page.locator("#nutritionMealTitle").fill("Ужин");
    await page.locator("#nutritionMealIngredients").fill("Соус 20 г");
    await page.locator("#nutritionMealForm button[type=submit]").click();
    assert.equal(await page.locator("#nutritionCaloriesMetric").innerText(), "350+");
    assert.match(await page.locator("#nutritionCalculationNote").innerText(), /Неполный расчёт/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture("nutrition-before-controls-dark-390");
    assert.ok((await page.locator(".nutrition-meal-card").first().boundingBox()).y < 650);
    await page.locator(".nutrition-meal-card").filter({ hasText: "Обед" }).getByRole("button", { name: "Действия: Обед" }).click();
    await page.locator(".nutrition-meal-card").filter({ hasText: "Обед" }).getByRole("button", { name: "Отметить съеденным", exact: true }).click();
    await page.locator('[data-nutrition-status="eaten"]').click();
    assert.equal(await page.locator(".nutrition-meal-card").count(), 1);
    assert.equal(await page.locator("#nutritionCaloriesMetric").innerText(), "350");
    assert.equal(await page.locator("#nutritionCalculationNote").isVisible(), false);
    await page.locator('[data-nutrition-status=""]').click();
    await capture("nutrition-dark-390");
    await page.locator('[data-nutrition-period="week"]').click();
    assert.equal(await page.locator(".nutrition-day-column").count(), 7);
    await page.reload(); await page.waitForSelector("#pageTitle");
    assert.equal(await page.locator('[data-nutrition-period="week"]').getAttribute("aria-pressed"), "true");
    await page.locator('[data-nutrition-period="day"]').click();
    for (const theme of ["light", "dark"]) {
      await navigate("settings");
      await page.locator("#themePreference").evaluate((field) => { field.closest("details").open = true; });
      await page.locator("#themePreference").selectOption(theme);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        for (const view of ["tasks", "nutrition", "study", "overview"]) {
          await navigate(view);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} must fit ${width}px`);
          if (view === "tasks") {
            assert.ok(await page.locator("#openTaskForm > span").isVisible());
            const button = await page.locator("#openTaskForm").boundingBox();
            assert.ok(button.x >= 0 && button.x + button.width <= width, `new task button must fit ${width}px`);
          }
          await capture(`${view}-${theme}-${width}`);
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log("e2e ok - compact task capture, readable titles, checklist search, subject setup, ingredient validation and day/eaten nutrition");
  } finally {
    await page.evaluate(() => document.querySelectorAll(".form-panel").forEach((panel) => panel.classList.add("is-collapsed"))).catch(() => {});
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
