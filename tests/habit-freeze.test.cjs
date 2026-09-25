const assert = require("node:assert/strict");
const freeze = require("../app/src/habits/habit-freeze.js");
const { mergeStates } = require("../app/src/core/state-merge.js");
const { createStateNormalizer } = require("./test-utils.cjs");

const at = (hour) => `2026-09-25T${hour}:00:00.000Z`;

module.exports = [
  {
    name: "enumerates calendar days across leap day and month boundaries",
    fn() {
      assert.deepEqual(freeze.datesBetween("2024-02-28", "2024-03-01"), ["2024-02-28", "2024-02-29", "2024-03-01"]);
      assert.throws(() => freeze.datesBetween("2026-02-30", "2026-03-01"));
      assert.throws(() => freeze.datesBetween("2020-01-01", "2035-01-01"), /10 лет/);
    },
  },
  {
    name: "freeze preserves but does not increase a completion streak",
    fn() {
      const habit = { startDate: "2026-09-19", type: "check", logs: { "2026-09-19": true, "2026-09-20": true, "2026-09-21": true, "2026-09-25": true } };
      ["2026-09-22", "2026-09-23", "2026-09-24"].forEach((date) => freeze.setFrozen(habit, date, true, "Болезнь", at("10")));
      const status = (item, date) => freeze.statusOnDate(item, date, { scheduled: true, active: true });
      assert.equal(freeze.streak(habit, "2026-09-25", status), 4);
      assert.equal(status(habit, "2026-09-24"), "frozen");
      assert.equal(status(habit, "2026-09-25"), "complete");
      freeze.setFrozen(habit, "2026-09-23", false, "", at("11"));
      assert.equal(freeze.streak(habit, "2026-09-25", status), 1);
    },
  },
  {
    name: "numeric partial value remains and off-schedule freeze is neutral",
    fn() {
      const habit = { type: "number", goal: 10, logs: { "2026-09-25": 4 } };
      freeze.setFrozen(habit, "2026-09-25", true, "Поездка", at("10"));
      assert.equal(freeze.statusOnDate(habit, "2026-09-25", { scheduled: true, active: true }), "frozen");
      assert.equal(freeze.statusOnDate(habit, "2026-09-25", { scheduled: false, active: true }), "not-due");
      freeze.setFrozen(habit, "2026-09-25", false, "", at("11"));
      assert.equal(habit.logs["2026-09-25"], 4);
    },
  },
  {
    name: "merges independent dates and keeps a newer cancellation",
    fn() {
      const make = (freezeDays) => ({ tasks: [], habits: [{ id: "habit", title: "Вода", type: "check", repeat: "daily", startDate: "2026-09-01", logs: {}, freezeDays, updatedAt: at("10") }], goals: [], categories: [], taskOrder: {} });
      const local = make({ "2026-09-20": { active: false, reason: "", updatedAt: at("11") }, "2026-09-21": { active: true, reason: "A", updatedAt: at("10") } });
      const remote = make({ "2026-09-20": { active: true, reason: "B", updatedAt: at("10") }, "2026-09-22": { active: true, reason: "C", updatedAt: at("10") } });
      const merged = mergeStates(local, remote).habits[0].freezeDays;
      assert.equal(merged["2026-09-20"].active, false);
      assert.equal(merged["2026-09-21"].reason, "A");
      assert.equal(merged["2026-09-22"].reason, "C");
    },
  },
  {
    name: "normalizes old habits and preserves valid freeze records in imports",
    fn() {
      const normalize = createStateNormalizer().normalizeState;
      const old = normalize({ habits: [{ id: "old", title: "Сон", startDate: "2026-09-01" }] });
      assert.deepEqual(old.habits[0].freezeDays, {});
      const imported = normalize({ habits: [{ id: "new", title: "Сон", startDate: "2026-09-01", freezeDays: {
        "2026-09-25": { active: true, reason: "Болезнь", updatedAt: at("10") },
        bad: { active: true, updatedAt: at("10") },
      } }] });
      assert.equal(imported.habits[0].freezeDays["2026-09-25"].reason, "Болезнь");
      assert.equal(imported.habits[0].freezeDays.bad, undefined);
    },
  },
  {
    name: "MCP overview excludes frozen days and rejects a value change",
    async fn() {
      const { createEmptyState, getTodayOverview } = await import("../mcp/task-service.mjs");
      const { setHabitValueCommand } = await import("../mcp/write-service.mjs");
      const { getProductivityStats } = await import("../mcp/management-service.mjs");
      const state = createEmptyState();
      state.habits.push({ id: "h", title: "Вода", startDate: "2026-09-01", repeat: "daily", type: "check", logs: {}, freezeDays: {
        "2026-09-25": { active: true, reason: "Болезнь", updatedAt: at("10") },
      } });
      const overview = getTodayOverview(state, "2026-09-25");
      assert.equal(overview.habits[0].status, "frozen");
      assert.equal(overview.summary.habitsTotal, 0);
      assert.equal(overview.summary.habitsFrozen, 1);
      assert.equal(getProductivityStats(state, { from: "2026-09-25", to: "2026-09-25" }).habitsFrozen, 1);
      assert.throws(() => setHabitValueCommand(state, { requestId: "freeze-test-12345", habitId: "h", date: "2026-09-25", completed: true }, { today: "2026-09-25" }), /заморожена/);
      assert.deepEqual(state.habits[0].logs, {});
    },
  },
];
