const assert = require("node:assert/strict");
const { recurrence, taskMoves, toDateKey } = require("./test-utils.cjs");

function fixture() {
  return { tasks: [{ id: "weekly", title: "Prepare lab", date: "2026-09-28", repeat: "weekly", time: "10:00",
    studySubjectId: "physics", studyDetails: "Chapter 2", studyAssignedDate: "2026-09-27", studyFileIds: ["worksheet"],
    sourceNoteId: "note", dueDate: "2026-10-06", dueTime: "11:30", dueReminderOffset: "15",
    checklist: [{ id: "read", title: "Read" }], checklistLogs: { "2026-09-28": { read: true } },
    completed: {}, excludedDates: {}, notified: {} }], taskOrder: {} };
}
const helpers = { taskScheduledOn: recurrence.taskScheduledOn, toDateKey, createId: () => "copy" };

module.exports = [
  {
    name: "one-off recurring move keeps subject, material, note, deadline and checklist identity",
    fn() {
      const state = fixture();
      const source = state.tasks[0];
      taskMoves.postponeTask({ state, task: source, sourceDateKey: "2026-09-28", targetDateKey: "2026-09-29", helpers });
      const moved = state.tasks[1];
      for (const key of ["studySubjectId", "studyDetails", "studyAssignedDate", "studyFileIds", "sourceNoteId", "dueDate", "dueTime", "dueReminderOffset", "checklist"]) {
        assert.deepEqual(moved[key], source[key], key);
      }
      assert.deepEqual(moved.checklistLogs["2026-09-29"], { read: true });
      moved.studyFileIds.push("new");
      moved.checklist[0].title = "Changed";
      assert.deepEqual(source.studyFileIds, ["worksheet"]);
      assert.equal(source.checklist[0].title, "Read");
    },
  },
  {
    name: "moving a missed repeat to an already completed day keeps a separate unfinished obligation",
    fn() {
      const state = fixture();
      const source = state.tasks[0];
      source.completed["2026-10-05"] = true;
      taskMoves.postponeTask({ state, task: source, sourceDateKey: "2026-09-28", targetDateKey: "2026-10-05", helpers });
      assert.equal(state.tasks.length, 2);
      assert.equal(source.completed["2026-10-05"], true);
      assert.notEqual(source.excludedDates["2026-10-05"], true);
      assert.deepEqual(state.tasks[1].completed, {});
    },
  },
];
