const assert = require("node:assert/strict");
const checklist = require("../app/src/tasks/task-checklist.js");
const moves = require("../app/src/tasks/task-moves.js");
const { mergeStates } = require("../app/src/core/state-merge.js");
module.exports = [
  { name: "state sync combines checklist progress without clobbering task fields", fn() {
    const task = { id: "t", title: "Old", checklist: [{ id: "a", title: "First" }, { id: "b", title: "Second" }] };
    const local = { tasks: [{ ...task, checklistLogs: { "2026-09-30": { a: { done: true, updatedAt: "2026-09-30T10:00:00Z" } } } }] };
    const remote = { tasks: [{ ...task, title: "New", updatedAt: "2026-09-30T11:00:00Z",
      checklistLogs: { "2026-09-30": { b: { done: true, updatedAt: "2026-09-30T11:00:00Z" } } } }] };
    const merged = mergeStates(local, remote).tasks[0];
    assert.equal(merged.title, "New");
    assert.deepEqual(checklist.progress(merged, "2026-09-30"), { done: 2, total: 2 });
  } },
  { name: "checklist normalization keeps identities, removes invalid entries and isolates occurrences", fn() {
    const items = checklist.normalizeItems([{ id: "a", title: " First " }, { id: "a", title: "Duplicate" }, { id: "b", title: "" }]);
    assert.deepEqual(items, [{ id: "a", title: "First" }]);
    const task = { checklist: items, completed: {} };
    checklist.setDone(task, "2026-09-30", "a", true);
    assert.deepEqual(checklist.progress(task, "2026-09-30"), { done: 1, total: 1 });
    assert.equal(checklist.progress(task, "2026-10-01").done, 0);
    assert.equal(task.completed["2026-09-30"], undefined);
    assert.equal(checklist.setDone(task, "2026-09-30", "missing", true), false);
    assert.deepEqual(checklist.normalizeLogs({ "2026-02-30": { a: { done: true, updatedAt: "2026-09-30T00:00:00Z" } } }), {});
  } },
  { name: "checklist merges independent items and dates, preserving explicit unchecks", fn() {
    const older = "2026-09-30T10:00:00Z"; const newer = "2026-09-30T11:00:00Z";
    const merged = checklist.mergeLogs({ "2026-09-30": { a: { done: true, updatedAt: older }, b: { done: true, updatedAt: newer } } },
      { "2026-09-30": { a: { done: false, updatedAt: newer } }, "2026-10-01": { a: { done: true, updatedAt: newer } } });
    assert.equal(merged["2026-09-30"].a.done, false);
    assert.equal(merged["2026-09-30"].b.done, true);
    assert.equal(merged["2026-10-01"].a.done, true);
  } },
  { name: "moving a task carries checklist progress and splits preserve future occurrence logs", fn() {
    const task = { id: "t", date: "2026-09-30", repeat: "none", checklist: [{ id: "a", title: "First" }], completed: {} };
    checklist.setDone(task, task.date, "a", true);
    moves.moveSingleTask({ taskOrder: {} }, task, "2026-09-30", "2026-10-01");
    assert.equal(checklist.progress(task, "2026-10-01").done, 1);
    assert.equal(checklist.progress(task, "2026-09-30").done, 0);
    task.repeat = "daily";
    const state = { tasks: [task], taskOrder: {} };
    checklist.setDone(task, "2026-10-03", "a", true);
    const next = moves.updateRecurringTaskDetails({ state, task, dateKey: "2026-10-03", editedTask: task, scope: "following", helpers: { createId: () => "next" } });
    assert.equal(checklist.progress(next, "2026-10-03").done, 1);
    assert.equal(next.checklist[0].id, "a");
  } },
];
