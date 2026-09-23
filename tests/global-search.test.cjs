const assert = require("node:assert/strict");
const { excerptAround, searchWorkspace } = require("../app/src/ui/global-search.js");

module.exports = [
  {
    name: "searches tasks, habits, goals, and journal entries together",
    fn() {
      const state = {
        categories: [{ id: "work", name: "Работа" }],
        tasks: [{ id: "task", title: "Запустить сайт", date: "2026-07-25", categoryId: "work", completed: {} }],
        habits: [{ id: "habit", title: "Читать книгу", startDate: "2026-07-01" }],
        goals: [{ id: "goal", title: "Подготовить релиз", steps: [{ title: "Запустить сайт" }] }],
        journalEntries: [{ id: "journal", date: "2026-07-24", text: "Сегодня удалось запустить сайт" }],
      };
      const results = searchWorkspace(state, "запустить сайт");
      assert.deepEqual(results.map((item) => item.type), ["task", "goal", "journal"]);
      assert.equal(results.at(-1).view, "journal");
    },
  },
  {
    name: "does not duplicate a completed task and shows the matching journal fragment",
    fn() {
      const state = {
        tasks: [{
          id: "done",
          title: "Закрыть релиз",
          date: "2026-07-25",
          completed: { "2026-07-25": true },
        }],
        journalEntries: [{
          id: "journal",
          date: "2026-07-25",
          text: `${"Начало записи ".repeat(10)}важный релиз завершён`,
        }],
      };
      const taskResults = searchWorkspace(state, "закрыть релиз");
      assert.deepEqual(taskResults.map((item) => item.type), ["archive"]);
      assert.match(excerptAround(state.journalEntries[0].text, "важный"), /важный/);
      assert.match(excerptAround(state.journalEntries[0].text, "важный"), /^\.\.\./);
    },
  },
  {
    name: "finds nutrition meals by ingredient and opens the nutrition week",
    fn() {
      const results = searchWorkspace({
        nutritionMeals: [{
          id: "meal",
          title: "Завтрак",
          date: "2026-07-27",
          ingredients: [{ name: "Овсянка" }],
        }],
      }, "овсянка");

      assert.equal(results[0].type, "nutrition");
      assert.equal(results[0].view, "nutrition");
      assert.equal(results[0].date, "2026-07-27");
    },
  },
];
