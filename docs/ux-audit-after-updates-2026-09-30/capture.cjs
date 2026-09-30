const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({
    args: [path.resolve(__dirname, "../.."), "--e2e-test"],
    executablePath: require("electron"),
  });
  const page = await app.firstWindow();
  page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const measurements = {};
  async function navigate(view) {
    const direct = page.locator(`.nav-tab[data-view="${view}"]:visible`).first();
    if (await direct.count()) await direct.click();
    else {
      await page.locator(".nav-more-summary:visible").click();
      await page.locator(`.nav-more-menu [data-view="${view}"]`).click();
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  async function capture(name) {
    await page.screenshot({ path: path.join(__dirname, `${name}.png`), animations: "disabled" });
  }
  try {
    await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const date = "2026-09-30";
      const createdAt = "2026-09-01T06:00:00.000Z";
      const titles = ["Подготовить презентацию к встрече", "Отправить документы", "Купить продукты", "Позвонить в поликлинику", "Ответить на письма", "Проверить оплату", "Разобрать фотографии", "Записаться на курс", "Прочитать главу", "Забрать заказ", "Сделать резервную копию", "Согласовать поездку"];
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify({
        schemaVersion: 23, defaultsSeeded: true, profile: { timeZone: "Europe/Saratov" },
        categories: [{ id: "work", name: "Работа", color: "#4f8cff", createdAt }, { id: "home", name: "Личное", color: "#19b394", createdAt }],
        tasks: titles.map((title, index) => ({
          id: `task-${index}`, title, date, createdAt, repeat: index === 0 ? "daily" : "none",
          categoryId: index < 2 ? "work" : "home", priority: index < 2 ? "high" : "medium",
          scheduleMode: index === 0 ? "block" : "none", startTime: index === 0 ? "14:00" : "", endTime: index === 0 ? "15:00" : "",
          completed: index === 4 ? { [date]: true } : {},
          checklist: index === 0 ? [{ id: "a", title: "Собрать данные" }, { id: "b", title: "Подготовить слайды" }] : [],
          checklistLogs: {},
        })).concat([{ id: "old", title: "Разобрать старую заявку", date: "2026-09-28", createdAt, repeat: "none", completed: {} }]),
        habits: [
          { id: "exercise", title: "Тренировка", type: "check", repeat: "weeklyGoal", weeklyTarget: 3, reminderTime: "18:30", startDate: "2026-09-01", createdAt, logs: { "2026-09-28": true, "2026-09-29": true } },
          { id: "water", title: "Вода", type: "number", repeat: "daily", goal: 8, step: 1, unit: "стаканов", startDate: "2026-09-01", createdAt, logs: { [date]: 3 } },
          { id: "reading", title: "Чтение", type: "check", repeat: "daily", startDate: "2026-09-01", createdAt, logs: { [date]: true } },
        ],
        nutritionFoods: [{ id: "rice", name: "Рис", unit: "г", calories: 350, protein: 7, fat: 1, carbs: 78, nutritionKnown: true, createdAt }, { id: "unknown", name: "Продукт без калорий", unit: "г", nutritionKnown: false, createdAt }],
        nutritionMeals: [
          { id: "breakfast", title: "Завтрак", date, type: "breakfast", status: "eaten", createdAt, manualNutrition: true, nutrition: { calories: 400, protein: 20, fat: 10, carbs: 55 } },
          { id: "dinner", title: "Рис с курицей", date, type: "dinner", status: "planned", createdAt, ingredients: [{ id: "r", foodId: "rice", name: "Рис", quantity: 100, unit: "г" }, { id: "c", name: "Курица", quantity: 150, unit: "г" }] },
        ], nutritionSettings: { targets: { calories: 2000, protein: 100, fat: 65, carbs: 250 } },
      }));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: date, activeView: "tasks" }));
    });
    await page.reload();
    await page.waitForSelector("#pageTitle");
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const view of ["tasks", "habits", "overview", "nutrition", "study", "journal", "goals", "board", "settings"]) {
        await navigate(view);
        measurements[`${view}-${width}`] = await page.evaluate(() => ({
          height: document.documentElement.scrollHeight,
          overflow: document.documentElement.scrollWidth - innerWidth,
          firstTaskTop: document.querySelector("#taskList")?.getBoundingClientRect().top,
        }));
        await capture(`${view}-${width}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await navigate("tasks");
    await page.locator("#globalSearchButton").click();
    await page.locator("#globalSearchInput").fill("Собрать данные");
    measurements.checklistSearch = await page.locator("#globalSearchResults").innerText();
    await capture("search-checklist-390");
    await page.locator("#globalSearchInput").fill("Продукт без калорий");
    measurements.unknownFoodSearch = await page.locator("#globalSearchResults").innerText();
    await capture("search-unknown-food-390");
    await page.locator("#globalSearchClose").click();
    await navigate("study");
    await page.locator('[data-study-tab="schedule"]').click();
    measurements.studySubject = await page.locator("#studySubjectForm").evaluate((node) => ({ top: node.getBoundingClientRect().top + scrollY }));
    await capture("study-schedule-390");
    await page.locator("#studySubjectForm").scrollIntoViewIfNeeded();
    await capture("study-subject-390");
    await navigate("tasks");
    await page.locator("#openTaskForm").click();
    measurements.taskForm = await page.locator("#taskForm").evaluate((node) => ({ fields: [...node.querySelectorAll("input,select,textarea")].filter((field) => field.type !== "hidden" && field.getBoundingClientRect().width > 0).length, height: node.scrollHeight }));
    await capture("task-form-390");
    await page.locator("#closeTaskForm").click();
    await navigate("nutrition");
    measurements.nutritionBefore = await page.locator("#nutritionCaloriesMetric").innerText();
    await page.locator("#nutritionAddMeal").click();
    await page.locator("#nutritionMealTitle").fill("Обычный ввод ингредиента");
    await page.locator("#nutritionMealIngredients").fill("Рис 100 г");
    await capture("meal-form-390");
    await page.locator("#nutritionMealForm button[type=submit]").click();
    measurements.naturalIngredient = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).nutritionMeals.find((meal) => meal.title === "Обычный ввод ингредиента").ingredients);
    await navigate("settings");
    await page.locator("#themePreference").evaluate((field) => { field.closest("details").open = true; });
    await page.locator("#themePreference").selectOption("light");
    for (const view of ["tasks", "habits", "nutrition"]) { await navigate(view); await capture(`${view}-light-390`); }
    measurements.errors = errors;
    fs.writeFileSync(path.join(__dirname, "measurements.json"), JSON.stringify(measurements, null, 2));
    console.log(JSON.stringify(measurements, null, 2));
  } finally {
    await page.evaluate(() => document.querySelectorAll(".form-panel").forEach((panel) => panel.classList.add("is-collapsed"))).catch(() => {});
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
