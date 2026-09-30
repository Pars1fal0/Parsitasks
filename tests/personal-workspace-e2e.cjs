const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({ args: [path.resolve(__dirname, ".."), "--e2e-test"], executablePath: require("electron") });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  async function navigate(view) {
    const direct = page.locator(`.nav-tabs > button[data-view="${view}"]:visible`);
    if (await direct.count()) await direct.click();
    else { await page.locator(".nav-more-summary:visible").click(); await page.locator(`.nav-more-menu [data-view="${view}"]`).click(); }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  async function state() { return page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1"))); }
  async function capture(name) {
    if (process.env.CAPTURE_PERSONAL_WORKSPACE) await page.screenshot({ path: path.join(os.tmpdir(), `parsitasks-personal-${name}.png`), animations: "disabled" });
  }
  try {
    await page.waitForSelector("#pageTitle");
    const dates = await page.evaluate(() => {
      const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const today = key(new Date());
      const future = new Date(); future.setDate(future.getDate() + 1);
      const tomorrow = key(future);
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify({ schemaVersion: 23, defaultsSeeded: true,
        tasks: [{ id: "reminder-task", title: "Проверить отчёт", date: tomorrow, time: "11:10", reminderOffset: "10", repeat: "none", completed: {} }],
        habits: [{ id: "reminder-habit", title: "Прогулка", startDate: today, repeat: "daily", reminderTime: "12:00", type: "check", logs: {} }],
        nutritionFoods: [{ id: "rice", name: "Рис", unit: "г", calories: 350, nutritionKnown: true }],
      }));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: today, activeView: "tasks" }));
      return { today, tomorrow };
    });
    await page.reload(); await page.waitForSelector("#pageTitle");
    await page.setViewportSize({ width: 390, height: 844 });
    await navigate("settings");
    await page.locator('[aria-labelledby="navigationSettingsHeading"] > summary').click();
    await page.locator('[data-navigation-key="pin-1"]').selectOption("study");
    await page.locator('[data-navigation-key="pin-2"]').selectOption("journal");
    await page.locator('[data-navigation-key="visible-board"]').uncheck();
    assert.ok(await page.locator('.nav-tabs > [data-view="study"]').isVisible());
    assert.ok(await page.locator('.nav-tabs > [data-view="journal"]').isVisible());
    assert.equal(await page.locator('.nav-more-menu [data-view="board"]').isVisible(), false);
    await capture("navigation-dark-390");
    await navigate("study");
    assert.equal(await page.locator("#pageTitle").innerText(), "Учёба");
    assert.equal(await page.locator(".nav-more-summary").getAttribute("aria-current"), null);
    await navigate("journal");
    assert.equal(await page.locator("#pageTitle").innerText(), "Заметки");
    await page.reload(); await page.waitForSelector("#pageTitle");
    assert.ok(await page.locator('.nav-tabs > [data-view="journal"]').isVisible());
    await navigate("settings");
    await page.locator('[aria-labelledby="notificationsSettingsHeading"] > summary').click();
    await page.locator("#quietHoursEnabled").check();
    await page.locator("#quietHoursStart").fill("23:00"); await page.locator("#quietHoursStart").dispatchEvent("change");
    await page.locator("#quietHoursEnd").fill("07:00"); await page.locator("#quietHoursEnd").dispatchEvent("change");
    await page.locator("#settingsReminderCenter").click();
    const reminderRow = page.locator('.reminder-row[data-reminder-id="reminder-task"]');
    await reminderRow.locator("select").selectOption("30");
    await reminderRow.getByRole("button", { name: "Отложить", exact: true }).click();
    assert.match(await reminderRow.innerText(), /Отложено/);
    assert.equal((await state()).tasks[0].date, dates.tomorrow);
    const habitRow = page.locator('.reminder-row[data-reminder-id="reminder-habit"]').first();
    await habitRow.locator("select").selectOption("tomorrow");
    await habitRow.getByRole("button", { name: "Отложить", exact: true }).click();
    assert.match(await page.locator('.reminder-row[data-reminder-id="reminder-habit"]').first().innerText(), /Отложено/);
    await capture("reminders-dark-390");
    await page.locator("#reminderClose").click();
    await page.reload(); await page.waitForSelector("#pageTitle");
    await page.locator('[aria-labelledby="notificationsSettingsHeading"] > summary').click();
    assert.ok(await page.locator("#quietHoursEnabled").isChecked());
    assert.equal(await page.locator("#quietHoursStart").inputValue(), "23:00");
    await page.locator("#settingsReminderCenter").click();
    assert.match(await reminderRow.innerText(), /Отложено/);
    await page.locator("#reminderClose").click();
    await navigate("nutrition");
    await page.locator("#nutritionAddMeal").click();
    await page.locator("#nutritionMealTitle").fill("Рисовый обед");
    await page.locator("#nutritionMealIngredients").fill("Рис 100 г");
    await page.locator("#nutritionMealSaveToLibrary").check();
    await page.locator("#nutritionMealForm button[type=submit]").click();
    assert.equal((await state()).nutritionTemplates.length, 1);
    assert.equal((await state()).nutritionTemplates[0].ingredients[0].quantity, 100);
    await page.locator("#nutritionOpenLibrary").click();
    await page.locator("#nutritionLibrarySearch").fill("Рис");
    assert.equal(await page.locator(".meal-library-row").count(), 1);
    await capture("library-dark-390");
    await page.locator(".meal-library-row").getByRole("button", { name: "Добавить на день" }).click();
    assert.equal(await page.locator("#nutritionMealTitle").inputValue(), "Рисовый обед");
    assert.match(await page.locator("#nutritionMealIngredients").inputValue(), /100/);
    await page.locator("#nutritionMealDate").fill(dates.tomorrow);
    await page.locator("#nutritionMealForm button[type=submit]").click();
    assert.equal((await state()).nutritionMeals.length, 2);
    assert.equal((await state()).nutritionTemplates.length, 1);
    await page.locator("#nutritionOpenLibrary").click();
    await page.locator(".meal-library-row").getByRole("button", { name: /Изменить рецепт/ }).click();
    assert.equal(await page.locator("#nutritionMealDate").isVisible(), false);
    assert.equal(await page.locator("#nutritionMealSaveToLibrary").isVisible(), false);
    await page.locator("#nutritionMealTitle").fill("Рис с зеленью");
    await page.locator("#nutritionMealIngredients").fill("Рис 150 г");
    await page.locator("#nutritionMealForm button[type=submit]").click();
    assert.equal((await state()).nutritionTemplates[0].title, "Рис с зеленью");
    assert.equal((await state()).nutritionMeals[0].ingredients[0].quantity, 100);
    await page.locator("#nutritionAddMeal").click();
    const templateId = (await state()).nutritionTemplates[0].id;
    await page.locator("#nutritionTemplatePicker").selectOption(templateId);
    assert.equal(await page.locator("#nutritionMealTitle").inputValue(), "Рис с зеленью");
    await page.locator("#nutritionMealCancel").click();
    await page.reload(); await page.waitForSelector("#pageTitle");
    await page.locator("#nutritionAddMeal").click();
    assert.equal(await page.locator("#nutritionMealTitle").inputValue(), "Рис с зеленью");
    await page.locator("#nutritionMealCancel").click();
    await page.locator("#nutritionOpenLibrary").click();
    await page.locator(".meal-library-row").getByRole("button", { name: /Удалить рецепт/ }).click();
    await page.locator("#confirmAccept").click();
    await page.waitForFunction(() => document.querySelector("#nutritionLibraryDialog").open);
    assert.equal((await state()).nutritionTemplates.length, 0);
    assert.equal((await state()).nutritionMeals.length, 2);
    await page.locator("#nutritionLibraryClose").click();
    await page.locator("#nutritionFoodName").evaluate((field) => { field.closest("details").open = true; });
    await page.locator("#nutritionFoodName").fill("Не потерять продукт");
    await page.locator("#nutritionFoodCalories").fill("150");
    const beforeFailedWrite = await state();
    await page.evaluate(() => {
      window.originalStorageSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "rhythm-day-state-v1") throw new DOMException("Storage full", "QuotaExceededError");
        return window.originalStorageSetItem.call(this, key, value);
      };
    });
    try {
      await page.locator("#nutritionFoodForm button[type=submit]").click();
      assert.equal(await page.locator("#nutritionFoodName").inputValue(), "Не потерять продукт");
      assert.equal(await page.locator("#nutritionFoodCalories").inputValue(), "150");
      assert.deepEqual(await state(), beforeFailedWrite);
      assert.equal(await page.locator("#nutritionFoodList").getByText("Не потерять продукт", { exact: true }).count(), 0);
    } finally {
      await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSetItem; delete window.originalStorageSetItem; });
    }
    await page.locator("#nutritionFoodForm button[type=submit]").click();
    assert.equal((await state()).nutritionFoods.filter((food) => food.name === "Не потерять продукт").length, 1);
    assert.equal(await page.locator("#nutritionFoodName").inputValue(), "");
    for (const theme of ["light", "dark"]) {
      await navigate("settings");
      await page.locator("#themePreference").evaluate((field) => { field.closest("details").open = true; });
      await page.locator("#themePreference").selectOption(theme);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await navigate("tasks");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const navButtons = page.locator('.nav-tabs > button[data-view]:visible');
        if (width < 680) assert.equal(await navButtons.count(), 4);
        await page.locator("#openReminderCenter").click();
        assert.ok(await page.locator("#reminderDialog").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1));
        await capture(`reminders-${theme}-${width}`);
        await page.locator("#reminderClose").click();
        await navigate("nutrition");
        await page.locator("#nutritionOpenLibrary").click();
        assert.ok(await page.locator("#nutritionLibraryDialog").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1));
        await page.locator("#nutritionLibraryClose").click();
      }
    }
    assert.deepEqual(errors, []);
    console.log("e2e ok - custom mobile navigation, quiet hours, task/habit snoozes, meal library and recoverable storage failure");
  } finally { await app.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
