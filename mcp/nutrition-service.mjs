import nutritionModel from "../app/src/nutrition/nutrition-model.js";
import { recordMcpActivity } from "./activity-service.mjs";

const ENTITY_FIELDS = {
  nutritionFoods: ["name", "unit", "calories", "protein", "fat", "carbs", "source", "approximate"],
  nutritionMeals: ["date", "type", "time", "title", "servings", "ingredients", "nutrition", "status", "notes"],
  nutritionTemplates: ["title", "type", "time", "servings", "ingredients", "nutrition", "notes"],
};

export function getNutritionWeek(state, anchorDate, firstDay = "monday") {
  ensureShape(state);
  const week = nutritionModel.nutritionWeek(state.nutritionMeals, anchorDate, firstDay);
  const meals = week.days.flatMap((date) => week.byDate[date]);
  return {
    ...week,
    meals,
    totals: nutritionModel.summarizeMeals(meals, state.nutritionFoods),
    targets: state.nutritionSettings.targets,
    paused: state.nutritionSettings.paused,
  };
}

export function getNutritionDay(state, date) {
  ensureShape(state);
  const meals = state.nutritionMeals
    .filter((meal) => meal.date === date)
    .map((meal) => ({ ...meal, calculatedNutrition: nutritionModel.calculateMealNutrition(meal, state.nutritionFoods) }));
  return {
    date,
    meals,
    totals: nutritionModel.summarizeMeals(meals, state.nutritionFoods),
    targets: state.nutritionSettings.targets,
    paused: state.nutritionSettings.paused,
  };
}

export function getShoppingList(state, from, to) {
  ensureShape(state);
  assertDateRange(from, to, 31);
  const meals = state.nutritionMeals.filter((meal) => meal.date >= from && meal.date <= to);
  return { from, to, items: nutritionModel.buildShoppingList(meals), mealCount: meals.length };
}

export function createMealCommand(state, input, options = {}) {
  return mutateWithActivity(state, input, options, {
    type: "create_nutrition_meal",
    title: "Добавление блюда",
    apply(next, now) {
      const meal = nutritionModel.normalizeMeal(input, modelOptions(next, now, `mcp-meal-${input.requestId}`));
      if (!meal) throw new Error("Укажи название и корректную дату блюда");
      next.nutritionMeals.push(meal);
      delete next.tombstones.nutritionMeals[meal.id];
      touchEntity(next, "nutritionMeals", meal, now);
      return { meal, summary: `Блюдо «${meal.title}» добавлено на ${meal.date}` };
    },
  });
}

export function updateMealCommand(state, input, options = {}) {
  return mutateWithActivity(state, input, options, {
    type: "update_nutrition_meal",
    title: "Изменение блюда",
    apply(next, now) {
      const id = stripPrefix(input.mealId, "nutrition-meal:");
      const index = next.nutritionMeals.findIndex((meal) => meal.id === id);
      if (index < 0) throw new Error("Блюдо не найдено");
      const current = next.nutritionMeals[index];
      const meal = nutritionModel.normalizeMeal(
        { ...current, ...definedFields(input, [
          "date", "type", "time", "title", "servings", "ingredients", "nutrition", "status", "notes",
        ]), id, createdAt: current.createdAt, updatedAt: now },
        modelOptions(next, now),
      );
      if (!meal) throw new Error("После изменения у блюда должны остаться название и дата");
      next.nutritionMeals[index] = meal;
      touchEntity(next, "nutritionMeals", meal, now);
      return { meal, summary: `Блюдо «${meal.title}» обновлено` };
    },
  });
}

export function deleteMealCommand(state, input, options = {}) {
  if (input.confirm !== true) throw new Error("Для удаления блюда требуется явное подтверждение confirm=true");
  return mutateWithActivity(state, input, options, {
    type: "delete_nutrition_meal",
    title: "Удаление блюда",
    apply(next, now) {
      const id = stripPrefix(input.mealId, "nutrition-meal:");
      const meal = next.nutritionMeals.find((item) => item.id === id);
      if (!meal) throw new Error("Блюдо не найдено");
      next.nutritionMeals = next.nutritionMeals.filter((item) => item.id !== id);
      next.tombstones.nutritionMeals[id] = now;
      return { mealId: id, summary: `Блюдо «${meal.title}» удалено` };
    },
  });
}

export function setMealStatusCommand(state, input, options = {}) {
  return updateMealCommand(state, {
    requestId: input.requestId,
    mealId: input.mealId,
    status: input.status,
  }, { ...options, activityType: "set_nutrition_meal_status", activityTitle: "Статус блюда" });
}

