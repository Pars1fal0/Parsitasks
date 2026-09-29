const assert = require("node:assert/strict");
const activity = require("../app/src/goals/goal-activity.js");
const { createStateNormalizer } = require("./test-utils.cjs");
const { mergeStates } = require("../app/src/core/state-merge.js");

module.exports = [
  {
    name: "counts only completed linked activity inside the selected week and before today",
    fn() {
      const goal = {
        linkedTaskIds: ["task"],
        habitTargets: [{ habitId: "habit", targetCount: 10, startDate: "2026-09-29" }],
      };
      const state = {
        tasks: [{ id: "task", completed: { "2026-09-28": true, "2026-09-29": true, "2026-09-30": false, "2026-10-02": true, "2026-10-05": true } }],
        habits: [{ id: "habit", logs: { "2026-09-28": true, "2026-09-29": true, "2026-09-30": true, "2026-10-02": true } }],
      };
      const week = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
      const result = activity.goalWeekActivity(goal, state, week, { todayKey: "2026-09-30" });
      assert.deepEqual(result, { taskCount: 2, habitCount: 2, hasLinks: true });
      assert.deepEqual(activity.goalWeekActivity({ linkedTaskIds: [], habitTargets: [], steps: [{ done: true }] }, state, week, { todayKey: "2026-09-30" }), {
        taskCount: 0, habitCount: 0, hasLinks: false,
      });
    },
  },
  {
    name: "normalizes goal links while preserving old checkpoints",
    fn() {
      const state = createStateNormalizer().normalizeState({
        goals: [{
          id: "goal",
          title: "Закончить курс",
          dueDate: "2026-10-31",
          steps: [{ id: "step", title: "Сдать работу", done: false }],
          linkedTaskIds: ["task", "task", ""],
          habitTargets: [{ habitId: "habit", targetCount: 7, startDate: "2026-09-29" }],
        }],
      });
      assert.deepEqual(state.goals[0].linkedTaskIds, ["task"]);
      assert.deepEqual(state.goals[0].habitTargets, [{ habitId: "habit", targetCount: 7, startDate: "2026-09-29" }]);
      assert.equal(state.goals[0].steps[0].done, false);
      assert.deepEqual(createStateNormalizer().normalizeState({ goals: [{ id: "old", status: "done", steps: [] }] }).goals[0].steps.map((step) => step.done), [true]);
    },
  },
  {
    name: "counts linked tasks once and habit completions only from the chosen date",
    fn() {
      const goal = {
        steps: [{ done: true }],
        linkedTaskIds: ["task"],
        habitTargets: [{ habitId: "habit", targetCount: 4, startDate: "2026-09-29" }],
      };
      const state = {
        tasks: [{ id: "task", completed: { "2026-09-28": true, "2026-09-29": true, "2026-09-30": true } }],
        habits: [{ id: "habit", logs: { "2026-09-28": true, "2026-09-29": true, "2026-09-30": true, "2026-10-01": true } }],
      };
      const result = activity.goalActivity(goal, state, {
        todayKey: "2026-10-01",
        habitStatusOnDate: (habit, day) => habit.logs[day] === true ? "complete" : "incomplete",
      });
      assert.equal(result.taskResults[0].done, true);
      assert.equal(result.habitResults[0].count, 3);
      assert.equal(result.percent, 92);
      assert.equal(result.achieved, false);
      state.habits[0].logs["2026-10-02"] = true;
      assert.equal(activity.goalActivity(goal, state, { todayKey: "2026-10-02" }).achieved, true);
    },
  },
  {
    name: "reconciles goal completion when linked actions change",
    fn() {
      const state = {
        goals: [{ id: "goal", steps: [], linkedTaskIds: ["task"], habitTargets: [], status: "active", completedAt: "" }],
        tasks: [{ id: "task", completed: {} }],
        habits: [],
      };
      state.tasks[0].completed["2026-09-29"] = true;
      assert.equal(activity.reconcileGoalStatuses(state, { now: "2026-09-29T12:00:00Z", todayKey: "2026-09-29" }), true);
      assert.equal(state.goals[0].status, "done");
      assert.equal(state.goals[0].completedAt, "2026-09-29T12:00:00Z");
      assert.equal(activity.reconcileGoalStatuses(state, { now: "2026-09-29T12:01:00Z", todayKey: "2026-09-29" }), false);
      delete state.tasks[0].completed["2026-09-29"];
      activity.reconcileGoalStatuses(state, { now: "2026-09-29T12:02:00Z", todayKey: "2026-09-29" });
      assert.equal(state.goals[0].status, "active");
      assert.equal(state.goals[0].completedAt, "");
    },
  },
  {
    name: "merges linked goal fields without treating manual checkpoints as the whole goal",
    fn() {
      const local = {
        goals: [{ id: "goal", title: "Курс", dueDate: "2026-10-31", steps: [{ id: "step", title: "Практика", done: true }], linkedTaskIds: ["task"], habitTargets: [], status: "active", updatedAt: "2026-09-29T10:00:00Z" }],
        syncMeta: { entityFields: { goals: { goal: { linkedTaskIds: "2026-09-29T10:00:00Z" } } } },
      };
      const remote = {
        goals: [{ id: "goal", title: "Курс", dueDate: "2026-10-31", steps: [{ id: "step", title: "Практика", done: true }], linkedTaskIds: [], habitTargets: [], status: "done", updatedAt: "2026-09-28T10:00:00Z" }],
      };
      const merged = mergeStates(local, remote);
      assert.deepEqual(merged.goals[0].linkedTaskIds, ["task"]);
      assert.equal(merged.goals[0].status, "active");
    },
  },
];
