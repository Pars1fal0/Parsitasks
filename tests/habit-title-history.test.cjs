const assert = require("node:assert/strict");
const {
  applyHabitTitleChange,
  habitTitleOnDate,
  mergeHabitTitleHistory,
  normalizeHabitTitleHistory,
} = require("../src/habits/habit-title-history.js");

module.exports = [
  {
    name: "keeps an old habit title before a dated rename",
    fn() {
      const habit = applyHabitTitleChange(
        {
          title: "Чтение",
          startDate: "2026-07-01",
          createdAt: "2026-07-01T08:00:00.000Z",
        },
        "Читать 30 минут",
        "2026-07-13",
        { updatedAt: "2026-07-13T08:00:00.000Z" },
      );

      assert.equal(habitTitleOnDate(habit, "2026-07-12"), "Чтение");
      assert.equal(habitTitleOnDate(habit, "2026-07-13"), "Читать 30 минут");
      assert.equal(habitTitleOnDate(habit, "2026-08-01"), "Читать 30 минут");
      assert.equal(habit.title, "Читать 30 минут");
    },
  },
  {
    name: "supports several successive habit title versions",
    fn() {
      let habit = { title: "Вода", startDate: "2026-07-01", createdAt: "2026-07-01T08:00:00.000Z" };
      habit = applyHabitTitleChange(habit, "Пить воду", "2026-07-05", { updatedAt: "2026-07-05T08:00:00.000Z" });
      habit = applyHabitTitleChange(habit, "Два литра воды", "2026-07-10", { updatedAt: "2026-07-10T08:00:00.000Z" });

      assert.equal(habitTitleOnDate(habit, "2026-07-03"), "Вода");
      assert.equal(habitTitleOnDate(habit, "2026-07-07"), "Пить воду");
      assert.equal(habitTitleOnDate(habit, "2026-07-12"), "Два литра воды");
    },
  },
  {
    name: "merges title versions created on different devices",
    fn() {
      const history = mergeHabitTitleHistory(
        {
          title: "Утренняя зарядка",
          startDate: "2026-07-01",
          titleHistory: [
            { fromDate: "2026-07-01", title: "Зарядка", updatedAt: "2026-07-01T08:00:00.000Z" },
            { fromDate: "2026-07-05", title: "Утренняя зарядка", updatedAt: "2026-07-05T08:00:00.000Z" },
          ],
        },
        {
          title: "Зарядка 15 минут",
          startDate: "2026-07-01",
          titleHistory: [
            { fromDate: "2026-07-01", title: "Зарядка", updatedAt: "2026-07-01T08:00:00.000Z" },
            { fromDate: "2026-07-10", title: "Зарядка 15 минут", updatedAt: "2026-07-10T08:00:00.000Z" },
          ],
        },
      );

      assert.deepEqual(history.map((entry) => entry.title), ["Зарядка", "Утренняя зарядка", "Зарядка 15 минут"]);
    },
  },
  {
    name: "normalizes legacy habits into one initial title version",
    fn() {
      assert.deepEqual(
        normalizeHabitTitleHistory(null, {
          fallbackTitle: "Прогулка",
          startDate: "2026-07-02",
          updatedAt: "2026-07-02T08:00:00.000Z",
        }),
        [{ fromDate: "2026-07-02", title: "Прогулка", updatedAt: "2026-07-02T08:00:00.000Z" }],
      );
    },
  },
];
