const assert = require("node:assert/strict");
const { createTaskState } = require("../app/src/tasks/task-state.js");

module.exports = [
  {
    name: "restores a source occurrence when deleting its moved replacement",
    fn() {
      const state = {
        goals: [], habits: [], taskOrder: {},
        tasks: [
          { id: "series", excludedDates: { "2026-07-12": true } },
          { id: "replacement", sourceTaskId: "series", date: "2026-07-12" },
        ],
      };
      createTaskState({ getState: () => state }).deleteMovedReplacement("replacement", { restoreSourceOccurrence: true });
      assert.equal(state.tasks.length, 1);
      assert.equal(state.tasks[0].excludedDates["2026-07-12"], undefined);
      assert.ok(state.tasks[0].updatedAt);
      assert.ok(state.tombstones.tasks.replacement);
    },
  },
  {
    name: "removes a deleted task from task orders",
    fn() {
      const state = {
        goals: [],
        habits: [],
        tasks: [{ id: "task-1" }, { id: "task-2" }],
        taskOrder: { "2026-07-11": ["task-1", "task-2"] },
      };
      const result = createTaskState({ getState: () => state }).deleteTask("task-1");
      assert.deepEqual(state.tasks.map((task) => task.id), ["task-2"]);
      assert.deepEqual(state.taskOrder["2026-07-11"], ["task-2"]);
      assert.ok(state.tombstones.tasks["task-1"]);
      assert.equal(result, undefined);
    },
  },
];
