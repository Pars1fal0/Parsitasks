const assert = require("node:assert/strict");
const { createStateNormalizer, recurrence, taskMoves } = require("./test-utils.cjs");
const { mergeStates } = require("../app/src/core/state-merge.js");
const { taskEmptyState } = require("../app/src/tasks/tasks-view.js");
require("../app/src/tasks/task-checklist.js");

const stamp = "2026-09-30T12:00:00.000Z";
const task = (id, date, repeat = "none") => ({ id, title: id, date, repeat, completed: {}, excludedDates: {}, updatedAt: stamp });
const helpers = { taskScheduledOn: recurrence.taskScheduledOn, createId: () => "replacement", toDateKey: () => "2026-10-01" };

module.exports = [
  { name: "undated tasks round trip without migrating legacy missing dates", fn() {
    const normalizer = createStateNormalizer();
    const state = normalizer.normalizeState({ tasks: [
      { ...task("later", null, "daily"), time: "09:00", reminderOffset: "15", deferredFromDate: "2026-09-29",
        checklist: [{ id: "step", title: "First" }], checklistLogs: { "2026-09-29": { step: { done: true, updatedAt: stamp } } } },
      { id: "legacy", title: "Legacy" },
    ] });
    const restored = normalizer.normalizeState(JSON.parse(JSON.stringify(state)));
    assert.equal(restored.tasks[0].date, null);
    assert.equal(restored.tasks[0].repeat, "none");
    assert.equal(restored.tasks[0].time, "");
    assert.equal(restored.tasks[0].reminderOffset, "none");
    assert.equal(restored.tasks[0].checklistLogs["2026-09-29"].step.done, true);
    assert.equal(restored.tasks[1].date, "2026-06-26");
    assert.equal(recurrence.taskScheduledOn(restored.tasks[0], "2026-09-30"), false);
  } },
  { name: "batch date moves deduplicate entries and preserve parked checklist progress", fn() {
    const parked = { ...task("later", null), deferredFromDate: "2026-09-29",
      checklistLogs: { "2026-09-29": { step: { done: true, updatedAt: stamp } } } };
    const completed = { ...task("done", "2026-09-30"), completed: { "2026-09-30": true } };
    const state = { tasks: [parked, completed], taskOrder: { "2026-09-30": ["done"] } };
    assert.deepEqual(taskMoves.moveTasksToDate({ state, targetDateKey: "2026-10-01", helpers, entries: [
      { taskId: "later", dateKey: null }, { taskId: "later", dateKey: null },
      { taskId: "done", dateKey: "2026-09-30" }, { taskId: "missing", dateKey: null },
    ] }), { moved: 2, skipped: 2 });
    assert.equal(parked.date, "2026-10-01");
    assert.equal(parked.deferredFromDate, "");
    assert.equal(parked.checklistLogs["2026-10-01"].step.done, true);
    assert.equal(parked.checklistLogs["2026-09-29"], undefined);
    assert.equal(completed.completed["2026-10-01"], true);
    assert.deepEqual(state.taskOrder["2026-09-30"], []);
  } },
  { name: "batch moves reject impossible calendar dates without mutation", fn() {
    const state = { tasks: [task("later", null)], taskOrder: {} };
    const before = JSON.stringify(state);
    for (const date of ["2026-02-29", "2026-13-01", "invalid"]) {
      assert.deepEqual(taskMoves.moveTasksToDate({ state, entries: [{ taskId: "later", dateKey: null }], targetDateKey: date, helpers }), { moved: 0, skipped: 1 });
      assert.equal(JSON.stringify(state), before);
    }
    assert.equal(taskMoves.moveTasksToDate({ state, entries: [{ taskId: "later", dateKey: null }], targetDateKey: "2028-02-29", helpers }).moved, 1);
  } },
  { name: "batch moves preserve completion for natural and replacement recurring occurrences", fn() {
    for (const repeat of ["daily", "weekly"]) {
      const recurring = { ...task("series", "2026-09-30", repeat), completed: { "2026-09-30": true },
        checklistLogs: { "2026-09-30": { step: { done: true, updatedAt: stamp } } } };
      const state = { tasks: [recurring], taskOrder: {} };
      assert.equal(taskMoves.moveTasksToDate({ state, entries: [{ taskId: "series", dateKey: "2026-09-30" }], targetDateKey: "2026-10-01", helpers }).moved, 1);
      const moved = repeat === "daily" ? recurring : state.tasks[1];
      assert.equal(moved.completed["2026-10-01"], true);
      assert.equal(moved.checklistLogs["2026-10-01"].step.done, true);
      assert.equal(recurring.excludedDates["2026-09-30"], true);
      assert.equal(recurring.repeat, repeat);
    }
  } },
  { name: "newer undated state survives a stale device while independent title changes merge", fn() {
    const old = "2026-09-29T12:00:00.000Z";
    const local = { tasks: [{ ...task("shared", null), deferredFromDate: "2026-09-29" }],
      syncMeta: { entityFields: { tasks: { shared: { date: stamp, deferredFromDate: stamp, title: old } } } } };
    const remote = { tasks: [{ ...task("shared", "2026-09-29"), title: "Remote title", updatedAt: stamp }],
      syncMeta: { entityFields: { tasks: { shared: { date: old, title: stamp } } } } };
    const result = mergeStates(local, remote).tasks[0];
    assert.equal(result.date, null);
    assert.equal(result.deferredFromDate, "2026-09-29");
    assert.equal(result.title, "Remote title");
  } },
  { name: "empty task messages distinguish a day, completed work and filter results", fn() {
    assert.equal(taskEmptyState().message, "На этот день задач нет");
    assert.equal(taskEmptyState({ total: 3, done: 3, visible: 3 }).message, "Все задачи выполнены");
    assert.equal(taskEmptyState({ total: 3, done: 3, filtered: true, filter: "open", statusOnly: true }).message, "Все задачи выполнены");
    const filtered = taskEmptyState({ total: 3, done: 3, filtered: true, filter: "open" });
    assert.equal(filtered.message, "По этим фильтрам ничего не найдено");
    assert.equal(filtered.reset, true);
    assert.equal(taskEmptyState({ total: 3, done: 2, visible: 3 }).visible, false);
  } },
  { name: "MCP skips undated tasks in daily totals and can edit, schedule and delete them", async fn() {
    const service = await import("../mcp/task-service.mjs");
    const writes = await import("../mcp/write-service.mjs");
    const state = service.createEmptyState();
    state.tasks.push({ ...task("later", null), deferredFromDate: "2026-09-29",
      checklistLogs: { "2026-09-29": { step: { done: true, updatedAt: stamp } } } });
    assert.equal(service.taskScheduledOn(state.tasks[0], "2026-09-30"), false);
    assert.equal(service.getTodayOverview(state, "2026-09-30").tasks.length, 0);
    const renamed = writes.updateTaskCommand(state, { requestId: "later-rename", taskId: "later", title: "Renamed" }, { now: stamp });
    assert.equal(renamed.task.date, null);
    assert.equal(renamed.task.title, "Renamed");
    assert.throws(() => writes.updateTaskCommand(state, { requestId: "later-time", taskId: "later", time: "12:00" }), /Сначала назначь дату/);
    const scheduled = writes.updateTaskCommand(renamed.state, { requestId: "later-schedule", taskId: "later", date: "2026-10-01" }, { now: stamp });
    assert.equal(scheduled.task.checklistLogs["2026-10-01"].step.done, true);
    assert.equal(scheduled.task.deferredFromDate, "");
    const deleted = writes.deleteTaskCommand(state, { requestId: "later-delete", taskId: "later", confirm: true }, { now: stamp });
    assert.equal(deleted.state.tasks.length, 0);
    assert.equal(state.tasks[0].date, null);
  } },
];