export function upsertFoodCommand(state, input, options = {}) {
  return mutateWithActivity(state, input, options, {
    type: "upsert_nutrition_food",
    title: "Сохранение продукта",
    apply(next, now) {
      const requestedId = stripPrefix(input.foodId, "nutrition-food:");
      const index = requestedId
        ? next.nutritionFoods.findIndex((food) => food.id === requestedId)
        : next.nutritionFoods.findIndex((food) => food.name.toLocaleLowerCase("ru-RU") === String(input.name || "").trim().toLocaleLowerCase("ru-RU"));
      const current = index >= 0 ? next.nutritionFoods[index] : {};
      const food = nutritionModel.normalizeFood({
        ...current,
        ...definedFields(input, ["name", "unit", "calories", "protein", "fat", "carbs", "source", "approximate"]),
        id: current.id || requestedId || `mcp-food-${input.requestId}`,
        createdAt: current.createdAt,
        updatedAt: now,
      }, { now });
      if (!food) throw new Error("Укажи название продукта");
      if (index >= 0) next.nutritionFoods[index] = food;
      else next.nutritionFoods.push(food);
      delete next.tombstones.nutritionFoods[food.id];
      touchEntity(next, "nutritionFoods", food, now);
      return { food, summary: `Продукт «${food.name}» сохранён` };
    },
  });
}

export function deleteFoodCommand(state, input, options = {}) {
  if (input.confirm !== true) throw new Error("Для удаления продукта требуется явное подтверждение confirm=true");
  return mutateWithActivity(state, input, options, {
    type: "delete_nutrition_food",
    title: "Удаление продукта",
    apply(next, now) {
      const id = stripPrefix(input.foodId, "nutrition-food:");
      const food = next.nutritionFoods.find((item) => item.id === id);
      if (!food) throw new Error("Продукт не найден");
      next.nutritionFoods = next.nutritionFoods.filter((item) => item.id !== id);
      next.tombstones.nutritionFoods[id] = now;
      return {
        foodId: id,
        summary: `Продукт «${food.name}» удалён; состав существующих блюд сохранён текстом`,
      };
    },
  });
}

export function upsertTemplateCommand(state, input, options = {}) {
  return mutateWithActivity(state, input, options, {
    type: "upsert_meal_template",
    title: "Сохранение шаблона блюда",
    apply(next, now) {
      const requestedId = stripPrefix(input.templateId, "nutrition-template:");
      const index = requestedId ? next.nutritionTemplates.findIndex((item) => item.id === requestedId) : -1;
      const current = index >= 0 ? next.nutritionTemplates[index] : {};
      const template = nutritionModel.normalizeTemplate({
        ...current,
        ...definedFields(input, ["title", "type", "time", "servings", "ingredients", "nutrition", "notes"]),
        id: current.id || requestedId || `mcp-template-${input.requestId}`,
        createdAt: current.createdAt,
        updatedAt: now,
      }, modelOptions(next, now));
      if (!template) throw new Error("Укажи название шаблона");
      if (index >= 0) next.nutritionTemplates[index] = template;
      else next.nutritionTemplates.push(template);
      delete next.tombstones.nutritionTemplates[template.id];
      touchEntity(next, "nutritionTemplates", template, now);
      return { template, summary: `Шаблон «${template.title}» сохранён` };
    },
  });
}

export function deleteTemplateCommand(state, input, options = {}) {
  if (input.confirm !== true) throw new Error("Для удаления шаблона требуется явное подтверждение confirm=true");
  return mutateWithActivity(state, input, options, {
    type: "delete_meal_template",
    title: "Удаление шаблона блюда",
    apply(next, now) {
      const id = stripPrefix(input.templateId, "nutrition-template:");
      const template = next.nutritionTemplates.find((item) => item.id === id);
      if (!template) throw new Error("Шаблон блюда не найден");
      next.nutritionTemplates = next.nutritionTemplates.filter((item) => item.id !== id);
      next.tombstones.nutritionTemplates[id] = now;
      return { templateId: id, summary: `Шаблон «${template.title}» удалён` };
    },
  });
}

export function setTargetsCommand(state, input, options = {}) {
  return mutateWithActivity(state, input, options, {
    type: "set_nutrition_targets",
    title: "Цели питания",
    apply(next, now) {
      next.nutritionSettings = nutritionModel.normalizeSettings({
        ...next.nutritionSettings,
        targets: input.targets,
        updatedAt: now,
      });
      return { settings: next.nutritionSettings, summary: "Цели калорий и БЖУ обновлены" };
    },
  });
}

export function setPlanPausedCommand(state, input, options = {}) {
  return mutateWithActivity(state, input, options, {
    type: "set_nutrition_plan_paused",
    title: "Состояние плана питания",
    apply(next, now) {
      next.nutritionSettings = nutritionModel.normalizeSettings({
        ...next.nutritionSettings,
        paused: input.paused === true,
        updatedAt: now,
      });
      return {
        paused: next.nutritionSettings.paused,
        summary: next.nutritionSettings.paused ? "План питания приостановлен" : "План питания снова активен",
      };
    },
  });
}

