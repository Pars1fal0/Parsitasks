const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({ args: [path.resolve(__dirname, ".."), "--e2e-test"], executablePath: require("electron") });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function navigate(view) {
    const direct = page.locator(`.nav-tab[data-view="${view}"]:visible`).first();
    if (await direct.count()) await direct.click();
    else {
      await page.locator(".nav-more-summary").click();
      await page.locator(`.nav-more-menu [data-view="${view}"]`).click();
    }
  }
  async function reload() { await page.reload(); await page.waitForSelector("#pageTitle"); }
  async function state() { return page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1"))); }

  try {
    await page.waitForSelector("#pageTitle");
    await page.setViewportSize({ width: 1366, height: 900 });
    const today = await page.locator("#activeDate").inputValue();
    await page.locator("#quickTaskInput").fill("Созвон завтра 14:00");
    await page.locator("#quickTaskForm button[type=submit]").click();
    assert.equal(await page.locator("#activeDate").inputValue(), today);
    const tomorrow = (await state()).tasks.find((task) => task.title === "Созвон").date;
    await page.getByRole("button", { name: "Открыть день", exact: true }).click();
    assert.equal(await page.locator("#activeDate").inputValue(), tomorrow);
    await page.locator("#activeDate").fill(today);
    await page.locator("#activeDate").dispatchEvent("change");
    await page.locator("#quickTaskInput").fill("Купить хлеб");
    await page.locator("#quickTaskForm button[type=submit]").click();
    const tasks = (await state()).tasks;
    assert.equal(tasks.find((task) => task.title === "Купить хлеб").date, today);
    assert.notEqual(tasks.find((task) => task.title === "Созвон").date, today);

    await navigate("timeline");
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.locator("#activeDate").fill("2027-01-15");
    await page.locator("#activeDate").dispatchEvent("change");
    await navigate("tasks");
    await navigate("timeline");
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => scrollY), 0);

    await navigate("study");
    assert.equal(await page.locator("#activeDate").isVisible(), false);
    await page.locator('[data-study-tab="schedule"]').click();
    await page.locator("#activeDate").fill("2026-12-14");
    await page.locator("#activeDate").dispatchEvent("change");
    assert.match(await page.locator("#studyWeekLabel").innerText(), /14 декабря.*20 декабря/);
    await page.locator("#studyNextWeek").click();
    assert.equal(await page.locator("#activeDate").inputValue(), "2026-12-21");
    await page.locator('[data-study-schedule-mode="day"]').click();
    await page.locator("#studyNextWeek").click();
    assert.equal(await page.locator("#activeDate").inputValue(), "2026-12-22");
    assert.match(await page.locator("#studyWeekLabel").innerText(), /22 декабря/);

    await page.locator('#studySubjectForm [name="name"]').fill("Математика");
    await page.locator('#studySubjectForm button[type="submit"]').click();
    const subjectId = await page.locator("[data-study-subject-edit]").getAttribute("data-study-subject-edit");
    await page.locator('[data-study-tab="homework"]').click();
    assert.equal(await page.locator('#studyHomeworkForm [name="date"]').inputValue(), "2026-12-22");
    await page.locator('#studyHomeworkForm [name="subjectId"]').selectOption(subjectId);
    await page.locator('#studyHomeworkForm [name="title"]').fill("Доказать теорему");
    await page.locator('#studyHomeworkForm [name="details"]').fill("Страницы 45-48\nЗадачи 1-3");
    await navigate("tasks");
    await reload();
    await navigate("study");
    assert.equal(await page.locator('#studyHomeworkForm [name="title"]').inputValue(), "Доказать теорему");
    assert.equal(await page.locator('#studyHomeworkForm [name="details"]').inputValue(), "Страницы 45-48\nЗадачи 1-3");
    assert.match(await page.locator("#studyHomeworkDraftStatus").innerText(), /Восстановлен/);
    assert.equal((await state()).tasks.filter((task) => task.studySubjectId).length, 0);
    await page.locator('#studyHomeworkForm button[type="submit"]').click();
    await reload();
    assert.equal(await page.locator('#studyHomeworkForm [name="title"]').inputValue(), "");
    assert.equal((await state()).tasks.filter((task) => task.studySubjectId).length, 1);

    await navigate("tasks");
    await page.locator("#activeDate").fill(today);
    await page.locator("#activeDate").dispatchEvent("change");
    await navigate("nutrition");
    await page.locator("#nutritionAddMeal").click();
    await page.locator("#nutritionMealTitle").fill("Черновик рецепта");
    await page.locator("#nutritionMealNotes").fill("Важные детали\nНе потерять");
    await page.keyboard.press("Escape");
    await page.locator("#nutritionAddMeal").click();
    assert.equal(await page.locator("#nutritionMealTitle").inputValue(), "Черновик рецепта");
    await page.locator("#nutritionMealClose").click();
    await reload();
    await page.locator("#nutritionAddMeal").click();
    assert.equal(await page.locator("#nutritionMealNotes").inputValue(), "Важные детали\nНе потерять");
    assert.match(await page.locator("#nutritionMealDraftStatus").innerText(), /Восстановлен/);
    await page.locator("#nutritionMealDiscardDraft").click();
    await page.locator("#confirmCancel").click();
    assert.equal(await page.locator("#nutritionMealTitle").inputValue(), "Черновик рецепта");
    await page.locator("#nutritionMealDiscardDraft").click();
    await page.locator("#confirmAccept").click();
    await page.locator("#nutritionAddMeal").click();
    assert.equal(await page.locator("#nutritionMealTitle").inputValue(), "");
    await page.locator("#nutritionMealClose").click();

    await page.locator(".nutrition-details").filter({ has: page.locator("#nutritionFoodForm") }).locator("summary").click();
    await page.locator("#nutritionFoodName").fill("Рис");
    await page.locator("#nutritionFoodCalories").fill("350");
    await page.locator("#nutritionFoodForm button[type=submit]").click();
    for (const meal of [{ title: "Без базы", ingredients: "Омлет | 100 | г" }, { title: "Рис с курицей", ingredients: "Рис | 100 | г\nКурица | 150 | г" }]) {
      await page.locator("#nutritionAddMeal").click();
      await page.locator("#nutritionMealTitle").fill(meal.title);
      await page.locator("#nutritionMealIngredients").fill(meal.ingredients);
      await page.locator("#nutritionMealForm button[type=submit]").click();
    }
    const unknown = page.locator(".nutrition-meal-card").filter({ hasText: "Без базы" });
    assert.match(await unknown.innerText(), /не рассчитаны/);
    assert.doesNotMatch(await unknown.innerText(), /0 ккал/);
    assert.match(await page.locator(".nutrition-meal-card").filter({ hasText: "Рис с курицей" }).innerText(), /350 ккал.*Неполный расчёт/);
    assert.equal(await page.locator("#nutritionCaloriesMetric").innerText(), "350+");
    await page.locator("#nutritionFoodName").fill("Без калорий в базе");
    await page.locator("#nutritionFoodForm button[type=submit]").click();
    assert.equal((await state()).nutritionFoods.find((food) => food.name === "Без калорий в базе").nutritionKnown, false);
    await page.locator("#nutritionAddMeal").click();
    await page.locator("#nutritionMealTitle").fill("Нулевое блюдо");
    await page.locator("#nutritionMealCalories").fill("0");
    await page.locator("#nutritionMealForm button[type=submit]").click();
    assert.match(await page.locator(".nutrition-meal-card").filter({ hasText: "Нулевое блюдо" }).innerText(), /0 ккал/);
    await page.locator("#nutritionAddMeal").click();
    await page.locator("#nutritionMealTitle").fill("Только белок");
    await page.locator("#nutritionMealProtein").fill("15");
    await page.locator("#nutritionMealForm button[type=submit]").click();
    assert.doesNotMatch(await page.locator(".nutrition-meal-card").filter({ hasText: "Только белок" }).innerText(), /0 ккал/);
    const rice = page.locator(".nutrition-shopping-item").filter({ hasText: "Рис" }).locator("input");
    await rice.check();
    await navigate("tasks");
    await navigate("nutrition");
    assert.equal(await rice.isChecked(), true);
    await reload();
    assert.equal(await rice.isChecked(), true);
    assert.match(await page.locator(".nutrition-meal-card").filter({ hasText: "Нулевое блюдо" }).innerText(), /0 ккал/);
    assert.doesNotMatch(await page.locator(".nutrition-meal-card").filter({ hasText: "Только белок" }).innerText(), /0 ккал/);
    await rice.uncheck();
    await reload();
    assert.equal(await rice.isChecked(), false);
    await page.locator("#nutritionAddMeal").click();
    assert.equal(await page.locator("#nutritionMealTitle").inputValue(), "");
    await page.locator("#nutritionMealClose").click();

    for (const theme of ["dark", "light"]) {
      await navigate("settings");
      await page.locator("#themePreference").evaluate((field) => { field.closest("details").open = true; });
      await page.locator("#themePreference").selectOption(theme);
      for (const width of [390, 1366]) {
        await page.setViewportSize({ width, height: 844 });
        for (const view of ["nutrition", "study", "timeline"]) {
          await navigate(view);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          if (view === "timeline") {
            await page.waitForTimeout(30);
            assert.equal(await page.evaluate(() => scrollY), 0);
            const date = await page.locator("#activeDate").boundingBox();
            assert.ok(date && date.y >= 0 && date.y + date.height < 844);
          }
          if (process.env.CAPTURE_UX_FIXES) await page.screenshot({ path: path.join(os.tmpdir(), `parsitasks-ux-fixes-${view}-${theme}-${width}.png`), animations: "disabled" });
        }
        if (width === 390) {
          await navigate("nutrition");
          await page.locator("#nutritionAddMeal").click();
          await page.locator("#nutritionMealTitle").fill("Мобильный черновик");
          if (process.env.CAPTURE_UX_FIXES) await page.screenshot({ path: path.join(os.tmpdir(), `parsitasks-ux-fixes-draft-${theme}.png`), animations: "disabled" });
          await page.locator("#nutritionMealDiscardDraft").click();
          await page.locator("#confirmAccept").click();
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log("e2e ok - persistent drafts and purchases, nutrition completeness, quick capture, study dates, and timeline context");
  } finally { await app.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
