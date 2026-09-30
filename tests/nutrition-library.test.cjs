const assert = require("node:assert/strict");
const model = require("../app/src/nutrition/nutrition-model.js");
const { createNutritionController } = require("../app/src/nutrition/nutrition-controller.js");

function setup(saved = true) {
  let id = 0;
  const state = { nutritionFoods: [], nutritionMeals: [], nutritionTemplates: [], tombstones: { nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {} } };
  const controller = createNutritionController({ getState: () => state, model, createId: () => `id-${++id}`, now: () => "2026-09-30T10:00:00.000Z", render() {}, saveState: () => saved, showToast() {}, confirmAction: async () => true, createUndoSnapshot: () => ({}) });
  return { state, controller };
}
const recipe = { title: "Рис", ingredients: [{ name: "Рис", quantity: 100, unit: "г" }], nutrition: { calories: 0 }, manualNutrition: true, manualCaloriesKnown: false, servings: 2, notes: "Промыть" };

module.exports = [
  { name: "saves and updates recipes independently from dated meals", fn() {
    const { state, controller } = setup();
    assert.equal(controller.saveTemplate(recipe), true);
    assert.equal(state.nutritionMeals.length, 0);
    assert.equal(state.nutritionTemplates[0].manualCaloriesKnown, false);
    const id = state.nutritionTemplates[0].id;
    assert.equal(controller.saveTemplate({ ...state.nutritionTemplates[0], title: "Рис с овощами" }), true);
    assert.equal(state.nutritionTemplates.length, 1);
    assert.equal(state.nutritionTemplates[0].id, id);
    assert.equal(state.nutritionTemplates[0].ingredients[0].quantity, 100);
  } },
  { name: "saves a meal and its recipe atomically with independent ingredients", fn() {
    const { state, controller } = setup();
    assert.equal(controller.saveMeal({ ...recipe, date: "2026-09-30", saveToLibrary: true }), true);
    assert.equal(state.nutritionMeals.length, 1);
    assert.equal(state.nutritionTemplates.length, 1);
    state.nutritionMeals[0].ingredients[0].quantity = 200;
    assert.equal(state.nutritionTemplates[0].ingredients[0].quantity, 100);
  } },
  { name: "rolls back both meals and recipes when local persistence fails", fn() {
    const { state, controller } = setup(false);
    assert.equal(controller.saveMeal({ ...recipe, date: "2026-09-30", saveToLibrary: true }), false);
    assert.equal(state.nutritionMeals.length, 0);
    assert.equal(state.nutritionTemplates.length, 0);
    assert.equal(controller.saveTemplate(recipe), false);
    assert.equal(state.nutritionTemplates.length, 0);
  } },
  { name: "deletes a recipe with a sync tombstone without deleting existing meals", async fn() {
    const { state, controller } = setup();
    controller.saveMeal({ ...recipe, date: "2026-09-30", saveToLibrary: true });
    const id = state.nutritionTemplates[0].id;
    await controller.deleteTemplate(id);
    assert.equal(state.nutritionTemplates.length, 0);
    assert.equal(state.nutritionMeals.length, 1);
    assert.equal(state.tombstones.nutritionTemplates[id], "2026-09-30T10:00:00.000Z");
  } },
  { name: "all nutrition mutations restore data, deletion markers and sync metadata after failure", async fn() {
    for (const operation of ["food-create", "food-edit", "food-delete", "meal-edit", "meal-delete", "meal-copy", "meal-move", "meal-status", "recipe-edit", "recipe-delete", "settings"]) {
      const { state } = setup();
      state.nutritionFoods.push(model.normalizeFood({ id: "food", name: "Рис", calories: 350 }));
      state.nutritionMeals.push(model.normalizeMeal({ ...recipe, id: "meal", date: "2026-09-30", status: "eaten" }));
      state.nutritionTemplates.push(model.normalizeTemplate({ ...recipe, id: "recipe" }));
      state.nutritionSettings = { targets: { calories: 2000 }, paused: false };
      state.syncMeta = { original: true };
      const previous = structuredClone(state);
      let rollback = 0;
      const messages = [];
      const controller = createNutritionController({ getState: () => state, model, createId: () => "new", now: () => "2026-09-30T10:00:00.000Z",
        render() {}, onRollback: () => { rollback += 1; }, saveState() { state.syncMeta = { changed: true }; return false; }, showToast: (message) => messages.push(message), confirmAction: async () => true, createUndoSnapshot: () => ({}) });
      const commands = {
        "food-create": () => controller.saveFood({ name: "Соус", calories: 100 }),
        "food-edit": () => controller.saveFood({ id: "food", name: "Рис", calories: 300 }),
        "food-delete": () => controller.deleteFood("food"),
        "meal-edit": () => controller.saveMeal({ ...state.nutritionMeals[0], title: "Другой обед" }),
        "meal-delete": () => controller.deleteMeal("meal"),
        "meal-copy": () => controller.duplicateMeal("meal"),
        "meal-move": () => controller.moveMeal("meal", "2026-10-01"),
        "meal-status": () => controller.setMealStatus("meal", "skipped"),
        "recipe-edit": () => controller.saveTemplate({ ...state.nutritionTemplates[0], title: "Новый рецепт" }),
        "recipe-delete": () => controller.deleteTemplate("recipe"),
        settings: () => controller.saveSettings({ targets: { calories: 1000 }, paused: true }),
      };
      assert.equal(await commands[operation](), false, operation);
      assert.deepEqual(state, previous, operation);
      assert.equal(rollback, 1, operation);
      assert.deepEqual(messages, [], "no success toast after failed write");
    }
  } },
  { name: "duplicates eaten meals as planned and rejects invalid dates and statuses", fn() {
    const { state, controller } = setup();
    controller.saveMeal({ ...recipe, date: "2026-09-30", status: "eaten" });
    const original = state.nutritionMeals[0];
    controller.duplicateMeal(original.id);
    assert.equal(state.nutritionMeals[1].status, "planned");
    assert.equal(original.status, "eaten");
    assert.equal(controller.moveMeal(original.id, "invalid"), false);
    assert.equal(controller.setMealStatus(original.id, "invalid"), false);
  } },
  { name: "rolls back nutrition after a thrown persistence error", fn() {
    const { state } = setup();
    const previous = structuredClone(state);
    const controller = createNutritionController({ getState: () => state, model, createId: () => "food", now: () => "2026-09-30T10:00:00.000Z", render() {}, showToast() {}, saveState() { throw new Error("Disk full"); } });
    assert.equal(controller.saveFood({ name: "Рис", calories: 350 }), false);
    assert.deepEqual(state, previous);
  } },
  { name: "does not delete data in a replaced workspace after asynchronous confirmation", async fn() {
    for (const [collection, command] of [["nutritionFoods", "deleteFood"], ["nutritionMeals", "deleteMeal"], ["nutritionTemplates", "deleteTemplate"]]) {
      const { state: original } = setup();
      original[collection].push({ id: "same-id", name: "Рис", title: "Рис" });
      const replacement = structuredClone(original);
      let current = original;
      let writes = 0;
      const controller = createNutritionController({ getState: () => current, confirmAction: async () => { current = replacement; return true; }, showToast() {}, saveState: () => { writes += 1; }, createUndoSnapshot: () => ({}) });
      assert.equal(await controller[command]("same-id"), false);
      assert.equal(original[collection].length, 1);
      assert.equal(replacement[collection].length, 1);
      assert.equal(writes, 0);
    }
  } },
];