export function previewNutritionPlan(state, input) {
  ensureShape(state);
  const plan = normalizePlan(input, state);
  return {
    previewToken: hash(JSON.stringify(plan)),
    mode: plan.mode,
    from: plan.from,
    to: plan.to,
    foods: plan.foods,
    meals: plan.meals,
    targets: plan.targets,
    totals: nutritionModel.summarizeMeals(plan.meals, [...state.nutritionFoods, ...plan.foods]),
    shoppingList: nutritionModel.buildShoppingList(plan.meals),
    replacedMealCount: plan.mode === "replace"
      ? state.nutritionMeals.filter((meal) => meal.date >= plan.from && meal.date <= plan.to).length
      : 0,
  };
}

export function applyNutritionPlanCommand(state, input, options = {}) {
  return mutateWithActivity(state, input, options, {
    type: "apply_nutrition_plan",
    title: "Применение плана питания",
    apply(next, now) {
      const preview = previewNutritionPlan(next, input);
      if (!input.previewToken || input.previewToken !== preview.previewToken) {
        throw new Error("План изменился или не был предварительно проверен. Сначала вызови preview_nutrition_plan");
      }
      if (preview.mode === "replace") {
        const removed = next.nutritionMeals.filter((meal) => meal.date >= preview.from && meal.date <= preview.to);
        removed.forEach((meal) => {
          next.tombstones.nutritionMeals[meal.id] = now;
        });
        next.nutritionMeals = next.nutritionMeals.filter((meal) => meal.date < preview.from || meal.date > preview.to);
      }
      preview.foods.forEach((food, index) => {
        const existingIndex = next.nutritionFoods.findIndex((item) => item.name.toLocaleLowerCase("ru-RU") === food.name.toLocaleLowerCase("ru-RU"));
        const normalized = nutritionModel.normalizeFood({
          ...(existingIndex >= 0 ? next.nutritionFoods[existingIndex] : {}),
          ...food,
          id: existingIndex >= 0 ? next.nutritionFoods[existingIndex].id : `mcp-plan-food-${input.requestId}-${index}`,
          updatedAt: now,
        }, { now });
        if (existingIndex >= 0) next.nutritionFoods[existingIndex] = normalized;
        else next.nutritionFoods.push(normalized);
        delete next.tombstones.nutritionFoods[normalized.id];
        touchEntity(next, "nutritionFoods", normalized, now);
      });
      const foodByName = new Map(next.nutritionFoods.map((food) => [food.name.toLocaleLowerCase("ru-RU"), food]));
      const meals = preview.meals.map((meal, index) => nutritionModel.normalizeMeal({
        ...meal,
        id: `mcp-plan-meal-${input.requestId}-${index}`,
        ingredients: meal.ingredients.map((ingredient) => ({
          ...ingredient,
          foodId: foodByName.get(ingredient.name.toLocaleLowerCase("ru-RU"))?.id
            || (ingredient.foodId.startsWith("preview-food-") ? "" : ingredient.foodId),
        })),
        updatedAt: now,
      }, modelOptions(next, now))).filter(Boolean);
      meals.forEach((meal) => {
        next.nutritionMeals.push(meal);
        delete next.tombstones.nutritionMeals[meal.id];
        touchEntity(next, "nutritionMeals", meal, now);
      });
      if (preview.targets) {
        next.nutritionSettings = nutritionModel.normalizeSettings({
          ...next.nutritionSettings,
          targets: preview.targets,
          updatedAt: now,
        });
      }
      return {
        from: preview.from,
        to: preview.to,
        mealCount: meals.length,
        summary: `План питания на ${preview.from}–${preview.to} применён`,
      };
    },
  });
}

export function clearNutritionPeriodCommand(state, input, options = {}) {
  if (input.confirm !== true) throw new Error("Для очистки периода требуется явное подтверждение confirm=true");
  return mutateWithActivity(state, input, options, {
    type: "clear_nutrition_period",
    title: "Очистка плана питания",
    apply(next, now) {
      assertDateRange(input.from, input.to, 31);
      const removed = next.nutritionMeals.filter((meal) => meal.date >= input.from && meal.date <= input.to);
      removed.forEach((meal) => {
        next.tombstones.nutritionMeals[meal.id] = now;
      });
      next.nutritionMeals = next.nutritionMeals.filter((meal) => meal.date < input.from || meal.date > input.to);
      return {
        removedCount: removed.length,
        summary: `Из плана питания удалено блюд: ${removed.length}`,
      };
    },
  });
}

