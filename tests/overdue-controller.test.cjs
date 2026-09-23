const assert = require("node:assert/strict");
const { createOverdueController } = require("../src/tasks/overdue-controller.js");

module.exports = [
  {
    name: "hides an acknowledged overdue occurrence without completing it",
    fn() {
      const task = { id: "seen", title: "Seen", date: "2026-07-11", repeat: "none", completed: {}, acknowledgedOverdue: { "2026-07-11": true } };
      const controller = createOverdueController({
        getCacheKey: () => "seen-state",
        getTaskDeadlineDate: (_task, dateKey) => new Date(`${dateKey}T23:59:59`),
        getTasks: () => [task],
        isAcknowledged: (item, dateKey) => item.acknowledgedOverdue?.[dateKey] === true,
        isTaskDone: () => false,
        isTaskExcluded: () => false,
        taskScheduledOn: () => true,
        toDateKey: (date) => date.toISOString().slice(0, 10),
      });
      assert.equal(controller.list(new Date("2026-07-12T12:00:00")).length, 0);
      assert.deepEqual(task.completed, {});
    },
  },
  {
    name: "reuses yesterday calculations until state or day changes",
    fn() {
      let taskReads = 0;
      const controller = createOverdueController({
        getCacheKey: () => "state-1",
        getTaskDeadlineDate: () => new Date("2026-01-01T23:59:59"),
        getTasks: () => { taskReads += 1; return [{ id: "old", title: "Old", date: "2026-01-01", repeat: "none", completed: {} }]; },
        isTaskDone: () => false,
        isTaskExcluded: () => false,
        taskScheduledOn: () => true,
        toDateKey: (date) => date.toISOString().slice(0, 10),
      });
      const now = new Date("2026-07-12T12:00:10Z");
      controller.list(now);
      controller.list(new Date("2026-07-12T12:00:40Z"));
      assert.equal(taskReads, 1);
    },
  },
  {
    name: "shows only tasks from the previous calendar day",
    fn() {
      const tasks = [
        { id: "yesterday", title: "Yesterday", date: "2026-07-10", time: "", repeat: "none", completed: {} },
        { id: "old", title: "Old", date: "2026-01-01", time: "", repeat: "none", completed: {} },
      ];
      const controller = createOverdueController({
        getTaskDeadlineDate: (_task, dateKey) => new Date(`${dateKey}T23:59:59`),
        getTasks: () => tasks,
        isTaskDone: () => false,
        isTaskExcluded: () => false,
        taskScheduledOn: () => true,
        toDateKey: (date) => date.toISOString().slice(0, 10),
      });
      const entries = controller.list(new Date("2026-07-11T12:00:00"));
      assert.deepEqual(entries.map((entry) => entry.task.id), ["yesterday"]);
    },
  },
];
