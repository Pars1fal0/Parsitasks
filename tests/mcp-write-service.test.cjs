const assert = require("node:assert/strict");

async function loadServices() {
  const [taskService, writeService, activityService] = await Promise.all([
    import("../mcp/task-service.mjs"),
    import("../mcp/write-service.mjs"),
    import("../mcp/activity-service.mjs"),
  ]);
  return { taskService, writeService, activityService };
}

function recurringTask() {
  return {
    id: "daily-sql",
    title: "Решить 10 задач SQL",
    date: "2026-07-10",
    time: "",
    scheduleMode: "none",
    startTime: "",
    endTime: "",
    categoryId: "",
    priority: "high",
    repeat: "daily",
    repeatUntil: "",
    customRepeat: {},
    reminderOffset: "none",
    completed: {},
    acknowledgedOverdue: {},
    excludedDates: {},
    notified: {},
    createdAt: "2026-07-10T08:00:00.000Z",
    updatedAt: "2026-07-10T08:00:00.000Z",
  };
}

module.exports = [
  {
    name: "MCP habit values advance a linked goal only on scheduled days",
    async fn() {
      const { taskService, writeService } = await loadServices();
      const state = taskService.createEmptyState();
      state.habits.push({
        id: "goal-habit", title: "Чтение", type: "check", repeat: "weekly", startDate: "2026-07-20",
        logs: {}, configHistory: [], availabilityHistory: [], archived: false,
      });
      state.goals.push({
        id: "goal-1", title: "Читать", dueDate: "2026-08-01", status: "active", completedAt: "",
        steps: [], linkedTaskIds: [], habitTargets: [{ habitId: "goal-habit", targetCount: 1, startDate: "2026-07-20" }],
      });
      const offDay = writeService.setHabitValueCommand(state, {
        requestId: "goal-habit-off-day", habitId: "goal-habit", date: "2026-07-21", value: true,
      }, { today: "2026-07-21", now: "2026-07-21T12:00:00.000Z" });
      assert.equal(offDay.state.goals[0].status, "active");
      const scheduledDay = writeService.setHabitValueCommand(offDay.state, {
        requestId: "goal-habit-scheduled-day", habitId: "goal-habit", date: "2026-07-20", value: true,
      }, { today: "2026-07-21", now: "2026-07-21T13:00:00.000Z" });
      assert.equal(scheduledDay.state.goals[0].status, "done");
    },
  },
  {
    name: "MCP edits only one recurring task occurrence and preserves its priority",
    async fn() {
      const { taskService, writeService } = await loadServices();
      const state = taskService.createEmptyState();
      state.tasks.push(recurringTask());
      const result = writeService.updateTaskCommand(state, {
        requestId: "update-occurrence-1",
        taskId: "task:daily-sql",
        occurrenceDate: "2026-07-20",
        scope: "occurrence",
        scheduleMode: "block",
        startTime: "14:00",
        endTime: "14:30",
      }, { now: "2026-07-19T12:00:00.000Z" });

      const original = result.state.tasks.find((task) => task.id === "daily-sql");
      assert.equal(original.excludedDates["2026-07-20"], true);
      assert.equal(result.task.repeat, "none");
      assert.equal(result.task.date, "2026-07-20");
      assert.equal(result.task.priority, "high");
      assert.equal(result.task.startTime, "14:00");
      assert.equal(result.activity.status, "applied");
    },
  },
  {
    name: "MCP recurring task edits are idempotent when a request is retried",
    async fn() {
      const { taskService, writeService } = await loadServices();
      const state = taskService.createEmptyState();
      state.tasks.push(recurringTask());
      const input = {
        requestId: "update-occurrence-retry",
        taskId: "daily-sql",
        occurrenceDate: "2026-07-20",
        scope: "occurrence",
        title: "SQL practice",
      };
      const first = writeService.updateTaskCommand(state, input, { now: "2026-07-19T12:00:00.000Z" });
      const retry = writeService.updateTaskCommand(first.state, input, { now: "2026-07-19T12:01:00.000Z" });

      assert.equal(retry.changed, false);
      assert.equal(retry.activity.id, first.activity.id);
      assert.equal(retry.state.tasks.length, 2);
      assert.equal(retry.state.tasks.filter((task) => task.id === "mcp-update-occurrence-retry").length, 1);
    },
  },
  {
    name: "MCP requires explicit confirmation and scope before deleting a recurring task",
    async fn() {
      const { taskService, writeService } = await loadServices();
      const state = taskService.createEmptyState();
      state.tasks.push(recurringTask());
      assert.throws(
        () => writeService.deleteTaskCommand(state, {
          requestId: "delete-series-1",
          taskId: "daily-sql",
          scope: "series",
          confirm: false,
        }),
        /confirm: true/,
      );
      assert.throws(
        () => writeService.deleteTaskCommand(state, {
          requestId: "delete-series-2",
          taskId: "daily-sql",
          confirm: true,
        }),
        /scope/,
      );
    },
  },
  {
    name: "MCP undo restores a deleted occurrence with newer synchronization metadata",
    async fn() {
      const { taskService, writeService } = await loadServices();
      const state = taskService.createEmptyState();
      state.tasks.push(recurringTask());
      const removed = writeService.deleteTaskCommand(state, {
        requestId: "delete-occurrence-1",
        taskId: "daily-sql",
        occurrenceDate: "2026-07-20",
        scope: "occurrence",
        confirm: true,
      }, { now: "2026-07-19T12:00:00.000Z" });
      const undone = writeService.undoMcpCommand(removed.state, {
        actionId: removed.activity.id,
      }, { now: "2026-07-19T12:05:00.000Z" });

      assert.equal(undone.state.tasks[0].excludedDates["2026-07-20"], undefined);
      assert.equal(
        undone.state.syncMeta.taskFields["daily-sql"].excludedDates["2026-07-20"],
        "2026-07-19T12:05:00.000Z",
      );
    },
  },
  {
    name: "MCP deletion retries remain successful after the task is already gone",
    async fn() {
      const { taskService, writeService } = await loadServices();
      const state = taskService.createEmptyState();
      state.tasks.push({ ...recurringTask(), repeat: "none" });
      const input = {
        requestId: "delete-task-retry-1",
        taskId: "daily-sql",
        scope: "series",
        confirm: true,
      };
      const first = writeService.deleteTaskCommand(state, input, { now: "2026-07-19T12:00:00.000Z" });
      const retry = writeService.deleteTaskCommand(first.state, input, { now: "2026-07-19T12:01:00.000Z" });

      assert.equal(retry.changed, false);
      assert.equal(retry.activity.id, first.activity.id);
      assert.equal(retry.state.tasks.length, 0);
    },
  },
  {
    name: "MCP records a numeric habit value and can undo it",
    async fn() {
      const { taskService, writeService } = await loadServices();
      const state = taskService.createEmptyState();
      state.habits.push({
        id: "water",
        title: "Вода",
        type: "number",
        goal: 8,
        logs: {},
        configHistory: [],
        updatedAt: "2026-07-01T00:00:00.000Z",
      });
      const changed = writeService.setHabitValueCommand(state, {
        requestId: "habit-water-1",
        habitId: "habit:water",
        date: "2026-07-19",
        value: 5,
      }, { now: "2026-07-19T12:00:00.000Z" });
      assert.equal(changed.state.habits[0].logs["2026-07-19"], 5);

      const undone = writeService.undoMcpCommand(changed.state, {
        actionId: changed.activity.id,
      }, { now: "2026-07-19T12:05:00.000Z" });
      assert.equal(undone.state.habits[0].logs["2026-07-19"], undefined);
      assert.equal(undone.activity.status, "undone");
    },
  },
  {
    name: "MCP creates goals and completes their checkpoints",
    async fn() {
      const { taskService, writeService } = await loadServices();
      const state = taskService.createEmptyState();
      const created = writeService.createGoalCommand(state, {
        requestId: "goal-launch-1",
        title: "Запустить сайт",
        dueDate: "2026-08-01",
        checkpoints: ["Проверить мобильную версию", "Опубликовать"],
      }, { now: "2026-07-19T12:00:00.000Z" });
      const first = created.goal.steps[0];
      const updated = writeService.updateGoalCheckpointCommand(created.state, {
        requestId: "goal-step-done-1",
        goalId: `goal:${created.goal.id}`,
        checkpointId: first.id,
        action: "complete",
        completed: true,
      }, { now: "2026-07-19T13:00:00.000Z" });

      assert.equal(updated.goal.steps[0].done, true);
      assert.equal(updated.goal.status, "active");
      assert.equal(updated.state.mcpActivity.length, 2);
    },
  },
  {
    name: "MCP checkpoint add retries do not create duplicate checkpoints",
    async fn() {
      const { taskService, writeService } = await loadServices();
      const state = taskService.createEmptyState();
      const created = writeService.createGoalCommand(state, {
        requestId: "goal-checkpoint-base",
        title: "Launch",
      }, { now: "2026-07-19T12:00:00.000Z" });
      const input = {
        requestId: "goal-checkpoint-add",
        goalId: created.goal.id,
        action: "add",
        title: "Deploy",
      };
      const first = writeService.updateGoalCheckpointCommand(created.state, input, {
        now: "2026-07-19T13:00:00.000Z",
      });
      const retry = writeService.updateGoalCheckpointCommand(first.state, input, {
        now: "2026-07-19T13:01:00.000Z",
      });

      assert.equal(retry.changed, false);
      assert.equal(retry.activity.id, first.activity.id);
      assert.equal(retry.goal.steps.length, 1);
    },
  },
  {
    name: "MCP day brief detects overlapping timeline blocks",
    async fn() {
      const { taskService, writeService } = await loadServices();
      const state = taskService.createEmptyState();
      state.tasks.push(
        { ...recurringTask(), id: "one", startTime: "10:00", endTime: "11:00", time: "11:00", scheduleMode: "block" },
        { ...recurringTask(), id: "two", startTime: "10:30", endTime: "11:30", time: "11:30", scheduleMode: "block" },
      );
      const brief = writeService.getDayBrief(state, "2026-07-19", "plan");
      assert.deepEqual(brief.conflicts, [["one", "two"]]);
      assert.equal(brief.summary.timelineConflicts, 1);
    },
  },
  {
    name: "MCP undo of a created task writes a tombstone so sync cannot resurrect it",
    async fn() {
      const { taskService, activityService } = await loadServices();
      const before = taskService.createEmptyState();
      const after = structuredClone(before);
      after.tasks.push(recurringTask());
      const activity = activityService.recordMcpActivity(before, after, {
        requestId: "create-task-undo-1",
        type: "create_task",
        title: "Создание задачи",
        summary: "Задача создана",
      }, "2026-07-19T12:00:00.000Z");
      const undone = activityService.undoMcpActivity(after, activity.id, "2026-07-19T12:01:00.000Z");

      assert.equal(undone.state.tasks.length, 0);
      assert.equal(undone.state.tombstones.tasks["daily-sql"], "2026-07-19T12:01:00.000Z");
    },
  },
];
