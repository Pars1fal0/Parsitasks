const assert = require("node:assert/strict");
const { appendSubtask, removeSubtask } = require("../app/src/tasks/task-subtasks.js");
const checklist = require("../app/src/tasks/task-checklist.js");
function fixture(repeat = "none") {
  let id = 0;
  const task = { id: "parent", title: "Подготовить проект", date: "2026-10-02", repeat, dueDate: "", checklist: [{ id: "old", title: "Первый шаг" }], checklistLogs: { "2026-10-02": { old: { done: true, updatedAt: "2026-10-02T10:00:00Z" } } }, completed: { "2026-10-02": true }, studySubjectId: "math", sourceNoteId: "note" };
  return { task, state: { tasks: [task], taskOrder: {} }, createId: () => `new-${++id}`, dateKey: "2026-10-04", title: "  Второй   шаг  " };
}
module.exports = [
  { name: "deleting a subtask removes its own marks without completing or deleting the parent", fn() {
    const args = fixture(); args.task.checklist.push({ id: "keep", title: "Оставить" });
    args.task.checklistLogs["2026-10-02"].keep = { done: true, updatedAt: "2026-10-02T10:00:00Z" };
    const saved = removeSubtask({ ...args, itemId: "old" });
    assert.deepEqual(saved.checklist.map((item) => item.id), ["keep"]);
    assert.equal(saved.checklistLogs["2026-10-02"].old, undefined);
    assert.equal(saved.checklistLogs["2026-10-02"].keep.done, true);
    assert.equal(saved.completed["2026-10-02"], true); assert.equal(args.state.tasks.length, 1);
    removeSubtask({ ...args, itemId: "keep" }); assert.deepEqual(args.task.checklist, []);
  } },
  { name: "deleting from one recurring occurrence keeps the original checklist and history", fn() {
    const args = fixture("daily"); args.task.checklistLogs[args.dateKey] = { old: { done: true, updatedAt: "2026-10-04T10:00:00Z" } };
    const saved = removeSubtask({ ...args, itemId: "old" });
    assert.equal(saved.repeat, "none"); assert.equal(saved.sourceTaskId, "parent");
    assert.deepEqual(saved.checklist, []); assert.equal(saved.checklistLogs[args.dateKey].old, undefined);
    assert.equal(args.task.checklist.length, 1); assert.equal(args.task.checklistLogs["2026-10-02"].old.done, true);
    assert.equal(args.task.checklistLogs[args.dateKey].old.done, true);
  } },
  { name: "deleting from future recurring occurrences preserves past series and other progress", fn() {
    const args = fixture("daily"); args.task.checklist.push({ id: "keep", title: "Оставить" });
    args.task.checklistLogs["2026-10-05"] = { old: { done: true, updatedAt: "2026-10-05T10:00:00Z" }, keep: { done: true, updatedAt: "2026-10-05T10:00:00Z" } };
    const saved = removeSubtask({ ...args, itemId: "old", scope: "following" });
    assert.equal(args.task.repeatUntil, "2026-10-03"); assert.equal(args.task.checklist.length, 2);
    assert.equal(args.task.checklistLogs["2026-10-02"].old.done, true);
    assert.deepEqual(saved.checklist.map((item) => item.id), ["keep"]);
    assert.equal(saved.checklistLogs["2026-10-05"].old, undefined);
    assert.equal(saved.checklistLogs["2026-10-05"].keep.done, true);
  } },
  { name: "missing subtasks and invalid deletion scope cannot mutate data", fn() {
    const args = fixture("daily"); const before = JSON.stringify(args.state);
    assert.throws(() => removeSubtask({ ...args, itemId: "missing" }), /недоступна/);
    assert.throws(() => removeSubtask({ ...args, itemId: "old", scope: "all" }), /область/);
    assert.equal(JSON.stringify(args.state), before);
    args.state.tasks = []; assert.throws(() => removeSubtask({ ...args, itemId: "old" }), /недоступна/);
  } },
  { name: "subtasks reuse checklist data without independent tasks or automatic parent completion", fn() {
    const args = fixture(); const saved = appendSubtask(args);
    assert.equal(args.state.tasks.length, 1); assert.equal(saved.checklist[1].title, "Второй шаг");
    assert.equal(saved.completed["2026-10-02"], true); assert.equal(saved.studySubjectId, "math");
    assert.equal(saved.sourceNoteId, "note"); assert.equal(checklist.progress(saved, "2026-10-02").done, 1);
  } },
  { name: "a subtask for one recurring occurrence preserves past and future series", fn() {
    const args = fixture("daily"); const saved = appendSubtask(args);
    assert.equal(saved.date, args.dateKey); assert.equal(saved.repeat, "none"); assert.equal(saved.sourceTaskId, "parent");
    assert.equal(saved.checklist.length, 2); assert.equal(args.task.checklist.length, 1);
    assert.equal(args.task.excludedDates[args.dateKey], true); assert.equal(args.task.completed["2026-10-02"], true);
    assert.equal(args.task.checklistLogs["2026-10-02"].old.done, true);
  } },
  { name: "deferred subtasks keep a stable progress date and carry it when scheduled", fn() {
    const args = fixture(); args.task.date = null; args.task.completed = {};
    const saved = appendSubtask(args);
    assert.equal(saved.deferredFromDate, args.dateKey);
    checklist.setDone(saved, args.dateKey, saved.checklist[1].id, true);
    require("../app/src/tasks/task-moves.js").moveSingleTask(args.state, saved, null, "2026-10-09");
    assert.equal(checklist.progress(saved, "2026-10-09").done, 1);
    assert.equal(saved.deferredFromDate, "");
  } },
  { name: "future recurring subtasks split the series without rewriting past progress", fn() {
    const args = fixture("daily"); args.task.repeatUntil = "2026-11-01";
    args.task.checklistLogs["2026-10-05"] = { old: { done: true, updatedAt: "2026-10-05T10:00:00Z" } };
    const saved = appendSubtask({ ...args, scope: "following" });
    assert.equal(args.task.repeatUntil, "2026-10-03"); assert.equal(args.task.checklist.length, 1);
    assert.equal(saved.date, args.dateKey); assert.equal(saved.repeatUntil, "2026-11-01");
    assert.equal(saved.checklist.length, 2); assert.equal(saved.checklistLogs["2026-10-05"].old.done, true);
    assert.equal(saved.checklistLogs["2026-10-02"], undefined);
  } },
  { name: "empty, oversized, missing and full subtask parents are rejected without data changes", fn() {
    for (const title of [" ", "x".repeat(121)]) {
      const args = fixture(); const before = JSON.stringify(args.state);
      assert.throws(() => appendSubtask({ ...args, title })); assert.equal(JSON.stringify(args.state), before);
    }
    const args = fixture(); args.task.checklist = Array.from({ length: 50 }, (_, index) => ({ id: String(index), title: "Шаг" }));
    const before = JSON.stringify(args.state); assert.throws(() => appendSubtask(args), /50/); assert.equal(JSON.stringify(args.state), before);
    args.state.tasks = []; assert.throws(() => appendSubtask(args), /недоступна/);
  } },
];
