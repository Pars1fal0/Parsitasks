import { z } from "zod";
import {
  acknowledgeOverdueCommand,
  applyTaskPlanCommand,
  createHabitCommand,
  deleteCategoryCommand,
  deleteGoalCommand,
  duplicateTaskCommand,
  getBacklog,
  getCalendarRange,
  getProductivityStats,
  listCategories,
  previewTaskPlan,
  setHabitActiveCommand,
  updateGoalCommand,
  updateHabitCommand,
  upsertCategoryCommand,
} from "./management-service.mjs";
import { stateTimeZone, toDateKey } from "./task-service.mjs";

export function registerManagementTools(server, context, helpers) {
  const security = helpers.security;

  server.registerTool(
    "get_calendar_range",
    {
      title: "Получить календарь за период",
      description: "Возвращает задачи и привычки по дням за период до 93 дней.",
      inputSchema: {
        from: z.string(),
        to: z.string(),
        includeCompleted: z.boolean().optional(),
        includeHabits: z.boolean().optional(),
        categoryId: z.string().optional(),
      },
      outputSchema: {
        from: z.string(),
        to: z.string(),
        days: z.array(z.record(z.string(), z.unknown())),
        summary: z.record(z.string(), z.number()),
      },
      securitySchemes: security,
      annotations: readOnly(),
    },
    async (input) => helpers.readTool(context, (state) => getCalendarRange(state, input)),
  );

  server.registerTool(
    "get_backlog",
    {
      title: "Получить хвост задач",
      description: "Возвращает невыполненные и непросмотренные задачи прошлых дней.",
      inputSchema: {
        before: z.string().optional(),
        days: z.number().int().min(1).max(90).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      outputSchema: {
        before: z.string(),
        days: z.number(),
        entries: z.array(z.record(z.string(), z.unknown())),
        total: z.number(),
      },
      securitySchemes: security,
      annotations: readOnly(),
    },
    async (input) => {
      return helpers.readTool(context, (state) =>
        getBacklog(state, input, { today: todayForState(state, context) }));
    },
  );

  server.registerTool(
    "get_productivity_stats",
    {
      title: "Получить статистику",
      description: "Считает выполнение задач и привычек за период до одного года.",
      inputSchema: { from: z.string(), to: z.string() },
      outputSchema: {
        from: z.string(),
        to: z.string(),
        tasksTotal: z.number(),
        tasksCompleted: z.number(),
        habitsTotal: z.number(),
        habitsCompleted: z.number(),
        habitsFrozen: z.number(),
        taskCompletionRate: z.number(),
        habitCompletionRate: z.number(),
        bestDay: z.record(z.string(), z.unknown()).nullable(),
        activeGoals: z.number(),
        completedGoals: z.number(),
      },
      securitySchemes: security,
      annotations: readOnly(),
    },
    async (input) => helpers.readTool(context, (state) => getProductivityStats(state, input)),
  );

  server.registerTool(
    "list_categories",
    {
      title: "Получить категории",
      description: "Возвращает категории, цвета и количество задач.",
      inputSchema: {},
      outputSchema: { categories: z.array(z.record(z.string(), z.unknown())) },
      securitySchemes: security,
      annotations: readOnly(),
    },
    async () => helpers.readTool(context, listCategories),
  );

  server.registerTool(
    "preview_task_plan",
    {
      title: "Предпросмотр плана задач",
      description: "Проверяет пакет переносов и изменений задач без сохранения. Используй перед apply_task_plan.",
      inputSchema: {
        operations: z.array(taskPlanOperation()).min(1).max(30),
      },
      outputSchema: {
        operations: z.array(z.record(z.string(), z.unknown())),
        conflicts: z.array(z.record(z.string(), z.unknown())),
        summary: z.record(z.string(), z.number()),
      },
      securitySchemes: security,
      annotations: readOnly(),
    },
    async (input) => helpers.readTool(context, (state) => previewTaskPlan(state, input)),
  );

  server.registerTool(
    "apply_task_plan",
    {
      title: "Применить подтверждённый план задач",
      description: "Атомарно применяет ранее показанный пакет изменений. Возвращает один actionId для общего Undo.",
      inputSchema: {
        requestId: requestId(),
        operations: z.array(taskPlanOperation()).min(1).max(30),
        confirm: z.boolean(),
      },
      outputSchema: {
        saved: z.boolean(),
        operations: z.array(z.record(z.string(), z.unknown())),
        conflicts: z.array(z.record(z.string(), z.unknown())).optional(),
        actionId: z.string(),
      },
      securitySchemes: security,
      annotations: writeSafe(),
    },
    async (input) => helpers.writeTool(context, (state) => applyTaskPlanCommand(state, input)),
  );

  server.registerTool(
    "create_habit",
    {
      title: "Создать привычку",
      description: "Создаёт чек-привычку или измеримую привычку с настраиваемым повтором.",
      inputSchema: {
        requestId: requestId(),
        title: z.string().min(1).max(200),
        startDate: z.string().optional(),
        type: z.enum(["check", "number"]).optional(),
        goal: z.number().positive().optional(),
        unit: z.string().max(30).optional(),
        repeat: habitRepeat().optional(),
        customRepeat: customRepeat().optional(),
      },
      outputSchema: {
        created: z.boolean(),
        saved: z.boolean(),
        habit: z.record(z.string(), z.unknown()),
        actionId: z.string().optional(),
      },
      securitySchemes: security,
      annotations: writeSafe(),
    },
    async (input) => {
      return helpers.writeTool(context, (state) =>
        createHabitCommand(state, input, { today: todayForState(state, context) }));
    },
  );

  server.registerTool(
    "update_habit",
    {
      title: "Изменить привычку",
      description: "Меняет привычку с выбранной даты, сохраняя прежнее название и настройки в истории.",
      inputSchema: {
        requestId: requestId(),
        habitId: z.string(),
        fromDate: z.string().optional(),
        title: z.string().min(1).max(200).optional(),
        type: z.enum(["check", "number"]).optional(),
        goal: z.number().positive().optional(),
        unit: z.string().max(30).optional(),
        repeat: habitRepeat().optional(),
        customRepeat: customRepeat().optional(),
      },
      outputSchema: {
        saved: z.boolean(),
        habit: z.record(z.string(), z.unknown()),
        fromDate: z.string(),
        actionId: z.string(),
      },
      securitySchemes: security,
      annotations: writeSafe(),
    },
    async (input) => {
      return helpers.writeTool(context, (state) =>
        updateHabitCommand(state, input, { today: todayForState(state, context) }));
    },
  );

  server.registerTool(
    "set_habit_active",
    {
      title: "Приостановить или возобновить привычку",
      description: "Изменяет доступность привычки с выбранной даты без удаления истории.",
      inputSchema: {
        requestId: requestId(),
        habitId: z.string(),
        fromDate: z.string().optional(),
        active: z.boolean(),
      },
      outputSchema: {
        saved: z.boolean(),
        habit: z.record(z.string(), z.unknown()),
        active: z.boolean(),
        fromDate: z.string(),
        actionId: z.string(),
      },
      securitySchemes: security,
      annotations: writeSafe(),
    },
    async (input) => {
      return helpers.writeTool(context, (state) =>
        setHabitActiveCommand(state, input, { today: todayForState(state, context) }));
    },
  );

  server.registerTool(
    "update_goal",
    {
      title: "Изменить цель",
      description: "Меняет название, срок или причину цели без затрагивания чекпоинтов.",
      inputSchema: {
        requestId: requestId(),
        goalId: z.string(),
        title: z.string().min(1).max(200).optional(),
        dueDate: z.string().optional(),
        why: z.string().max(500).optional(),
      },
      outputSchema: {
        saved: z.boolean(),
        goal: z.record(z.string(), z.unknown()),
        actionId: z.string(),
      },
      securitySchemes: security,
      annotations: writeSafe(),
    },
    async (input) => helpers.writeTool(context, (state) => updateGoalCommand(state, input)),
  );

  server.registerTool(
    "delete_goal",
    {
      title: "Удалить цель",
      description: "Удаляет цель и её чекпоинты только после явного подтверждения.",
      inputSchema: {
        requestId: requestId(),
        goalId: z.string(),
        confirm: z.boolean(),
      },
      outputSchema: {
        saved: z.boolean(),
        goalId: z.string(),
        actionId: z.string(),
      },
      securitySchemes: security,
      annotations: writeDestructive(),
    },
    async (input) => helpers.writeTool(context, (state) => deleteGoalCommand(state, input)),
  );

  server.registerTool(
    "duplicate_task",
    {
      title: "Дублировать задачу",
      description: "Создаёт независимую копию одного повторения или всей повторяющейся серии.",
      inputSchema: {
        requestId: requestId(),
        taskId: z.string(),
        occurrenceDate: z.string().optional(),
        date: z.string().optional(),
        title: z.string().max(200).optional(),
        copyMode: z.enum(["occurrence", "series"]).optional(),
      },
      outputSchema: {
        created: z.boolean(),
        saved: z.boolean(),
        task: z.record(z.string(), z.unknown()),
        actionId: z.string().optional(),
      },
      securitySchemes: security,
      annotations: writeSafe(),
    },
    async (input) => helpers.writeTool(context, (state) => duplicateTaskCommand(state, input)),
  );

  server.registerTool(
    "acknowledge_overdue",
    {
      title: "Скрыть просмотренную просрочку",
      description: "Помечает конкретную просрочку просмотренной, не выполняя и не удаляя задачу.",
      inputSchema: {
        requestId: requestId(),
        taskId: z.string(),
        date: z.string(),
        acknowledged: z.boolean().optional(),
      },
      outputSchema: {
        saved: z.boolean(),
        task: z.record(z.string(), z.unknown()),
        date: z.string(),
        acknowledged: z.boolean(),
        actionId: z.string(),
      },
      securitySchemes: security,
      annotations: writeSafe(),
    },
    async (input) => helpers.writeTool(context, (state) => acknowledgeOverdueCommand(state, input)),
  );

  server.registerTool(
    "upsert_category",
    {
      title: "Создать или изменить категорию",
      description: "Создаёт категорию либо меняет её название и цвет.",
      inputSchema: {
        requestId: requestId(),
        categoryId: z.string().optional(),
        name: z.string().min(1).max(60),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      },
      outputSchema: {
        created: z.boolean(),
        saved: z.boolean(),
        category: z.record(z.string(), z.unknown()),
        actionId: z.string(),
      },
      securitySchemes: security,
      annotations: writeSafe(),
    },
    async (input) => helpers.writeTool(context, (state) => upsertCategoryCommand(state, input)),
  );

  server.registerTool(
    "delete_category",
    {
      title: "Удалить категорию",
      description: "Удаляет категорию после подтверждения и переносит её задачи в выбранную категорию или без категории.",
      inputSchema: {
        requestId: requestId(),
        categoryId: z.string(),
        replacementCategoryId: z.string().optional(),
        confirm: z.boolean(),
      },
      outputSchema: {
        saved: z.boolean(),
        categoryId: z.string(),
        replacementCategoryId: z.string(),
        actionId: z.string(),
      },
      securitySchemes: security,
      annotations: writeDestructive(),
    },
    async (input) => helpers.writeTool(context, (state) => deleteCategoryCommand(state, input)),
  );
}

function requestId() {
  return z.string().min(8).max(100);
}

function todayForState(state, context) {
  return toDateKey(new Date(), stateTimeZone(state, context.timeZone));
}

function habitRepeat() {
  return z.enum(["daily", "every2days", "every3days", "weekdays", "weekends", "weekly", "custom"]);
}

function customRepeat() {
  return z.object({
    type: z.enum(["weekdays", "monthDay", "interval"]),
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
    day: z.number().int().min(1).max(31).optional(),
    every: z.number().int().min(1).max(365).optional(),
  });
}

function taskPlanOperation() {
  return z.object({
    taskId: z.string(),
    occurrenceDate: z.string().optional(),
    scope: z.enum(["occurrence", "following", "series"]).optional(),
    title: z.string().min(1).max(200).optional(),
    date: z.string().optional(),
    category: z.string().max(60).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    scheduleMode: z.enum(["none", "deadline", "block"]).optional(),
    time: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    reminderOffset: z.enum(["none", "0", "5", "15", "30", "60", "1440"]).optional(),
    repeat: z.enum(["none", "daily", "every2days", "every3days", "weekdays", "weekends", "weekly", "monthly", "yearly", "custom"]).optional(),
    customRepeat: customRepeat().optional(),
    repeatUntil: z.string().optional(),
  });
}

function readOnly() {
  return { readOnlyHint: true, openWorldHint: false, destructiveHint: false };
}

function writeSafe() {
  return { readOnlyHint: false, openWorldHint: false, destructiveHint: false };
}

function writeDestructive() {
  return { readOnlyHint: false, openWorldHint: false, destructiveHint: true };
}