function normalizePlan(input, state) {
  assertDateRange(input.from, input.to, 31);
  const now = "2000-01-01T00:00:00.000Z";
  const foods = (Array.isArray(input.foods) ? input.foods : [])
    .map((food, index) => nutritionModel.normalizeFood({ ...food, id: `preview-food-${index}` }, { now }))
    .filter(Boolean);
  const foodByName = new Map([...state.nutritionFoods, ...foods].map((food) => [food.name.toLocaleLowerCase("ru-RU"), food]));
  const meals = (Array.isArray(input.meals) ? input.meals : [])
    .map((meal, index) => nutritionModel.normalizeMeal({
      ...meal,
      id: `preview-meal-${index}`,
      status: "planned",
      ingredients: (meal.ingredients || []).map((ingredient, ingredientIndex) => ({
        ...ingredient,
        id: `preview-ingredient-${index}-${ingredientIndex}`,
        foodId: ingredient.foodId || foodByName.get(String(ingredient.name || "").toLocaleLowerCase("ru-RU"))?.id || "",
      })),
    }, { now, foodById: new Map([...state.nutritionFoods, ...foods].map((food) => [food.id, food])) }))
    .filter(Boolean);
  if (!meals.length) throw new Error("План должен содержать хотя бы одно блюдо");
  if (meals.some((meal) => meal.date < input.from || meal.date > input.to)) {
    throw new Error("Все блюда должны находиться внутри указанного периода");
  }
  return {
    mode: input.mode === "replace" ? "replace" : "merge",
    from: input.from,
    to: input.to,
    foods,
    meals,
    targets: input.targets ? nutritionModel.normalizeNutrition(input.targets) : null,
  };
}

function mutateWithActivity(state, input, options, definition) {
  const before = clone(state);
  const next = clone(state);
  ensureShape(next);
  const requestId = normalizeRequestId(input.requestId);
  const previous = next.mcpActivity.find((item) => item?.requestId === requestId);
  if (previous) return { changed: false, state: next, activity: previous, summary: "Этот запрос уже был обработан" };
  const now = options.now || new Date().toISOString();
  const result = definition.apply(next, now);
  const activity = recordMcpActivity(before, next, {
    requestId,
    type: options.activityType || definition.type,
    title: options.activityTitle || definition.title,
    summary: result.summary,
  }, now);
  return { changed: true, state: next, activity, ...result };
}

function ensureShape(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Состояние приложения повреждено");
  state.nutritionFoods = Array.isArray(state.nutritionFoods) ? state.nutritionFoods : [];
  state.nutritionMeals = Array.isArray(state.nutritionMeals) ? state.nutritionMeals : [];
  state.nutritionTemplates = Array.isArray(state.nutritionTemplates) ? state.nutritionTemplates : [];
  state.nutritionSettings = nutritionModel.normalizeSettings(state.nutritionSettings);
  state.mcpActivity = Array.isArray(state.mcpActivity) ? state.mcpActivity : [];
  state.tombstones = state.tombstones && typeof state.tombstones === "object" ? state.tombstones : {};
  ["nutritionFoods", "nutritionMeals", "nutritionTemplates"].forEach((type) => {
    state.tombstones[type] ||= {};
  });
  state.syncMeta = state.syncMeta && typeof state.syncMeta === "object" ? state.syncMeta : {};
  state.syncMeta.entityFields = state.syncMeta.entityFields && typeof state.syncMeta.entityFields === "object"
    ? state.syncMeta.entityFields
    : {};
  ["nutritionFoods", "nutritionMeals", "nutritionTemplates"].forEach((type) => {
    state.syncMeta.entityFields[type] ||= {};
  });
}

function touchEntity(state, type, entity, now) {
  const versions = (state.syncMeta.entityFields[type][entity.id] ||= {});
  ENTITY_FIELDS[type].forEach((field) => {
    versions[field] = now;
  });
}

function modelOptions(state, now, id = "") {
  return {
    createId: id ? () => id : undefined,
    foodById: new Map(state.nutritionFoods.map((food) => [food.id, food])),
    now,
  };
}

function definedFields(input, fields) {
  return Object.fromEntries(fields.filter((field) => input[field] !== undefined).map((field) => [field, input[field]]));
}

function stripPrefix(value, prefix) {
  return String(value || "").replace(new RegExp(`^${prefix}`), "");
}

function normalizeRequestId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9._:-]{8,100}$/.test(id)) throw new Error("requestId должен содержать 8–100 безопасных символов");
  return id;
}

function assertDateRange(from, to, maxDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to)) || from > to) {
    throw new Error("Укажи корректный период YYYY-MM-DD");
  }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
  if (!Number.isFinite(days) || days > maxDays) throw new Error(`Период не должен превышать ${maxDays} дней`);
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return `nutrition-${(result >>> 0).toString(16)}`;
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value || {})
    : JSON.parse(JSON.stringify(value || {}));
}
