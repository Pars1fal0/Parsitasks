const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({ args: [path.resolve(__dirname, ".."), "--e2e-test"], executablePath: require("electron") });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function navigate(view) {
    const direct = page.locator(`.nav-tabs > [data-view="${view}"]:visible`);
    if (await direct.count()) await direct.click();
    else {
      await page.locator(".nav-more-summary:visible").click();
      await page.locator(`.nav-more-menu [data-view="${view}"]`).click();
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  try {
    await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const key = "rhythm-day-state-v1";
      const data = JSON.parse(localStorage.getItem(key));
      const date = "2026-09-30", stamp = "2026-09-01T08:00:00.000Z";
      data.tasks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Задача ${i}`, date, repeat: "none", completed: i < 4 ? { [date]: true } : {} }));
      data.habits = [
        { id: "done", title: "Прогулка", startDate: "2026-09-01", type: "check", repeat: "daily", logs: { [date]: true }, createdAt: stamp },
        { id: "frozen", title: "Тренировка", startDate: "2026-09-01", type: "check", repeat: "daily", logs: {}, createdAt: stamp, freezeDays: { [date]: { active: true, reason: "Поездка", updatedAt: stamp } } },
      ];
      data.nutritionFoods = [{ id: "rice", name: "Рис", unit: "г", calories: 350, nutritionKnown: true }];
      localStorage.setItem(key, JSON.stringify(data));
      const now = new Date();
      const currentToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: date, currentToday, activeView: "tasks" }));
    });
    await page.reload(); await page.waitForSelector("#pageTitle");
    await page.setViewportSize({ width: 390, height: 900 });
    assert.equal(await page.locator("#dayProgressValue").innerText(), "75%");
    assert.equal(await page.locator("#dayProgressBar").evaluate((node) => node.style.width), "75%");
    assert.equal(await page.locator("#dayProgressSummary").innerText(), "Задачи: 4 из 8 · Привычки: 1 из 1 · Заморожено 1");
    for (const selector of [".sidebar-pulse", ".focus-board", "#taskCounter", "#taskProgressRing"]) assert.equal(await page.locator(selector).isVisible(), false);
    await navigate("habits");
    const habit = page.locator(".habit-item").filter({ hasText: "Прогулка" });
    await habit.locator(".habit-more summary").click();
    assert.match(await habit.locator(".freeze-habit").innerText(), /Заморозить/);
    assert.equal(await habit.locator(".archive-habit").innerText(), "Убрать из активных");
    await habit.locator(".archive-habit").click();
    await page.locator("#habitArchivePanel > summary").click();
    await page.getByRole("button", { name: "Вернуть в активные", exact: true }).click();
    assert.equal(await habit.locator(".check-button").getAttribute("aria-pressed"), "true", "restoring a habit preserves its completion");
    assert.ok(await page.locator("#appToast.is-visible.has-action").isVisible());
    await navigate("settings");
    const groups = page.locator("#settingsView .settings-grid > details");
    assert.equal(await groups.count(), 4);
    assert.equal(await page.locator("#settingsView .settings-grid > details[open]").count(), 0);
    assert.deepEqual(await groups.locator(":scope > summary h2").allTextContents(), ["Внешний вид", "Напоминания", "Аккаунт и данные", "Помощь"]);
    assert.equal(await page.locator("#remoteSyncUrl").isVisible(), false);
    await page.locator('[aria-labelledby="appearanceHeading"] > summary').click();
    await page.locator('[aria-labelledby="navigationSettingsHeading"] > summary').click();
    await page.locator('[data-navigation-key="visible-nutrition"]').check();
    await page.locator('[aria-labelledby="navigationSettingsHeading"] > summary').click();
    await navigate("nutrition");
    assert.equal(await page.locator(".nutrition-day-column").count(), 1);
    assert.equal(await page.locator("#dayProgressValue").isVisible(), false);
    assert.equal(await page.locator(".nutrition-side details[open]").count(), 0);
    for (const meal of [{ title: "Рис с курицей", ingredients: "Рис 100 г\nКурица 150 г" }, { title: "Без базы", ingredients: "Омлет 100 г" }]) {
      await page.locator("#nutritionAddMeal").click();
      await page.locator("#nutritionMealTitle").fill(meal.title);
      await page.locator("#nutritionMealIngredients").fill(meal.ingredients);
      await page.locator("#nutritionMealForm button[type=submit]").click();
    }
    assert.match(await page.locator(".nutrition-meal-card").filter({ hasText: "Рис с курицей" }).innerText(), /≈ 350 ккал/);
    assert.match(await page.locator(".nutrition-meal-card").filter({ hasText: "Без базы" }).innerText(), /— ккал/);
    assert.equal(await page.locator("#nutritionCalculationNote:visible").count(), 1);
    assert.doesNotMatch(await page.locator("#nutritionWeekBoard").innerText(), /Неполный расчёт/);
    const order = await page.evaluate(() => [".nutrition-week-panel", ".nutrition-day-summary", ".nutrition-side"].map((selector) => document.querySelector(selector).getBoundingClientRect().top));
    assert.ok(order[0] < order[1] && order[1] < order[2]);
    await page.locator("#nutritionOpenLibrary").click();
    assert.ok(await page.locator("#nutritionLibraryDialog").isVisible());
    await page.locator("#nutritionLibraryClose").click();
    for (const theme of ["light", "dark"]) {
      await navigate("settings");
      await page.locator("#themePreference").selectOption(theme);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const view of ["nutrition", "settings", "tasks"]) {
          await navigate(view);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} fits ${width}`);
          if (view === "tasks") {
            assert.equal(await page.locator(".sidebar-pulse").isVisible(), false);
            assert.equal(await page.locator(".day-progress").isVisible(), false);
            assert.equal(await page.locator("#sideProgressBar").evaluate((node) => node.style.width), "75%");
          }
          if (view === "settings") {
            assert.ok(await page.locator('[aria-labelledby="appearanceHeading"] .settings-row').evaluateAll((rows) => rows.every((row) => {
              const text = row.querySelector(":scope > span"), field = row.querySelector(":scope > select, :scope > input");
              if (!text || !field) return true;
              const a = text.getBoundingClientRect(), b = field.getBoundingClientRect();
              return a.right <= b.left + 1 && b.right <= row.getBoundingClientRect().right + 1;
            })), "settings labels and controls have separate aligned columns");
          }
          if (view === "nutrition" && width <= 390) {
            const meal = await page.locator(".nutrition-meal-card").first().boundingBox();
            assert.ok(meal.width > width - 70, "day meals use the available mobile width");
          }
          await page.screenshot({ path: path.join(os.tmpdir(), `parsitasks-clear-${view}-${theme}-${width}.png`), animations: "disabled" });
          if (view === "settings") {
            await page.locator('[aria-labelledby="appearanceHeading"] > summary').click();
            for (const heading of ["notificationsSettingsHeading", "dataSettingsHeading"]) {
              const group = page.locator(`[aria-labelledby="${heading}"]`);
              await group.locator(":scope > summary").click();
              await page.evaluate(() => window.scrollTo(0, 0));
              assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
              await page.screenshot({ path: path.join(os.tmpdir(), `parsitasks-clear-${heading}-${theme}-${width}.png`), animations: "disabled" });
              await group.locator(":scope > summary").click();
            }
            await page.locator('[aria-labelledby="appearanceHeading"] > summary').click();
          }
        }
      }
    }
    await navigate("settings");
    await page.locator('[aria-labelledby="dataSettingsHeading"] > summary').click();
    assert.equal(await page.locator("#remoteSyncUrl").isVisible(), false);
    await page.locator('[aria-labelledby="syncSettingsHeading"] > summary').click();
    assert.equal(await page.locator("#remoteSyncUrl").isVisible(), false);
    assert.ok(await page.locator('#syncTechnicalSettings').evaluate((node) => !!node.closest('[aria-labelledby="syncSettingsHeading"]')));
    if (await page.locator("#syncTechnicalSettings").isVisible()) {
      await page.locator("#syncTechnicalSettings > summary").click();
      assert.ok(await page.locator("#remoteSyncUrl").isVisible());
    }
    assert.deepEqual(errors, []);
    console.log("e2e ok - clear habit actions, one daily percentage, meals before summary, four settings groups and responsive themes");
  } finally { await app.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
