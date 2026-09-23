const assert = require("node:assert/strict");
const {
  applyHabitAvailabilityChange,
  applyHabitConfigChange,
  habitConfigOnDate,
  habitIsArchivedOnDate,
  mergeHabitConfigHistory,
  mergeHabitAvailabilityHistory,
} = require("../app/src/habits/habit-config-history.js");

module.exports = [
  {
    name: "keeps an archived habit visible on dates before it was archived",
    fn() {
      const habit = { archived: true, archivedFromDate: "2026-07-20" };
      assert.equal(habitIsArchivedOnDate(habit, "2026-07-19"), false);
      assert.equal(habitIsArchivedOnDate(habit, "2026-07-20"), true);
    },
  },
  {
    name: "keeps a past pause after the habit is restored",
    fn() {
      let habit = {
        id: "habit-1",
        startDate: "2026-07-01",
        archived: false,
        updatedAt: "2026-07-01T08:00:00.000Z",
      };
      habit = applyHabitAvailabilityChange(habit, false, "2026-07-10", { updatedAt: "2026-07-10T08:00:00.000Z" });
      habit = applyHabitAvailabilityChange(habit, true, "2026-07-13", { updatedAt: "2026-07-13T08:00:00.000Z" });

      assert.equal(habitIsArchivedOnDate(habit, "2026-07-09"), false);
      assert.equal(habitIsArchivedOnDate(habit, "2026-07-11"), true);
      assert.equal(habitIsArchivedOnDate(habit, "2026-07-13"), false);
      assert.equal(habit.archived, false);
    },
  },
  {
    name: "merges pause and restore history from different devices",
    fn() {
      const history = mergeHabitAvailabilityHistory(
        {
          startDate: "2026-07-01",
          availabilityHistory: [
            { active: true, fromDate: "2026-07-01", updatedAt: "2026-07-01T08:00:00.000Z" },
            { active: false, fromDate: "2026-07-10", updatedAt: "2026-07-10T08:00:00.000Z" },
          ],
        },
        {
          startDate: "2026-07-01",
          availabilityHistory: [
            { active: true, fromDate: "2026-07-01", updatedAt: "2026-07-01T08:00:00.000Z" },
            { active: true, fromDate: "2026-07-13", updatedAt: "2026-07-13T08:00:00.000Z" },
          ],
        },
      );

      assert.deepEqual(history.map((entry) => [entry.fromDate, entry.active]), [
        ["2026-07-01", true],
        ["2026-07-10", false],
        ["2026-07-13", true],
      ]);
    },
  },
  {
    name: "keeps old habit targets and units before a dated settings change",
    fn() {
      const habit = applyHabitConfigChange(
        { type: "number", goal: 2, unit: "л", repeat: "daily", startDate: "2026-07-01", updatedAt: "2026-07-01T08:00:00.000Z" },
        { type: "number", goal: 3, unit: "л", repeat: "weekdays" },
        "2026-07-15",
        { updatedAt: "2026-07-15T08:00:00.000Z" },
      );

      assert.deepEqual(
        { goal: habitConfigOnDate(habit, "2026-07-14").goal, repeat: habitConfigOnDate(habit, "2026-07-14").repeat },
        { goal: 2, repeat: "daily" },
      );
      assert.deepEqual(
        { goal: habitConfigOnDate(habit, "2026-07-15").goal, repeat: habitConfigOnDate(habit, "2026-07-15").repeat },
        { goal: 3, repeat: "weekdays" },
      );
    },
  },
  {
    name: "preserves historical numeric settings after switching to a check habit",
    fn() {
      const habit = applyHabitConfigChange(
        { type: "number", goal: 20, unit: "стр.", repeat: "daily", startDate: "2026-07-01" },
        { type: "check", repeat: "daily" },
        "2026-07-20",
        { updatedAt: "2026-07-20T08:00:00.000Z" },
      );

      assert.equal(habitConfigOnDate(habit, "2026-07-19").type, "number");
      assert.equal(habitConfigOnDate(habit, "2026-07-19").goal, 20);
      assert.equal(habitConfigOnDate(habit, "2026-07-20").type, "check");
    },
  },
  {
    name: "merges configuration versions created on different devices",
    fn() {
      const history = mergeHabitConfigHistory(
        {
          startDate: "2026-07-01",
          type: "number", goal: 2, unit: "л", repeat: "daily",
          configHistory: [
            { fromDate: "2026-07-01", type: "number", goal: 2, unit: "л", repeat: "daily", updatedAt: "2026-07-01T08:00:00.000Z" },
            { fromDate: "2026-07-10", type: "number", goal: 3, unit: "л", repeat: "daily", updatedAt: "2026-07-10T08:00:00.000Z" },
          ],
        },
        {
          startDate: "2026-07-01",
          type: "number", goal: 3, unit: "л", repeat: "weekdays",
          configHistory: [
            { fromDate: "2026-07-01", type: "number", goal: 2, unit: "л", repeat: "daily", updatedAt: "2026-07-01T08:00:00.000Z" },
            { fromDate: "2026-07-15", type: "number", goal: 3, unit: "л", repeat: "weekdays", updatedAt: "2026-07-15T08:00:00.000Z" },
          ],
        },
      );

      assert.deepEqual(history.map((entry) => entry.fromDate), ["2026-07-01", "2026-07-10", "2026-07-15"]);
    },
  },
];
