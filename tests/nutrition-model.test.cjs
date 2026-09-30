const assert = require("node:assert/strict");
const nutrition = require("../app/src/nutrition/nutrition-model.js");

module.exports = [
  {
    name: "parses natural ingredient quantities and preserves pipe format",
    fn() {
      const foods = [{ id: "rice", name: "Рис", unit: "г" }];
      const parsed = nutrition.parseIngredientsText("Рис 100 г\nМолоко 12,5 мл\nСоль | 2 | г", { foods });
      assert.equal(parsed[0].foodId, "rice");
      assert.equal(parsed[0].name, "Рис");
      assert.equal(parsed[0].quantity, 100);
      assert.equal(parsed[1].quantity, 12.5);
      assert.equal(parsed[1].unit, "мл");
      assert.equal(parsed[2].quantity, 2);
      assert.deepEqual(nutrition.parseIngredientsText(nutrition.formatIngredientsText(parsed), { foods }).map(({ name, quantity, unit }) => ({ name, quantity, unit })),
        parsed.map(({ name, quantity, unit }) => ({ name, quantity, unit })));
      assert.equal(nutrition.parseIngredientsText("Рис | 1,5", { foods })[0].quantity, 1.5);
    },
  },
  {
    name: "rejects malformed, zero and out-of-range ingredient quantities with line numbers",
    fn() {
      for (const value of ["Рис", "Рис 0 г", "Рис -10 г", "Рис | нет | г", "Рис | 100001 | г", "Рис | 100 | г | лишнее"]) {
        assert.throws(() => nutrition.parseIngredientsText(value), /Строка 1/);
      }
      const parsed = nutrition.parseIngredientsInput("\nРис 100 г\nОшибка");
      assert.equal(parsed.ingredients.length, 1);
      assert.match(parsed.errors[0], /Строка 3/);
      assert.deepEqual(nutrition.parseIngredientsText("\n "), []);
    },
  },
  {
    name: "distinguishes unknown, partial and genuine zero nutrition",
    fn() {
      const rice = { id: "rice", unit: "g", calories: 350, protein: 7, fat: 1, carbs: 78 };
      const zero = { id: "zero", unit: "g", calories: 0, protein: 0, fat: 0, carbs: 0 };
      const known = { foodId: "rice", quantity: 100, unit: "g" };
      const unknown = { name: "Sauce", quantity: 30, unit: "g" };
      assert.equal(nutrition.mealNutritionInfo({ ingredients: [unknown] }, [rice]).status, "unknown");
      assert.equal(nutrition.mealNutritionInfo({ ingredients: [] }, [rice]).status, "unknown");
      const partial = nutrition.mealNutritionInfo({ ingredients: [known, unknown] }, [rice]);
      assert.equal(partial.status, "partial");
      assert.equal(partial.values.calories, 350);
      assert.equal(partial.missing, 1);
      assert.equal(nutrition.mealNutritionInfo({ ingredients: [{ ...known, unit: "kg" }] }, [rice]).status, "unknown");
      assert.equal(nutrition.mealNutritionInfo({ ingredients: [{ ...known, quantity: 0 }] }, [rice]).status, "unknown");
      const realZero = nutrition.mealNutritionInfo({ ingredients: [{ foodId: "zero", quantity: 100, unit: "g" }] }, [zero]);
      assert.equal(realZero.status, "complete");
      assert.equal(realZero.values.calories, 0);
      assert.equal(nutrition.mealNutritionInfo({ nutrition: { calories: 400 }, ingredients: [unknown] }, []).status, "complete");
      const nameOnly = nutrition.normalizeFood({ id: "name-only", name: "Unknown" });
      assert.equal(nameOnly.nutritionKnown, false);
      assert.equal(nutrition.normalizeFood(nameOnly).nutritionKnown, false);
      assert.equal(nutrition.mealNutritionInfo({ ingredients: [{ foodId: "name-only", quantity: 100, unit: "г" }] }, [nameOnly]).status, "unknown");
      assert.equal(nutrition.normalizeFood({ name: "Water", calories: 0 }).nutritionKnown, true);
      const manualZero = nutrition.normalizeMeal({ title: "Zero", date: "2026-09-30", nutrition: { calories: 0 }, manualNutrition: true });
      assert.equal(nutrition.mealNutritionInfo(nutrition.normalizeMeal(manualZero)).status, "complete");
      assert.equal(nutrition.mealNutritionInfo(manualZero).values.calories, 0);
      const macrosOnly = nutrition.normalizeMeal({ title: "Protein only", date: "2026-09-30",
        nutrition: { protein: 15 }, manualNutrition: true, manualCaloriesKnown: false });
      assert.equal(nutrition.mealNutritionInfo(nutrition.normalizeMeal(macrosOnly)).status, "unknown");
      assert.equal(nutrition.mealNutritionInfo(macrosOnly).values.protein, 15);
    },
  },
  {
    name: "marks incomplete summaries and ignores skipped meals",
    fn() {
      const known = { nutrition: { calories: 400 }, status: "planned" };
      const unknown = { ingredients: [], status: "planned" };
      assert.equal(nutrition.mealsNutritionInfo([], []).status, "unknown");
      assert.equal(nutrition.mealsNutritionInfo([unknown], []).status, "unknown");
      const partial = nutrition.mealsNutritionInfo([known, unknown], []);
      assert.equal(partial.status, "partial");
      assert.equal(partial.incomplete, 1);
      assert.equal(partial.values.calories, 400);
      assert.equal(nutrition.mealsNutritionInfo([known, { ...unknown, status: "skipped" }], []).status, "complete");
    },
  },
  {
    name: "builds a dated week and combines shopping quantities",
    fn() {
      const meals = [
        nutrition.normalizeMeal({
          id: "meal-1",
          date: "2026-07-27",
          type: "breakfast",
          title: "Каша",
          ingredients: [{ id: "i-1", name: "Овсянка", quantity: 80, unit: "г" }],
        }),
        nutrition.normalizeMeal({
          id: "meal-2",
          date: "2026-07-28",
          type: "breakfast",
          title: "Каша ещё раз",
          ingredients: [{ id: "i-2", name: "Овсянка", quantity: 70, unit: "г" }],
        }),
      ];

      const week = nutrition.nutritionWeek(meals, "2026-07-29", "monday");
      assert.equal(week.start, "2026-07-27");
      assert.equal(week.end, "2026-08-02");
      assert.equal(week.byDate["2026-07-27"][0].title, "Каша");
      assert.deepEqual(nutrition.buildShoppingList(meals), [
        { foodId: "", name: "Овсянка", quantity: 150, unit: "г" },
      ]);
    },
  },
  {
    name: "keeps explicit nutrition authoritative when ingredients are partly known",
    fn() {
      const food = nutrition.normalizeFood({
        id: "food-1",
        name: "Рис",
        unit: "г",
        calories: 350,
        protein: 7,
        fat: 1,
        carbs: 78,
      });
      const meal = nutrition.normalizeMeal({
        id: "meal-1",
        date: "2026-07-27",
        title: "Рис с соусом",
        ingredients: [
          { id: "i-1", foodId: "food-1", name: "Рис", quantity: 100, unit: "г" },
          { id: "i-2", name: "Соус", quantity: 30, unit: "г" },
        ],
        nutrition: { calories: 430, protein: 10, fat: 8, carbs: 80 },
      });

      assert.deepEqual(nutrition.calculateMealNutrition(meal, [food]), {
        calories: 430,
        protein: 10,
        fat: 8,
        carbs: 80,
      });
    },
  },
];
