(function (global) {
  const MEAL_TYPES = ["breakfast", "snack", "lunch", "dinner", "other"];
  const MEAL_STATUSES = ["planned", "eaten", "skipped"];
  const DEFAULT_TARGETS = { calories: 0, protein: 0, fat: 0, carbs: 0 };

  function normalizeFood(value, options = {}) {
    const now = options.now || new Date().toISOString();
    const name = cleanText(value?.name, 120);
    if (!name) return null;
    return {
      id: String(value?.id || options.createId?.() || `food-${Date.now().toString(36)}`),
      name,
      unit: cleanText(value?.unit || "г", 20) || "г",
      calories: number(value?.calories, 0, 5000),
      nutritionKnown: typeof value?.nutritionKnown === "boolean" ? value.nutritionKnown
        : value?.calories !== undefined && value.calories !== null && value.calories !== "" && Number.isFinite(Number(value.calories)),
      protein: number(value?.protein, 0, 1000),
      fat: number(value?.fat, 0, 1000),
      carbs: number(value?.carbs, 0, 1000),
      source: cleanText(value?.source, 120),
      approximate: value?.approximate === true,
      createdAt: validTimestamp(value?.createdAt) || now,
      updatedAt: validTimestamp(value?.updatedAt) || now,
    };
  }

  function normalizeIngredient(value, options = {}) {
    const name = cleanText(value?.name, 120);
    const foodId = cleanText(value?.foodId, 120);
    if (!name && !foodId) return null;
    return {
      id: String(value?.id || options.createId?.() || `ingredient-${Date.now().toString(36)}`),
      foodId,
      name: name || cleanText(options.foodById?.get(foodId)?.name, 120) || "Продукт",
      quantity: number(value?.quantity, 0, 100000),
      unit: cleanText(value?.unit || options.foodById?.get(foodId)?.unit || "г", 20) || "г",
    };
  }

  function normalizeMeal(value, options = {}) {
    const now = options.now || new Date().toISOString();
    const title = cleanText(value?.title, 160);
    const date = normalizeDateKey(value?.date);
    if (!title || !date) return null;
    const ingredients = (Array.isArray(value?.ingredients) ? value.ingredients : [])
      .map((item) => normalizeIngredient(item, options))
      .filter(Boolean)
      .slice(0, 80);
    const nutrition = normalizeNutrition(value?.nutrition);
    return {
      id: String(value?.id || options.createId?.() || `meal-${Date.now().toString(36)}`),
      date,
      type: MEAL_TYPES.includes(value?.type) ? value.type : "other",
      time: normalizeTime(value?.time),
      title,
      servings: number(value?.servings, 0.1, 100, 1),
      ingredients,
      nutrition,
      manualNutrition: value?.manualNutrition === true,
      manualCaloriesKnown: value?.manualCaloriesKnown !== false,
      status: MEAL_STATUSES.includes(value?.status) ? value.status : "planned",
      notes: cleanText(value?.notes, 1000),
      createdAt: validTimestamp(value?.createdAt) || now,
      updatedAt: validTimestamp(value?.updatedAt) || now,
    };
  }

  function normalizeTemplate(value, options = {}) {
    const now = options.now || new Date().toISOString();
    const title = cleanText(value?.title, 160);
    if (!title) return null;
    return {
      id: String(value?.id || options.createId?.() || `meal-template-${Date.now().toString(36)}`),
      title,
      type: MEAL_TYPES.includes(value?.type) ? value.type : "other",
      time: normalizeTime(value?.time),
      servings: number(value?.servings, 0.1, 100, 1),
      ingredients: (Array.isArray(value?.ingredients) ? value.ingredients : [])
        .map((item) => normalizeIngredient(item, options))
        .filter(Boolean)
        .slice(0, 80),
      nutrition: normalizeNutrition(value?.nutrition),
      manualNutrition: value?.manualNutrition === true,
      manualCaloriesKnown: value?.manualCaloriesKnown !== false,
      notes: cleanText(value?.notes, 1000),
      createdAt: validTimestamp(value?.createdAt) || now,
      updatedAt: validTimestamp(value?.updatedAt) || now,
    };
  }

  function normalizeSettings(value = {}) {
    return {
      targets: normalizeNutrition(value.targets || DEFAULT_TARGETS),
      paused: value.paused === true,
      updatedAt: validTimestamp(value.updatedAt) || "",
    };
  }

  function normalizeNutrition(value = {}) {
    return {
      calories: number(value?.calories, 0, 100000),
      protein: number(value?.protein, 0, 10000),
      fat: number(value?.fat, 0, 10000),
      carbs: number(value?.carbs, 0, 10000),
    };
  }

  function calculateMealNutrition(meal, foods = []) {
    return mealNutritionInfo(meal, foods).values;
  }

  function mealNutritionInfo(meal, foods = []) {
    const manual = normalizeNutrition(meal?.nutrition);
    if (meal?.manualNutrition === true || Object.values(manual).some((value) => value > 0)) return {
      values: manual, status: meal?.manualCaloriesKnown === false ? "unknown" : "complete",
      missing: meal?.manualCaloriesKnown === false ? 1 : 0,
    };
    const foodById = new Map(foods.map((food) => [food.id, food]));
    const calculated = { calories: 0, protein: 0, fat: 0, carbs: 0 };
    let known = 0;
    let missing = 0;
    (meal?.ingredients || []).forEach((ingredient) => {
      const food = foodById.get(ingredient.foodId);
      if (!food || food.nutritionKnown === false || ingredient.unit !== food.unit || !(ingredient.quantity > 0)) { missing += 1; return; }
      known += 1;
      const ratio = ingredient.quantity / 100;
      Object.keys(calculated).forEach((key) => {
        calculated[key] += food[key] * ratio;
      });
    });
    return {
      values: Object.fromEntries(Object.entries(calculated).map(([key, value]) => [key, round(value)])),
      status: !known ? "unknown" : missing ? "partial" : "complete",
      missing,
    };
  }

  function mealsNutritionInfo(meals, foods = [], status = "") {
    const included = (meals || []).filter((meal) => meal.status !== "skipped" && (!status || meal.status === status));
    const infos = included.map((meal) => mealNutritionInfo(meal, foods));
    const incomplete = infos.filter((info) => info.status !== "complete").length;
    return {
      values: summarizeMeals(included, foods),
      status: !included.length || infos.every((info) => info.status === "unknown") ? "unknown" : incomplete ? "partial" : "complete",
      incomplete,
    };
  }

  function nutritionWeek(meals, anchorDate, firstDay = "monday") {
    const start = startOfWeek(anchorDate, firstDay);
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    const byDate = Object.fromEntries(days.map((date) => [date, []]));
    (Array.isArray(meals) ? meals : []).forEach((meal) => {
      if (byDate[meal.date]) byDate[meal.date].push(meal);
    });
    Object.values(byDate).forEach((items) => items.sort(compareMeals));
    return { start, end: days[6], days, byDate };
  }

  function summarizeMeals(meals, foods = [], status = "") {
    const summary = { calories: 0, protein: 0, fat: 0, carbs: 0 };
    (Array.isArray(meals) ? meals : [])
      .filter((meal) => !status || meal.status === status)
      .filter((meal) => meal.status !== "skipped")
      .forEach((meal) => {
        const nutrition = calculateMealNutrition(meal, foods);
        Object.keys(summary).forEach((key) => {
          summary[key] += nutrition[key];
        });
      });
    return Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, round(value)]));
  }

  function buildShoppingList(meals, options = {}) {
    const includeEaten = options.includeEaten === true;
    const grouped = new Map();
    (Array.isArray(meals) ? meals : [])
      .filter((meal) => meal.status !== "skipped" && (includeEaten || meal.status === "planned"))
      .flatMap((meal) => meal.ingredients || [])
      .forEach((ingredient) => {
        const key = `${ingredient.foodId || ingredient.name.toLocaleLowerCase("ru-RU")}|${ingredient.unit}`;
        const current = grouped.get(key) || {
          foodId: ingredient.foodId,
          name: ingredient.name,
          quantity: 0,
          unit: ingredient.unit,
        };
        current.quantity += ingredient.quantity;
        grouped.set(key, current);
      });
    return [...grouped.values()]
      .map((item) => ({ ...item, quantity: round(item.quantity) }))
      .sort((left, right) => left.name.localeCompare(right.name, "ru-RU"));
  }

  function parseIngredientsText(value, options = {}) {
    const result = parseIngredientsInput(value, options);
    if (result.errors.length) throw new Error(result.errors.join("\n"));
    return result.ingredients;
  }

  function parseIngredientsInput(value, options = {}) {
    const ingredients = [];
    const errors = [];
    String(value || "").split(/\r?\n/).forEach((raw, index) => {
      const line = raw.trim();
      if (!line) return;
      const parts = line.includes("|") ? line.split("|").map((part) => part.trim())
        : line.match(/^(.*?)\s+(\d+(?:[.,]\d+)?)\s*([^\d\s|]+)$/)?.slice(1);
      const [name, amount, unit] = parts || [];
      const quantity = Number(String(amount || "").replace(",", "."));
      if (!name || !parts || parts.length > 3 || !(quantity > 0) || quantity > 100000 || (unit || "").length > 20) {
        errors.push(`Строка ${index + 1}: укажи продукт и количество больше 0, например «Рис 100 г».`);
        return;
      }
      const food = (options.foods || []).find((item) => item.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"));
      ingredients.push(normalizeIngredient({ foodId: food?.id || "", name, quantity, unit: unit || food?.unit || "г" }, options));
    });
    if (ingredients.length > 80) errors.push("В одном блюде можно указать не больше 80 продуктов.");
    return { ingredients, errors };
  }

  function formatIngredientsText(ingredients) {
    return (ingredients || []).map((item) => `${item.name} | ${item.quantity || ""} | ${item.unit}`).join("\n");
  }

  function startOfWeek(dateKey, firstDay = "monday") {
    const date = parseDate(dateKey) || new Date();
    const target = firstDay === "sunday" ? 0 : 1;
    const offset = (date.getUTCDay() - target + 7) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  }

  function addDays(dateKey, amount) {
    const date = parseDate(dateKey);
    if (!date) return "";
    date.setUTCDate(date.getUTCDate() + Number(amount || 0));
    return date.toISOString().slice(0, 10);
  }

  function compareMeals(left, right) {
    const typeOrder = MEAL_TYPES.indexOf(left.type) - MEAL_TYPES.indexOf(right.type);
    return String(left.time || "99:99").localeCompare(String(right.time || "99:99")) || typeOrder;
  }

  function normalizeDateKey(value) {
    const text = String(value || "");
    const date = parseDate(text);
    return date && date.toISOString().slice(0, 10) === text ? text : "";
  }

  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function normalizeTime(value) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
    return match ? `${match[1]}:${match[2]}` : "";
  }

  function cleanText(value, maxLength) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  }

  function number(value, min, max, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, round(parsed)));
  }

  function round(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
  }

  const api = {
    DEFAULT_TARGETS,
    MEAL_STATUSES,
    MEAL_TYPES,
    addDays,
    buildShoppingList,
    calculateMealNutrition,
    mealNutritionInfo,
    mealsNutritionInfo,
    formatIngredientsText,
    normalizeFood,
    normalizeIngredient,
    normalizeMeal,
    normalizeNutrition,
    normalizeSettings,
    normalizeTemplate,
    nutritionWeek,
    parseIngredientsText,
    parseIngredientsInput,
    startOfWeek,
    summarizeMeals,
  };
  global.RhythmNutritionModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
