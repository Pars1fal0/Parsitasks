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
      if (!confirmed) return;
      const undo = ctx.createUndoSnapshot();
      state.nutritionFoods = state.nutritionFoods.filter((item) => item.id !== foodId);
      state.tombstones.nutritionFoods[foodId] = ctx.now();
      persist("Продукт удалён", { undo });
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
      if (!confirmed) return;
      const undo = ctx.createUndoSnapshot();
      state.nutritionMeals = state.nutritionMeals.filter((item) => item.id !== mealId);
      state.tombstones.nutritionMeals[mealId] = ctx.now();
      persist("Блюдо удалено", { undo });
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
        createdAt: now,
        updatedAt: now,
      }, modelOptions(state, now));
      state.nutritionMeals.push(copy);
      persist("Блюдо продублировано");
    }

    function moveMeal(mealId, date) {
      const state = ctx.getState();
      const meal = state.nutritionMeals.find((item) => item.id === mealId);
      if (!meal || meal.date === date) return;
      meal.date = date;
      meal.updatedAt = ctx.now();
      persist();
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
        id: existing?.id || input.id || ctx.createId(),
        createdAt: existing?.createdAt,
        updatedAt: now,
      }, { createId: ctx.createId, now });
      if (!food) {
        ctx.showToast("Укажи название продукта");
        return false;
      }
      if (existing) Object.assign(existing, food);
      else state.nutritionFoods.push(food);
      delete state.tombstones.nutritionFoods[food.id];
      persist("Продукт сохранён");
      return true;
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
      if (existing) Object.assign(existing, meal);
      else state.nutritionMeals.push(meal);
      delete state.tombstones.nutritionMeals[meal.id];
      persist("Блюдо сохранено");
      return true;
    }

    function saveSettings(input) {
      const state = ctx.getState();
      state.nutritionSettings = ctx.model.normalizeSettings({
        ...input,
        updatedAt: ctx.now(),
      });
      persist(input.paused ? "План питания приостановлен" : "Цели питания сохранены");
    }

    function setMealStatus(mealId, status) {
      const state = ctx.getState();
      const meal = state.nutritionMeals.find((item) => item.id === mealId);
      if (!meal) return;
      meal.status = status;
      meal.updatedAt = ctx.now();
      persist();
    }

    function persist(message = "", toastOptions) {
      ctx.saveState();
      ctx.render();
      if (message) ctx.showToast(message, toastOptions);
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
      saveSettings,
      setMealStatus,
    };
  }

  const api = { createNutritionController };
  global.RhythmNutritionController = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
