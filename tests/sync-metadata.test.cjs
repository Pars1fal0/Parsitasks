const assert = require("node:assert/strict");
const { createSyncMetadataTracker, normalizeSyncMeta } = require("../app/src/sync/sync-metadata.js");

module.exports = [
  {
    name: "records explicit task flag and habit log removals",
    fn() {
      const tracker = createSyncMetadataTracker({ now: () => "2026-07-13T12:00:00.000Z" });
      const previous = {
        tasks: [{ id: "task", completed: { "2026-07-12": true } }],
        habits: [{ id: "habit", logs: { "2026-07-12": 3 } }],
      };
      const next = {
        tasks: [{ id: "task", completed: {} }],
        habits: [{ id: "habit", logs: {} }],
      };

      tracker.trackChanges(previous, next);

      assert.equal(next.syncMeta.taskFields.task.completed["2026-07-12"], "2026-07-13T12:00:00.000Z");
      assert.equal(next.syncMeta.habitLogs.habit["2026-07-12"], "2026-07-13T12:00:00.000Z");
    },
  },
  {
    name: "records task, habit, and goal checkpoint ordering separately",
    fn() {
      const tracker = createSyncMetadataTracker({ now: () => "2026-07-13T13:00:00.000Z" });
      const previous = {
        taskOrder: { "2026-07-13": ["a", "b"] },
        habits: [{ id: "h1" }, { id: "h2" }],
        goals: [{ id: "g", steps: [{ id: "s1", title: "One" }, { id: "s2", title: "Two" }] }],
      };
      const next = {
        taskOrder: { "2026-07-13": ["b", "a"] },
        habits: [{ id: "h2" }, { id: "h1" }],
        goals: [{ id: "g", steps: [{ id: "s2", title: "Two" }, { id: "s1", title: "One" }] }],
      };

      tracker.trackChanges(previous, next);

      assert.equal(next.syncMeta.taskOrder["2026-07-13"], "2026-07-13T13:00:00.000Z");
      assert.equal(next.syncMeta.habitOrderUpdatedAt, "2026-07-13T13:00:00.000Z");
      assert.equal(next.syncMeta.goalStepOrder.g, "2026-07-13T13:00:00.000Z");
    },
  },
  {
    name: "records independent entity field edits",
    fn() {
      const tracker = createSyncMetadataTracker({ now: () => "2026-07-13T14:00:00.000Z" });
      const previous = {
        tasks: [{ id: "task", title: "Old", priority: "low" }],
        habits: [],
        goals: [{ id: "goal", title: "Goal", dueDate: "2026-08-01" }],
        boardItems: [{ id: "board", type: "text", groupId: "", locked: false }],
        journalEntries: [{ id: "journal", date: "2026-07-13", text: "Old" }],
        categories: [{ id: "category", name: "Work", color: "#111111" }],
      };
      const next = {
        tasks: [{ id: "task", title: "New", priority: "low" }],
        habits: [],
        goals: [{ id: "goal", title: "Goal", dueDate: "2026-08-15" }],
        boardItems: [{ id: "board", type: "text", groupId: "group-1", locked: true }],
        journalEntries: [{ id: "journal", date: "2026-07-13", text: "New" }],
        categories: [{ id: "category", name: "Work", color: "#222222" }],
      };

      tracker.trackChanges(previous, next);

      assert.equal(next.syncMeta.entityFields.tasks.task.title, "2026-07-13T14:00:00.000Z");
      assert.equal(next.syncMeta.entityFields.tasks.task.priority, undefined);
      assert.equal(next.syncMeta.entityFields.goals.goal.dueDate, "2026-07-13T14:00:00.000Z");
      assert.equal(next.syncMeta.entityFields.boardItems.board.groupId, "2026-07-13T14:00:00.000Z");
      assert.equal(next.syncMeta.entityFields.boardItems.board.locked, "2026-07-13T14:00:00.000Z");
      assert.equal(next.syncMeta.entityFields.journalEntries.journal.text, "2026-07-13T14:00:00.000Z");
      assert.equal(next.syncMeta.entityFields.categories.category.color, "2026-07-13T14:00:00.000Z");
    },
  },
  {
    name: "drops malformed synchronization metadata",
    fn() {
      assert.deepEqual(normalizeSyncMeta({ habitLogs: { habit: { bad: "yesterday" } } }).habitLogs, {});
      assert.deepEqual(normalizeSyncMeta({ entityFields: { tasks: { task: { title: "yesterday" } } } }).entityFields.tasks, {});
    },
  },
];
