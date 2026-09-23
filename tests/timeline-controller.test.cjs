const assert = require("node:assert/strict");
const { createTimelineController } = require("../app/src/timeline/timeline-controller.js");

function createHarness(ctxOverrides = {}) {
  const state = {
    taskOrder: {
      "2026-07-02": ["task-1"],
    },
    tasks: [
      {
        id: "task-1",
        title: "Timeline task",
        date: "2026-07-02",
        time: "10:00",
        categoryId: "",
        priority: "medium",
        repeat: "none",
        reminderOffset: "none",
        completed: {},
        excludedDates: {},
        notified: { "2026-07-02": true },
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  };
  const calls = {
    render: 0,
    save: 0,
    toasts: [],
  };
  const messages = {
    active: "active",
    blockUpdated: "block updated",
    copySuffix: "copy",
    deleted: "deleted",
    done: "done",
    duplicated: "duplicated",
    movedTo: "moved to",
    timeUpdated: "time updated",
  };
  const ctx = {
    cleanTimeValue: (value) => value,
    createId: () => "task-copy",
    createUndoSnapshot: () => ({ state: "before" }),
    deleteTask(taskId) {
      state.tasks = state.tasks.filter((task) => task.id !== taskId);
      Object.keys(state.taskOrder).forEach((dateKey) => {
        state.taskOrder[dateKey] = state.taskOrder[dateKey].filter((id) => id !== taskId);
      });
    },
    els: {},
    findTask: (id) => state.tasks.find((task) => task.id === id),
    formatTaskWindow: (task) => `${task.startTime}-${task.endTime}`,
    formatLongDate: (value) => value,
    formatTime: (value) => value,
    getActiveDate: () => "2026-07-02",
    getOrderedTasksForDate: (dateKey) => {
      const order = state.taskOrder[dateKey] || [];
      return [...state.tasks].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    },
    getState: () => state,
    isTaskDone: (task, dateKey) => task.completed?.[dateKey] === true,
    isTimeBlock: (task) => task.scheduleMode === "block",
    isValidTimeBlock: (start, end) => start < end,
    messages,
    minutesToTime: (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
    render: () => {
      calls.render += 1;
    },
    saveState: () => {
      calls.save += 1;
    },
    showToast: (message, options) => {
      calls.toasts.push({ message, options });
    },
    taskSortTime: (task) => task.time,
    timeToMinutes: (value) => {
      const [hours, minutes] = value.split(":").map(Number);
      return hours * 60 + minutes;
    },
  };
  Object.assign(ctx, ctxOverrides);

  return {
    calls,
    controller: createTimelineController(ctx),
    state,
  };
}

module.exports = [
  {
    name: "duplicates only one occurrence when selected for a recurring task",
    async fn() {
      const { controller, state } = createHarness({ confirmAction: async () => "secondary" });
      state.tasks[0].repeat = "daily";
      const duplicate = await controller.duplicateTask("task-1");
      assert.equal(duplicate.repeat, "none");
      assert.equal(duplicate.date, "2026-07-02");
    },
  },
  {
    name: "duplicates the whole recurring series only after explicit choice",
    async fn() {
      const { controller, state } = createHarness({ confirmAction: async () => true });
      state.tasks[0].repeat = "daily";
      state.tasks[0].date = "2026-06-01";
      const duplicate = await controller.duplicateTask("task-1");
      assert.equal(duplicate.repeat, "daily");
      assert.equal(duplicate.date, "2026-06-01");
    },
  },
  {
    name: "turns an unscheduled timeline drop into a resizable one-hour block",
    fn() {
      const { controller, state } = createHarness();
      const task = state.tasks[0];
      task.time = "";
      task.priority = "high";

      assert.equal(controller.moveTaskTime(task.id, "14:15"), true);

      assert.equal(task.scheduleMode, "block");
      assert.equal(task.startTime, "14:15");
      assert.equal(task.endTime, "15:15");
      assert.equal(task.time, "15:15");
      assert.equal(task.priority, "high");
    },
  },
  {
    name: "returns a time block to a no-time task",
    fn() {
      const { controller, state } = createHarness();
      const task = state.tasks[0];
      task.scheduleMode = "block";
      task.startTime = "14:00";
      task.endTime = "15:00";
      task.time = "15:00";
      task.reminderOffset = "15";
      task.priority = "high";

      assert.equal(controller.clearTaskTime(task.id), true);

      assert.equal(task.scheduleMode, "none");
      assert.equal(task.startTime, "");
      assert.equal(task.endTime, "");
      assert.equal(task.time, "");
      assert.equal(task.reminderOffset, "none");
      assert.equal(task.priority, "high");
    },
  },
  {
    name: "can remove time from only one recurring timeline occurrence",
    async fn() {
      const { controller, state } = createHarness({ confirmAction: async () => "secondary" });
      const task = state.tasks[0];
      task.repeat = "daily";
      task.scheduleMode = "block";
      task.startTime = "14:00";
      task.endTime = "15:00";
      task.time = "15:00";
      task.priority = "high";

      assert.equal(await controller.clearTaskTime(task.id), true);

      const occurrence = state.tasks.find((item) => item.sourceTaskId === task.id);
      assert.equal(task.excludedDates["2026-07-02"], true);
      assert.equal(occurrence.scheduleMode, "none");
      assert.equal(occurrence.time, "");
      assert.equal(occurrence.priority, "high");
    },
  },
  {
    name: "toggles a timeline task done with undo toast",
    fn() {
      const { calls, controller, state } = createHarness();

      assert.equal(controller.toggleTaskDone("task-1"), true);

      assert.equal(state.tasks[0].completed["2026-07-02"], true);
      assert.equal(calls.save, 1);
      assert.equal(calls.render, 1);
      assert.equal(calls.toasts[0].message, "done");
      assert.deepEqual(calls.toasts[0].options.undo, { state: "before" });
    },
  },
  {
    name: "duplicates a timeline task next to the source",
    fn() {
      const { calls, controller, state } = createHarness();

      const duplicate = controller.duplicateTask("task-1");

      assert.equal(duplicate.id, "task-copy");
      assert.equal(duplicate.title, "Timeline task copy");
      assert.equal(duplicate.date, "2026-07-02");
      assert.deepEqual(duplicate.completed, {});
      assert.deepEqual(duplicate.notified, {});
      assert.deepEqual(state.taskOrder["2026-07-02"], ["task-1", "task-copy"]);
      assert.equal(calls.toasts[0].message, "duplicated");
    },
  },
  {
    name: "deletes a timeline task from tasks and order",
    fn() {
      const { calls, controller, state } = createHarness();

      assert.equal(controller.deleteTask("task-1"), true);

      assert.deepEqual(state.tasks, []);
      assert.deepEqual(state.taskOrder["2026-07-02"], []);
      assert.equal(calls.save, 1);
      assert.equal(calls.render, 1);
      assert.equal(calls.toasts[0].message, "deleted");
    },
  },
];
