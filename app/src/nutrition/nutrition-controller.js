(function (global) {
  function createNutritionController(ctx) {
    async function deleteFood(foodId) {
      const state = ctx.getState();
      const food = state.nutritionFoods.find((item) => item.id === foodId);
      if (!food) return;
      const confirmed = await ctx.confirmAction({
        title: "Удалить продукт?",
        message: `«${food.name}» останется текстом в уже созданных блюдах, но автоматический расчёт для него прекратится.`,
        confirmLabel: "Удалить",
      });
      if (!confirmed || !isCurrentState(state)) return false;
      const undo = ctx.createUndoSnapshot();
      return persist(() => {
        state.nutritionFoods = state.nutritionFoods.filter((item) => item.id !== foodId);
        state.tombstones.nutritionFoods[foodId] = ctx.now();
      }, "Продукт удалён", { undo });
    }

    async function deleteMeal(mealId) {
      const state = ctx.getState();
      const meal = state.nutritionMeals.find((item) => item.id === mealId);
      if (!meal) return;
      const confirmed = await ctx.confirmAction({
        title: "Удалить блюдо?",
        message: `«${meal.title}» будет удалено из плана.`,
        confirmLabel: "Удалить",
      });
      if (!confirmed || !isCurrentState(state)) return false;
      const undo = ctx.createUndoSnapshot();
      return persist(() => {
        state.nutritionMeals = state.nutritionMeals.filter((item) => item.id !== mealId);
        state.tombstones.nutritionMeals[mealId] = ctx.now();
      }, "Блюдо удалено", { undo });
    }

    function duplicateMeal(mealId) {
      const state = ctx.getState();
      const meal = state.nutritionMeals.find((item) => item.id === mealId);
      if (!meal) return;
      const now = ctx.now();
      const copy = ctx.model.normalizeMeal({
        ...meal,
        id: ctx.createId(),
        title: `${meal.title} — копия`,
        status: "planned",
        createdAt: now,
        updatedAt: now,
      }, modelOptions(state, now));
      return persist(() => state.nutritionMeals.push(copy), "Блюдо продублировано");
    }

    function moveMeal(mealId, date) {
      const state = ctx.getState();
      const meal = state.nutritionMeals.find((item) => item.id === mealId);
      if (!meal || meal.date === date) return;
      if (!ctx.model.normalizeMeal({ ...meal, date }, modelOptions(state, ctx.now()))) return false;
      return persist(() => { meal.date = date; meal.updatedAt = ctx.now(); });
    }

    function saveFood(input) {
      const state = ctx.getState();
      const now = ctx.now();
      const inputName = String(input.name || "").trim().toLocaleLowerCase("ru-RU");
      const existing = state.nutritionFoods.find((item) => item.id === input.id)
        || state.nutritionFoods.find((item) => item.name.toLocaleLowerCase("ru-RU") === inputName);
      const food = ctx.model.normalizeFood({
        ...existing,
        ...input,
        nutritionKnown: input.calories !== undefined && input.calories !== null && input.calories !== "" && Number.isFinite(Number(input.calories)),
        id: existing?.id || input.id || ctx.createId(),
        createdAt: existing?.createdAt,
        updatedAt: now,
      }, { createId: ctx.createId, now });
      if (!food) {
        ctx.showToast("Укажи название продукта");
        return false;
      }
      return persist(() => {
        if (existing) Object.assign(existing, food);
        else state.nutritionFoods.push(food);
        delete state.tombstones.nutritionFoods[food.id];
      }, "Продукт сохранён");
    }

    function saveMeal(input) {
      const state = ctx.getState();
      const now = ctx.now();
      const existing = state.nutritionMeals.find((item) => item.id === input.id);
      const meal = ctx.model.normalizeMeal({
        ...existing,
        ...input,
        id: existing?.id || input.id || ctx.createId(),
        createdAt: existing?.createdAt,
        updatedAt: now,
      }, modelOptions(state, now));
      if (!meal) {
        ctx.showToast("Укажи название и дату блюда");
        return false;
      }
      return persist(() => {
        if (existing) Object.assign(existing, meal);
        else state.nutritionMeals.push(meal);
        if (input.saveToLibrary) state.nutritionTemplates.push(ctx.model.normalizeTemplate({ ...meal, id: ctx.createId() }, modelOptions(state, now)));
        delete state.tombstones.nutritionMeals[meal.id];
      }, "Блюдо сохранено");
    }

    function saveTemplate(input) {
      const state = ctx.getState();
      const existing = state.nutritionTemplates.find((item) => item.id === input.id);
      const now = ctx.now();
      const template = ctx.model.normalizeTemplate({ ...input, id: existing?.id || ctx.createId(), createdAt: existing?.createdAt, updatedAt: now }, modelOptions(state, now));
      if (!template) return false;
      return persist(() => {
        state.nutritionTemplates = existing ? state.nutritionTemplates.map((item) => item.id === existing.id ? template : item) : [...state.nutritionTemplates, template];
      }, existing ? "Рецепт обновлён" : "Блюдо сохранено в библиотеку");
    }

    async function deleteTemplate(id) {
      const state = ctx.getState();
      const template = state.nutritionTemplates.find((item) => item.id === id);
      if (!template || !await ctx.confirmAction({ title: "Удалить рецепт?", message: `«${template.title}» останется в уже созданных блюдах.`, confirmLabel: "Удалить" })) return;
      if (!isCurrentState(state)) return false;
      const undo = ctx.createUndoSnapshot();
      return persist(() => {
        state.nutritionTemplates = state.nutritionTemplates.filter((item) => item.id !== id);
        state.tombstones.nutritionTemplates[id] = ctx.now();
      }, "Рецепт удалён", { undo });
    }

    function saveSettings(input) {
      const state = ctx.getState();
      return persist(() => {
        state.nutritionSettings = ctx.model.normalizeSettings({ ...input, updatedAt: ctx.now() });
      }, input.paused ? "План питания приостановлен" : "Цели питания сохранены");
    }

    function setMealStatus(mealId, status) {
      const state = ctx.getState();
      const meal = state.nutritionMeals.find((item) => item.id === mealId);
      if (!meal || !ctx.model.MEAL_STATUSES.includes(status)) return false;
      return persist(() => { meal.status = status; meal.updatedAt = ctx.now(); });
    }

    function isCurrentState(state) {
      if (ctx.getState() === state) return true;
      ctx.showToast("Данные изменились. Повтори действие");
      return false;
    }

    function persist(change, message = "", toastOptions) {
      const state = ctx.getState();
      const previous = structuredClone(state);
      let saved = false;
      try {
        change();
        saved = ctx.saveState() !== false;
      } catch {
        ctx.showToast("Не удалось сохранить изменения питания");
      }
      if (!saved) {
        // Restore sync metadata and deletion markers together with user data.
        Object.keys(state).forEach((key) => { if (!Object.hasOwn(previous, key)) delete state[key]; });
        Object.assign(state, previous);
        ctx.onRollback?.();
      }
      ctx.render();
      if (message && saved) ctx.showToast(message, toastOptions);
      return saved;
    }

    function modelOptions(state, now) {
      return {
        createId: ctx.createId,
        foodById: new Map(state.nutritionFoods.map((food) => [food.id, food])),
        now,
      };
    }

    return {
      deleteFood,
      deleteMeal,
      duplicateMeal,
      moveMeal,
      saveFood,
      saveMeal,
      saveTemplate,
      deleteTemplate,
      saveSettings,
      setMealStatus,
    };
  }

  const api = { createNutritionController };
  global.RhythmNutritionController = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
