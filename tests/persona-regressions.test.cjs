const assert = require("node:assert/strict");
const { moveTasksToDate, moveTasksToLater, recurringBacklogGroups } = require("../app/src/tasks/task-moves.js");
const { goalMatchesFilter } = require("../app/src/goals/goals-view.js");

const dates = ["2026-09-29", "2026-09-30", "2026-10-01"];
const fixture = () => ({ tasks: [{ id: "daily", title: "Daily", date: "2026-09-01", repeat: "daily", time: "08:00",
  completed: { "2026-09-28": true }, excludedDates: {}, acknowledgedOverdue: {},
  studySubjectId: "math", dueDate: "2026-10-05", dueTime: "11:30", studyFileIds: ["file"], categoryId: "health", priority: "high",
  checklist: [{ id: "step", title: "Step" }], checklistLogs: { "2026-10-01": { step: { done: true } } } }],
  taskOrder: { "2026-09-30": ["daily"] } });
const entries = dates.map((dateKey) => ({ taskId: "daily", dateKey }));
let counter = 0;
const helpers = { createId: () => `copy-${counter++}`, toDateKey: () => "2026-10-02", cleanTimeValue: (value) => value,
  taskScheduledOn: (task, date) => date >= task.date };

module.exports = [
  { name: "one current action preserves missed history, completions, ordering and future recurrence", fn() {
    const state = fixture();
    const before = JSON.stringify(state);
    const result = moveTasksToDate({ state, entries, targetDateKey: "2026-10-02", recurringMode: "single", helpers });
    assert.equal(result.consolidated, 1); assert.equal(result.moved, 3); assert.equal(state.tasks.length, 1);
    const task = state.tasks[0];
    assert.deepEqual(task.acknowledgedOverdue, Object.fromEntries(dates.map((date) => [date, true])));
    assert.deepEqual(task.excludedDates, {}); assert.deepEqual(task.completed, { "2026-09-28": true });
    assert.equal(task.time, "08:00"); assert.equal(task.repeat, "daily");
    assert.deepEqual(state.taskOrder["2026-09-30"], ["daily"]);
    assert.equal(task.acknowledgedOverdue["2026-10-03"], undefined);
    assert.equal(JSON.parse(before).tasks[0].acknowledgedOverdue[dates[0]], undefined);
  } },
  { name: "one action on a non-scheduled day carries identity without erasing source history", fn() {
    const state = fixture();
    const result = moveTasksToDate({ state, entries, targetDateKey: "2026-10-03", recurringMode: "single",
      helpers: { ...helpers, taskScheduledOn: (task, date) => date !== "2026-10-03" && date >= task.date } });
    assert.equal(result.moved, 3); assert.equal(state.tasks.length, 2);
    const copy = state.tasks[1];
    assert.equal(copy.repeat, "none"); assert.equal(copy.date, "2026-10-03");
    assert.equal(copy.studySubjectId, "math"); assert.deepEqual(copy.studyFileIds, ["file"]);
    assert.equal(copy.dueDate, "2026-10-05"); assert.equal(copy.dueTime, "11:30");
    assert.deepEqual(copy.checklistLogs[copy.date], state.tasks[0].checklistLogs["2026-10-01"]);
    assert.deepEqual(state.tasks[0].excludedDates, {});
  } },
  { name: "a completed or excluded target is not revived by consolidated backlog", fn() {
    for (const flag of ["completed", "excludedDates", "acknowledgedOverdue"]) {
      const state = fixture(); state.tasks[0][flag]["2026-10-02"] = true;
      moveTasksToDate({ state, entries, targetDateKey: "2026-10-02", recurringMode: "single", helpers });
      assert.equal(state.tasks.length, 2); assert.equal(state.tasks[0][flag]["2026-10-02"], true);
      assert.equal(state.tasks[1].time, ""); assert.deepEqual(state.tasks[1].completed, {});
    }
  } },
  { name: "consolidation in Later creates one unscheduled action and retains missed occurrences", fn() {
    const state = fixture();
    const result = moveTasksToLater({ state, entries: [...entries, entries[0]], recurringMode: "single", helpers });
    assert.equal(result.moved, 3); assert.equal(state.tasks.length, 2);
    assert.equal(state.tasks[1].date, null); assert.equal(state.tasks[1].time, "");
    assert.equal(state.tasks[1].dueDate, "2026-10-05");
    assert.deepEqual(state.tasks[0].excludedDates, {});
    assert.equal(Object.keys(state.tasks[0].acknowledgedOverdue).length, 3);
  } },
  { name: "each-occurrence mode still supports independent obligations", fn() {
    const state = fixture();
    moveTasksToDate({ state, entries, targetDateKey: "2026-10-02", recurringMode: "each", helpers });
    assert.equal(state.tasks.length, 4);
    assert.deepEqual(state.tasks.slice(1).map((task) => task.movedFromDate), dates);
    assert.deepEqual(state.tasks[0].acknowledgedOverdue, {});
  } },
  { name: "repeat choices ignore duplicates, future, done, excluded and acknowledged dates", fn() {
    const state = fixture();
    state.tasks[0].excludedDates["2026-09-27"] = true;
    state.tasks[0].acknowledgedOverdue["2026-09-26"] = true;
    const extra = ["2026-09-28", "2026-09-27", "2026-09-26", "2026-10-02", "2026-10-03"].map((dateKey) => ({ taskId: "daily", dateKey }));
    const groups = recurringBacklogGroups({ state, entries: [...entries, entries[0], ...extra], helpers });
    assert.deepEqual(groups.get("daily"), entries);
    assert.equal(recurringBacklogGroups({ state, entries: [entries[0], entries[0]], helpers }).size, 0);
  } },
  { name: "single tasks in mixed selection keep separate due dates", fn() {
    const state = fixture();
    state.tasks.push({ id: "one", date: "2026-09-29", dueDate: "2026-10-05", repeat: "none", completed: {} });
    moveTasksToDate({ state, entries: [...entries, { taskId: "one", dateKey: "2026-09-29" }], targetDateKey: "2026-10-02", recurringMode: "single", helpers });
    assert.equal(state.tasks.length, 2); assert.equal(state.tasks[1].date, "2026-10-02"); assert.equal(state.tasks[1].dueDate, "2026-10-05");
  } },
  { name: "a selected target day is not dismissed or duplicated by consolidated movement", fn() {
    const state = fixture();
    const result = moveTasksToDate({ state, entries, targetDateKey: "2026-10-01", recurringMode: "single", helpers });
    assert.equal(result.moved, 2); assert.equal(result.skipped, 1); assert.equal(state.tasks.length, 1);
    assert.equal(state.tasks[0].acknowledgedOverdue["2026-10-01"], undefined);
    assert.equal(state.tasks[0].excludedDates["2026-10-01"], undefined);
  } },
  { name: "an invalid target date leaves consolidated source history unchanged", fn() {
    const state = fixture(); const before = JSON.stringify(state);
    assert.equal(moveTasksToDate({ state, entries, targetDateKey: "2026-02-30", recurringMode: "single", helpers }).moved, 0);
    assert.equal(JSON.stringify(state), before);
  } },
  { name: "goal filters separate achieved, paused, archived and overdue goals", fn() {
    const today = "2026-10-02";
    assert.equal(goalMatchesFilter({ status: "done" }, "active", today), false);
    assert.equal(goalMatchesFilter({ status: "done" }, "done", today), true);
    assert.equal(goalMatchesFilter({ status: "active", dueDate: "2026-09-29" }, "active", today), true);
    assert.equal(goalMatchesFilter({ status: "done", paused: true }, "done", today), false);
    assert.equal(goalMatchesFilter({ status: "done", paused: true }, "paused", today), true);
    assert.equal(goalMatchesFilter({ status: "done", archived: true }, "done", today), false);
    assert.equal(goalMatchesFilter({ status: "done", archived: true }, "archived", today), true);
    assert.equal(goalMatchesFilter({ status: "done", archived: true }, "all", today), true);
  } },
];
