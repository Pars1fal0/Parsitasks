const assert = require("node:assert/strict");

async function loadService() {
  return import("../mcp/task-service.mjs");
}

module.exports = [
  {
    name: "MCP creates a categorized 15-minute task block without duplicating retries",
    async fn() {
      const service = await loadService();
      const state = service.createEmptyState();
      const input = {
        requestId: "request-12345678",
        title: "Созвон с командой",
        date: "2026-07-20",
        startTime: "14:15",
        endTime: "15:00",
        category: "Работа",
        priority: "high",
      };
      const first = service.createTaskCommand(state, input, { now: "2026-07-19T10:00:00.000Z", today: "2026-07-19" });
      const retry = service.createTaskCommand(first.state, input, { now: "2026-07-19T10:00:01.000Z", today: "2026-07-19" });

      assert.equal(first.created, true);
      assert.equal(first.task.scheduleMode, "block");
      assert.equal(first.task.time, "15:00");
      assert.equal(first.task.priority, "high");
      assert.equal(first.state.categories[0].name, "Работа");
      assert.deepEqual(first.state.taskOrder["2026-07-20"], [first.task.id]);
      assert.equal(retry.created, false);
      assert.equal(retry.changed, false);
      assert.equal(retry.state.tasks.length, 1);
    },
  },
  {
    name: "MCP does not recreate an undone task when the same request is retried",
    async fn() {
      const [service, activityService] = await Promise.all([
        loadService(),
        import("../mcp/activity-service.mjs"),
      ]);
      const input = {
        requestId: "request-undone-task",
        title: "Temporary task",
        date: "2026-07-20",
      };
      const before = service.createEmptyState();
      const created = service.createTaskCommand(before, input, {
        now: "2026-07-19T10:00:00.000Z",
        today: "2026-07-19",
      });
      const activity = activityService.recordMcpActivity(before, created.state, {
        requestId: input.requestId,
        type: "create_task",
        title: "Create task",
        summary: "Task created",
      }, "2026-07-19T10:00:00.000Z");
      const undone = activityService.undoMcpActivity(
        created.state,
        activity.id,
        "2026-07-19T10:01:00.000Z",
      );
      const retry = service.createTaskCommand(undone.state, input, {
        now: "2026-07-19T10:02:00.000Z",
        today: "2026-07-19",
      });

      assert.equal(retry.changed, false);
      assert.equal(retry.created, false);
      assert.equal(retry.state.tasks.length, 0);
    },
  },
  {
    name: "MCP rejects blocks that are not aligned to 15 minutes",
    async fn() {
      const service = await loadService();
      assert.throws(
        () => service.createTaskCommand(service.createEmptyState(), {
          requestId: "request-unaligned",
          title: "Слишком точный блок",
          date: "2026-07-20",
          startTime: "14:10",
          endTime: "15:00",
        }, { today: "2026-07-19" }),
        /15 минут/,
      );
    },
  },
  {
    name: "MCP creates tasks with custom interval recurrence",
    async fn() {
      const service = await loadService();
      const result = service.createTaskCommand(service.createEmptyState(), {
        requestId: "request-custom-repeat",
        title: "Every four days",
        date: "2026-07-20",
        repeat: "custom",
        customRepeat: { type: "interval", every: 4 },
      }, { today: "2026-07-20" });

      assert.equal(result.task.repeat, "custom");
      assert.deepEqual(result.task.customRepeat, { type: "interval", every: 4 });
      assert.equal(service.taskScheduledOn(result.task, "2026-07-24"), true);
      assert.equal(service.taskScheduledOn(result.task, "2026-07-23"), false);
    },
  },
  {
    name: "MCP and the browser share custom repeat normalization",
    async fn() {
      const service = await loadService();
      const browserRecurrence = require("../app/src/tasks/recurrence.js");
      const samples = [
        { type: "interval", every: 0 },
        { type: "monthDay", day: 40 },
        { type: "weekdays", weekdays: [0, 5, 1, 5] },
        null,
      ];
      samples.forEach((sample) => {
        assert.deepEqual(service.normalizeCustomRepeat(sample), browserRecurrence.normalizeCustomRepeat(sample));
      });
    },
  },
  {
    name: "MCP completes only the selected occurrence of a recurring task",
    async fn() {
      const service = await loadService();
      const state = service.createEmptyState();
      state.tasks.push({
        id: "daily-task",
        title: "Решить задачи SQL",
        date: "2026-07-10",
        repeat: "daily",
        completed: {},
        excludedDates: {},
        updatedAt: "2026-07-10T10:00:00.000Z",
      });
      const result = service.completeTaskCommand(state, {
        taskId: "daily-task",
        date: "2026-07-19",
        completed: true,
      }, {
        now: "2026-07-19T11:00:00.000Z",
        today: "2026-07-19",
      });

      assert.equal(result.state.tasks[0].completed["2026-07-19"], true);
      assert.equal(result.state.tasks[0].completed["2026-07-20"], undefined);
      assert.equal(
        result.state.syncMeta.taskFields["daily-task"].completed["2026-07-19"],
        "2026-07-19T11:00:00.000Z",
      );
    },
  },
  {
    name: "MCP overview respects custom repeats and dated habit history",
    async fn() {
      const service = await loadService();
      const state = service.createEmptyState();
      state.tasks.push({
        id: "custom-task",
        title: "Тренировка",
        date: "2026-07-01",
        repeat: "custom",
        customRepeat: { type: "weekdays", weekdays: [1, 3, 5] },
        completed: {},
        excludedDates: {},
      });
      state.habits.push({
        id: "habit-1",
        title: "Вода",
        titleHistory: [{ fromDate: "2026-07-01", title: "Вода", updatedAt: "2026-07-01T00:00:00Z" }],
        startDate: "2026-07-01",
        repeat: "daily",
        type: "number",
        goal: 8,
        unit: "стаканов",
        logs: { "2026-07-20": 4 },
        configHistory: [{
          fromDate: "2026-07-01",
          type: "number",
          goal: 8,
          unit: "стаканов",
          repeat: "daily",
          updatedAt: "2026-07-01T00:00:00Z",
        }],
        availabilityHistory: [{ fromDate: "2026-07-01", active: true, updatedAt: "2026-07-01T00:00:00Z" }],
      });

      const overview = service.getTodayOverview(state, "2026-07-20");
      assert.equal(overview.tasks[0].title, "Тренировка");
      assert.equal(overview.habits[0].value, 4);
      assert.equal(overview.habits[0].completed, false);
    },
  },
  {
    name: "MCP resolves today using the synchronized profile time zone",
    async fn() {
      const service = await loadService();
      const state = service.createEmptyState();
      state.profile = { timeZone: "Asia/Yekaterinburg" };
      assert.equal(service.stateTimeZone(state, "Europe/Moscow"), "Asia/Yekaterinburg");
      assert.equal(service.stateTimeZone({ profile: { timeZone: "invalid" } }, "Europe/Moscow"), "Europe/Moscow");
    },
  },
  {
    name: "MCP search and fetch expose tasks, habits, and goals as structured knowledge",
    async fn() {
      const service = await loadService();
      const state = service.createEmptyState();
      state.tasks.push({ id: "task-1", title: "Позвонить врачу", date: "2026-07-20", priority: "high" });
      state.goals.push({
        id: "goal-1",
        title: "Запустить сайт",
        dueDate: "2026-08-01",
        steps: [{ id: "step-1", title: "Деплой", done: false }],
      });

      const search = service.searchKnowledge(state, "сайт", { baseUrl: "https://parsitasks.ru" });
      const fetched = service.fetchKnowledge(state, search.results[0].id, { baseUrl: "https://parsitasks.ru" });
      assert.equal(search.results[0].id, "goal:goal-1");
      assert.match(fetched.text, /Деплой/);
      assert.equal(fetched.url, "https://parsitasks.ru/#goals");
    },
  },
];
