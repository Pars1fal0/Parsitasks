const assert = require("node:assert/strict");
const nutrition = require("../src/nutrition/nutrition-model.js");

module.exports = [
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
