import { recordMcpActivity } from "./activity-service.mjs";
import { getTodayOverview, taskScheduledOn, tasksForDate } from "./task-service.mjs";
import { getDayBrief, updateTaskCommand } from "./write-service.mjs";

const HABIT_REPEATS = new Set(["daily", "every2days", "every3days", "weekdays", "weekends", "weekly", "custom"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function getCalendarRange(state, input) {
  const from = normalizeDate(input.from);
  const to = normalizeDate(input.to);
  const dates = dateRange(from, to, 93);
  const includeCompleted = input.includeCompleted !== false;
  const categoryId = clean(input.categoryId);
  const days = dates.map((date) => {
    const overview = getTodayOverview(state, date);
    const tasks = overview.tasks.filter((task) =>
      (includeCompleted || !task.completed)
      && (!categoryId || state.tasks?.find((item) => item.id === task.id)?.categoryId === categoryId));
    return {
      date,
      tasks,
      habits: input.includeHabits === false ? [] : overview.habits,
    };
  });
  return {
    from,
    to,
    days,
    summary: {
      days: days.length,
      tasks: days.reduce((sum, day) => sum + day.tasks.length, 0),
      completedTasks: days.reduce((sum, day) => sum + day.tasks.filter((task) => task.completed).length, 0),
    },
  };
}

export function getBacklog(state, input, options = {}) {
  const before = normalizeDate(input.before || options.today);
  const days = clampInteger(input.days, 1, 90, 30);
  const limit = clampInteger(input.limit, 1, 100, 30);
  const from = addDays(before, -days);
  const entries = [];
  dateRange(from, addDays(before, -1), 91).forEach((date) => {
    tasksForDate(state, date).forEach((task) => {
      if (task.completed?.[date] === true || task.acknowledgedOverdue?.[date] === true) return;
      entries.push({
        id: task.id,
        title: task.title,
        date,
        priority: task.priority || "medium",
        repeat: task.repeat || "none",
        scheduleMode: task.scheduleMode || "none",
        time: task.startTime || task.time || "",
      });
    });
  });
  entries.sort((left, right) =>
    priorityRank(right.priority) - priorityRank(left.priority)
    || right.date.localeCompare(left.date)
    || left.title.localeCompare(right.title, "ru"));
  return { before, days, entries: entries.slice(0, limit), total: entries.length };
}

export function getProductivityStats(state, input) {
  const from = normalizeDate(input.from);
  const to = normalizeDate(input.to);
  const dates = dateRange(from, to, 366);
  const daily = dates.map((date) => {
    const overview = getTodayOverview(state, date);
    return {
      date,
      tasksTotal: overview.summary.tasksTotal,
      tasksCompleted: overview.summary.tasksCompleted,
      habitsTotal: overview.summary.habitsTotal,
      habitsCompleted: overview.summary.habitsCompleted,
      habitsFrozen: overview.summary.habitsFrozen,
    };
  });
  const totals = daily.reduce((result, day) => ({
    tasksTotal: result.tasksTotal + day.tasksTotal,
    tasksCompleted: result.tasksCompleted + day.tasksCompleted,
    habitsTotal: result.habitsTotal + day.habitsTotal,
    habitsCompleted: result.habitsCompleted + day.habitsCompleted,
    habitsFrozen: result.habitsFrozen + day.habitsFrozen,
  }), { tasksTotal: 0, tasksCompleted: 0, habitsTotal: 0, habitsCompleted: 0, habitsFrozen: 0 });
  const bestDay = daily
    .filter((day) => day.tasksCompleted || day.habitsCompleted)
    .sort((left, right) =>
      (right.tasksCompleted + right.habitsCompleted) - (left.tasksCompleted + left.habitsCompleted)
      || right.date.localeCompare(left.date))[0] || null;
  return {
    from,
    to,
    ...totals,
    taskCompletionRate: percentage(totals.tasksCompleted, totals.tasksTotal),
    habitCompletionRate: percentage(totals.habitsCompleted, totals.habitsTotal),
    bestDay,
    activeGoals: (state.goals || []).filter((goal) => goal.status !== "done").length,
    completedGoals: (state.goals || []).filter((goal) => goal.status === "done").length,
  };
}

export function listCategories(state) {
  const counts = new Map();
  (state.tasks || []).forEach((task) => {
    if (task.categoryId) counts.set(task.categoryId, (counts.get(task.categoryId) || 0) + 1);
  });
  return {
    categories: (state.categories || []).map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      taskCount: counts.get(category.id) || 0,
    })),
  };
}

export function previewTaskPlan(state, input) {
  const simulation = simulateTaskPlan(state, input.operations, `preview-${Date.now().toString(36)}`);
  return {
    operations: simulation.operations,
    conflicts: timelineConflictsForDates(simulation.state, simulation.operations.map((item) => item.date)),
    summary: planSummary(simulation.operations),
  };
}

export function applyTaskPlanCommand(state, input, options = {}) {
  if (input.confirm !== true) throw new Error("Сначала покажи предпросмотр и получи подтверждение пользователя");
  const before = clone(state);
  const nextState = prepareState(state);
  const requestId = normalizeRequestId(input.requestId);
  const previousAction = findActivity(nextState, requestId);
  if (previousAction) {
    return {
      changed: false,
      state: nextState,
      operations: [],
      activity: previousAction,
      summary: previousAction.summary,
    };
  }

  const simulation = simulateTaskPlan(nextState, input.operations, `batch-${requestId}`, options);
  simulation.state.mcpActivity = clone(before.mcpActivity || []);
  const summary = `План применён: ${simulation.operations.length} изменений`;
  const activity = recordMcpActivity(before, simulation.state, {
    requestId,
    type: "apply_task_plan",
    title: "Планирование задач",
    summary,
  }, options.now || new Date().toISOString());
  return {
    changed: true,
    state: simulation.state,
    operations: simulation.operations,
    conflicts: timelineConflictsForDates(simulation.state, simulation.operations.map((item) => item.date)),
    activity,
    summary,
  };
}

export function createHabitCommand(state, input, options = {}) {
  const before = clone(state);
  const nextState = prepareState(state);
  const requestId = normalizeRequestId(input.requestId);
  const id = `mcp-habit-${requestId}`;
  const previousAction = findActivity(nextState, requestId);
  if (previousAction) {
    return {
      changed: false,
      state: nextState,
      habit: nextState.habits.find((habit) => habit.id === id) || { id, title: clean(input.title) },
      created: false,
      activity: previousAction,
      summary: "Этот запрос уже был обработан",
    };
  }
  const existing = nextState.habits.find((habit) => habit.id === id);
  if (existing) return { changed: false, state: nextState, habit: existing, created: false };
  const now = options.now || new Date().toISOString();
  const startDate = normalizeDate(input.startDate || options.today);
  const title = requiredText(input.title, "Название привычки").slice(0, 200);
  const config = normalizeHabitConfig(input);
  const habit = {
    id,
    title,
    titleHistory: [{ fromDate: startDate, title, updatedAt: now }],
    ...config,
    startDate,
    configHistory: [{ fromDate: startDate, ...config, updatedAt: now }],
    availabilityHistory: [{ fromDate: startDate, active: true, updatedAt: now }],
    archived: false,
    archivedAt: "",
    archivedFromDate: "",
    logs: {},
    createdAt: now,
    updatedAt: now,
  };
  nextState.habits.push(habit);
  const summary = `Привычка «${habit.title}» создана`;
  const activity = recordMcpActivity(before, nextState, activityDetails(requestId, "create_habit", "Создание привычки", summary), now);
  return { changed: true, state: nextState, habit, created: true, activity, summary };
}

export function updateHabitCommand(state, input, options = {}) {
  const before = clone(state);
  const nextState = prepareState(state);
  const habit = findEntity(nextState.habits, input.habitId, "habit", "Привычка");
  const requestId = normalizeRequestId(input.requestId);
  const previousAction = findActivity(nextState, requestId);
  if (previousAction) {
    return { changed: false, state: nextState, habit, fromDate: input.fromDate || options.today, activity: previousAction, summary: "Этот запрос уже был обработан" };
  }
  const fromDate = normalizeDate(input.fromDate || options.today);
  const now = options.now || new Date().toISOString();
  let changed = false;

  if (input.title !== undefined) {
    const title = requiredText(input.title, "Название привычки").slice(0, 200);
    habit.titleHistory = upsertDatedEntry(habit.titleHistory, { fromDate, title, updatedAt: now });
    habit.title = habit.titleHistory.at(-1).title;
    changed = true;
  }
  if (["type", "goal", "unit", "repeat", "customRepeat"].some((field) => input[field] !== undefined)) {
    const current = effectiveEntry(habit.configHistory, fromDate) || habit;
    const config = normalizeHabitConfig({ ...current, ...input });
    habit.configHistory = upsertDatedEntry(habit.configHistory, { fromDate, ...config, updatedAt: now });
    const latest = habit.configHistory.at(-1);
    Object.assign(habit, {
      type: latest.type,
      repeat: latest.repeat,
      customRepeat: latest.customRepeat,
      unit: latest.unit,
      goal: latest.goal,
    });
    changed = true;
  }
  if (!changed) throw new Error("Не указано ни одного изменения привычки");
  habit.updatedAt = now;
  markEntityFields(nextState, "habits", habit.id, ["startDate"], now);
  const summary = `Привычка «${habit.title}» обновлена с ${fromDate}`;
  const activity = recordMcpActivity(before, nextState, activityDetails(requestId, "update_habit", "Изменение привычки", summary), now);
  return { changed: true, state: nextState, habit, fromDate, activity, summary };
}

export function setHabitActiveCommand(state, input, options = {}) {
  const before = clone(state);
  const nextState = prepareState(state);
  const habit = findEntity(nextState.habits, input.habitId, "habit", "Привычка");
  const requestId = normalizeRequestId(input.requestId);
  const previousAction = findActivity(nextState, requestId);
  if (previousAction) {
    return {
      changed: false,
      state: nextState,
      habit,
      active: input.active !== false,
      fromDate: input.fromDate || options.today,
      activity: previousAction,
      summary: "Этот запрос уже был обработан",
    };
  }
  const fromDate = normalizeDate(input.fromDate || options.today);
  const now = options.now || new Date().toISOString();
  const active = input.active !== false;
  habit.availabilityHistory = upsertDatedEntry(habit.availabilityHistory, { fromDate, active, updatedAt: now });
  const latest = habit.availabilityHistory.at(-1);
  habit.archived = latest.active === false;
  habit.archivedAt = habit.archived ? latest.updatedAt : "";
  habit.archivedFromDate = habit.archived ? latest.fromDate : "";
  habit.updatedAt = now;
  markEntityFields(nextState, "habits", habit.id, ["archived", "archivedAt", "archivedFromDate"], now);
  const summary = active
    ? `Привычка «${habit.title}» возобновлена с ${fromDate}`
    : `Привычка «${habit.title}» приостановлена с ${fromDate}`;
  const activity = recordMcpActivity(before, nextState, activityDetails(requestId, "set_habit_active", "Статус привычки", summary), now);
  return { changed: true, state: nextState, habit, active, fromDate, activity, summary };
}

export function updateGoalCommand(state, input, options = {}) {
  const before = clone(state);
  const nextState = prepareState(state);
  const goal = findEntity(nextState.goals, input.goalId, "goal", "Цель");
  const requestId = normalizeRequestId(input.requestId);
  const previousAction = findActivity(nextState, requestId);
  if (previousAction) {
    return { changed: false, state: nextState, goal, activity: previousAction, summary: "Этот запрос уже был обработан" };
  }
  const now = options.now || new Date().toISOString();
  const changedFields = [];
  if (input.title !== undefined) {
    goal.title = requiredText(input.title, "Название цели").slice(0, 200);
    changedFields.push("title");
  }
  if (input.dueDate !== undefined) {
    goal.dueDate = input.dueDate ? normalizeDate(input.dueDate) : "";
    changedFields.push("dueDate");
  }
  if (input.why !== undefined) {
    goal.why = clean(input.why).slice(0, 500);
    changedFields.push("why");
  }
  if (!changedFields.length) throw new Error("Не указано ни одного изменения цели");
  goal.updatedAt = now;
  markEntityFields(nextState, "goals", goal.id, changedFields, now);
  const summary = `Цель «${goal.title}» обновлена`;
  const activity = recordMcpActivity(before, nextState, activityDetails(requestId, "update_goal", "Изменение цели", summary), now);
  return { changed: true, state: nextState, goal, activity, summary };
}

export function deleteGoalCommand(state, input, options = {}) {
  if (input.confirm !== true) throw new Error("Для удаления цели нужно явно передать confirm: true");
  const before = clone(state);
  const nextState = prepareState(state);
  const requestId = normalizeRequestId(input.requestId);
  const previousAction = findActivity(nextState, requestId);
  if (previousAction) {
    return {
      changed: false,
      state: nextState,
      goalId: stripPrefix(input.goalId, "goal"),
      activity: previousAction,
      summary: "Этот запрос уже был обработан",
    };
  }
  const goal = findEntity(nextState.goals, input.goalId, "goal", "Цель");
  const now = options.now || new Date().toISOString();
  nextState.goals = nextState.goals.filter((item) => item.id !== goal.id);
  nextState.tombstones.goals[goal.id] = now;
  const summary = `Цель «${goal.title}» удалена`;
  const activity = recordMcpActivity(before, nextState, activityDetails(requestId, "delete_goal", "Удаление цели", summary), now);
  return { changed: true, state: nextState, goalId: goal.id, activity, summary };
}

export function duplicateTaskCommand(state, input, options = {}) {
  const before = clone(state);
  const nextState = prepareState(state);
  const requestId = normalizeRequestId(input.requestId);
  const id = `mcp-copy-${requestId}`;
  const previousAction = findActivity(nextState, requestId);
  if (previousAction) {
    return {
      changed: false,
      state: nextState,
      task: nextState.tasks.find((task) => task.id === id) || { id, title: clean(input.title) || "Копия задачи" },
      created: false,
      activity: previousAction,
      summary: "Этот запрос уже был обработан",
    };
  }
  const source = findEntity(nextState.tasks, input.taskId, "task", "Задача");
  const existing = nextState.tasks.find((task) => task.id === id);
  if (existing) return { changed: false, state: nextState, task: existing, created: false };
  const now = options.now || new Date().toISOString();
  const date = normalizeDate(input.date || input.occurrenceDate || source.date);
  const copySeries = input.copyMode === "series" && source.repeat !== "none";
  if (source.repeat !== "none" && !["occurrence", "series"].includes(input.copyMode)) {
    throw new Error("Для повторяющейся задачи укажи copyMode: occurrence или series");
  }
  if (source.repeat !== "none" && input.occurrenceDate && !taskScheduledOn(source, input.occurrenceDate)) {
    throw new Error("На выбранную дату у серии нет повторения");
  }
  const task = {
    ...clone(source),
    id,
    title: clean(input.title) || `${source.title} — копия`,
    date,
    repeat: copySeries ? source.repeat : "none",
    repeatUntil: copySeries ? source.repeatUntil || "" : "",
    sourceTaskId: "",
    movedFromDate: "",
    completed: {},
    acknowledgedOverdue: {},
    excludedDates: {},
    notified: {},
    createdAt: now,
    updatedAt: now,
  };
  nextState.tasks.push(task);
  addTaskToOrder(nextState, date, id, now);
  const summary = `Создана копия задачи «${source.title}»`;
  const activity = recordMcpActivity(before, nextState, activityDetails(requestId, "duplicate_task", "Дублирование задачи", summary), now);
  return { changed: true, state: nextState, task, created: true, activity, summary };
}

export function acknowledgeOverdueCommand(state, input, options = {}) {
  const before = clone(state);
  const nextState = prepareState(state);
  const requestId = normalizeRequestId(input.requestId);
  const previousAction = findActivity(nextState, requestId);
  if (previousAction) {
    return {
      changed: false,
      state: nextState,
      task: nextState.tasks.find((item) => item.id === stripPrefix(input.taskId, "task"))
        || { id: stripPrefix(input.taskId, "task"), title: "Задача" },
      date: input.date,
      acknowledged: input.acknowledged !== false,
      activity: previousAction,
      summary: "Этот запрос уже был обработан",
    };
  }
  const task = findEntity(nextState.tasks, input.taskId, "task", "Задача");
  const date = normalizeDate(input.date);
  if (!taskScheduledOn(task, date) || task.completed?.[date] === true || task.excludedDates?.[date] === true) {
    throw new Error("На выбранную дату нет активной просрочки этой задачи");
  }
  const now = options.now || new Date().toISOString();
  task.acknowledgedOverdue ||= {};
  if (input.acknowledged === false) delete task.acknowledgedOverdue[date];
  else task.acknowledgedOverdue[date] = true;
  task.updatedAt = now;
  (((nextState.syncMeta.taskFields[task.id] ||= {}).acknowledgedOverdue ||= {}))[date] = now;
  const acknowledged = input.acknowledged !== false;
  const summary = acknowledged
    ? `Просрочка «${task.title}» за ${date} отмечена просмотренной`
    : `Просрочка «${task.title}» за ${date} снова показана`;
  const activity = recordMcpActivity(before, nextState, activityDetails(requestId, "acknowledge_overdue", "Просмотр просрочки", summary), now);
  return { changed: true, state: nextState, task, date, acknowledged, activity, summary };
}

export function upsertCategoryCommand(state, input, options = {}) {
  const before = clone(state);
  const nextState = prepareState(state);
  const requestId = normalizeRequestId(input.requestId);
  const now = options.now || new Date().toISOString();
  const name = requiredText(input.name, "Название категории").slice(0, 60);
  const color = input.color === undefined ? "" : normalizeColor(input.color);
  const previousAction = findActivity(nextState, requestId);
  if (previousAction) {
    const id = stripPrefix(input.categoryId, "category") || `mcp-category-${requestId}`;
    return {
      changed: false,
      state: nextState,
      category: nextState.categories.find((category) => category.id === id) || { id, name, color: color || "#4f8cff" },
      created: false,
      activity: previousAction,
      summary: "Этот запрос уже был обработан",
    };
  }
  let category = input.categoryId
    ? findEntity(nextState.categories, input.categoryId, "category", "Категория")
    : nextState.categories.find((item) => clean(item.name).toLowerCase() === name.toLowerCase());
  let created = false;
  if (!category) {
    category = {
      id: `mcp-category-${requestId}`,
      name,
      color: color || "#4f8cff",
      createdAt: now,
      updatedAt: now,
    };
    nextState.categories.push(category);
    created = true;
  } else {
    category.name = name;
    if (color) category.color = color;
    category.updatedAt = now;
    markEntityFields(nextState, "categories", category.id, ["name", ...(color ? ["color"] : [])], now);
  }
  const summary = created ? `Категория «${name}» создана` : `Категория «${name}» обновлена`;
  const activity = recordMcpActivity(before, nextState, activityDetails(requestId, "upsert_category", "Категория", summary), now);
  return { changed: true, state: nextState, category, created, activity, summary };
}

export function deleteCategoryCommand(state, input, options = {}) {
  if (input.confirm !== true) throw new Error("Для удаления категории нужно явно передать confirm: true");
  const before = clone(state);
  const nextState = prepareState(state);
  const requestId = normalizeRequestId(input.requestId);
  const previousAction = findActivity(nextState, requestId);
  if (previousAction) {
    return {
      changed: false,
      state: nextState,
      categoryId: stripPrefix(input.categoryId, "category"),
      replacementCategoryId: stripPrefix(input.replacementCategoryId, "category"),
      activity: previousAction,
      summary: "Этот запрос уже был обработан",
    };
  }
  const category = findEntity(nextState.categories, input.categoryId, "category", "Категория");
  const replacementId = stripPrefix(input.replacementCategoryId, "category");
  if (replacementId && !nextState.categories.some((item) => item.id === replacementId && item.id !== category.id)) {
    throw new Error("Категория для переноса задач не найдена");
  }
  const now = options.now || new Date().toISOString();
  nextState.tasks.filter((task) => task.categoryId === category.id).forEach((task) => {
    task.categoryId = replacementId;
    task.updatedAt = now;
    markEntityFields(nextState, "tasks", task.id, ["categoryId"], now);
  });
  nextState.categories = nextState.categories.filter((item) => item.id !== category.id);
  nextState.tombstones.categories[category.id] = now;
  const summary = `Категория «${category.name}» удалена`;
  const activity = recordMcpActivity(before, nextState, activityDetails(requestId, "delete_category", "Удаление категории", summary), now);
  return { changed: true, state: nextState, categoryId: category.id, replacementCategoryId: replacementId, activity, summary };
}

function normalizeHabitConfig(input) {
  const type = input.type === "number" ? "number" : "check";
  const repeat = HABIT_REPEATS.has(input.repeat) ? input.repeat : "daily";
  const customRepeat = normalizeCustomRepeat(input.customRepeat);
  const goal = type === "number" ? Math.max(0.01, Number(input.goal) || 1) : 1;
  return {
    type,
    repeat,
    customRepeat,
    unit: type === "number" ? clean(input.unit).slice(0, 30) : "",
    goal,
  };
}

function simulateTaskPlan(state, operations, requestPrefix, options = {}) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 30) {
    throw new Error("План должен содержать от 1 до 30 изменений");
  }
  let nextState = prepareState(state);
  const results = [];
  operations.forEach((operation, index) => {
    try {
      const operationRequestId = `${requestPrefix.slice(0, 90)}:${index + 1}`;
      const mutation = updateTaskCommand(nextState, {
        ...operation,
        requestId: operationRequestId,
      }, {
        now: options.now || new Date().toISOString(),
        requestId: operationRequestId,
      });
      nextState = mutation.state;
      results.push({
        index,
        taskId: mutation.task.id,
        title: mutation.task.title,
        date: mutation.task.date,
        scope: mutation.scope,
        scheduleMode: mutation.task.scheduleMode || "none",
        time: mutation.task.startTime || mutation.task.time || "",
        endTime: mutation.task.endTime || "",
      });
    } catch (error) {
      throw new Error(`Изменение ${index + 1}: ${error.message}`);
    }
  });
  return { state: nextState, operations: results };
}

function timelineConflictsForDates(state, dates) {
  return [...new Set(dates)].flatMap((date) =>
    getDayBrief(state, date, "plan").conflicts.map((taskIds) => ({ date, taskIds })));
}

function planSummary(operations) {
  return {
    changes: operations.length,
    days: new Set(operations.map((item) => item.date)).size,
    timed: operations.filter((item) => item.scheduleMode !== "none").length,
  };
}

function normalizeCustomRepeat(value) {
  const source = value && typeof value === "object" ? value : {};
  if (source.type === "weekdays") {
    const weekdays = [...new Set((source.weekdays || []).map(Number).filter((day) => day >= 0 && day <= 6))];
    if (!weekdays.length) throw new Error("Для custom weekdays укажи хотя бы один день недели");
    return { type: "weekdays", weekdays };
  }
  if (source.type === "monthDay") return { type: "monthDay", day: clampInteger(source.day, 1, 31, 1) };
  if (source.type === "interval") return { type: "interval", every: clampInteger(source.every, 1, 365, 2) };
  return { type: "weekdays", weekdays: [1, 3, 5] };
}

function prepareState(state) {
  const next = clone(state);
  [
    "tasks", "habits", "goals", "journalEntries", "categories", "mcpActivity",
    "nutritionFoods", "nutritionMeals", "nutritionTemplates",
  ].forEach((key) => {
    next[key] = Array.isArray(next[key]) ? next[key] : [];
  });
  next.taskOrder = next.taskOrder && typeof next.taskOrder === "object" ? next.taskOrder : {};
  next.tombstones = next.tombstones && typeof next.tombstones === "object"
    ? next.tombstones
    : {
      tasks: {}, habits: {}, goals: {}, journalEntries: {}, categories: {},
      nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {},
    };
  [
    "tasks", "habits", "goals", "journalEntries", "categories",
    "nutritionFoods", "nutritionMeals", "nutritionTemplates",
  ].forEach((type) => {
    next.tombstones[type] ||= {};
  });
  next.syncMeta = next.syncMeta && typeof next.syncMeta === "object" ? next.syncMeta : {};
  next.syncMeta.entityFields ||= {
    tasks: {}, habits: {}, goals: {}, journalEntries: {}, categories: {},
    nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {},
  };
  next.syncMeta.taskFields ||= {};
  next.syncMeta.habitLogs ||= {};
  next.syncMeta.taskOrder ||= {};
  next.syncMeta.goalSteps ||= {};
  next.syncMeta.goalStepOrder ||= {};
  return next;
}

function markEntityFields(state, type, id, fields, now) {
  const versions = (((state.syncMeta.entityFields[type] ||= {})[id] ||= {}));
  fields.forEach((field) => {
    versions[field] = now;
  });
}

function addTaskToOrder(state, date, id, now) {
  const order = new Set(state.taskOrder[date] || []);
  order.add(id);
  state.taskOrder[date] = [...order];
  state.syncMeta.taskOrder[date] = now;
}

function upsertDatedEntry(history, entry) {
  return [...(Array.isArray(history) ? history : []).filter((item) => item?.fromDate !== entry.fromDate), entry]
    .sort((left, right) => left.fromDate.localeCompare(right.fromDate) || left.updatedAt.localeCompare(right.updatedAt));
}

function effectiveEntry(history, date) {
  return (Array.isArray(history) ? history : [])
    .filter((entry) => entry?.fromDate && entry.fromDate <= date)
    .sort((left, right) => left.fromDate.localeCompare(right.fromDate) || left.updatedAt.localeCompare(right.updatedAt))
    .at(-1);
}

function findEntity(items, value, prefix, label) {
  const id = stripPrefix(value, prefix);
  const entity = items.find((item) => item.id === id);
  if (!entity) throw new Error(`${label} не найдена`);
  return entity;
}

function findActivity(state, requestId) {
  return state.mcpActivity.find((activity) => activity.requestId === requestId);
}

function stripPrefix(value, prefix) {
  return String(value || "").replace(new RegExp(`^${prefix}:`), "");
}

function activityDetails(requestId, type, title, summary) {
  return { requestId, type, title, summary };
}

function dateRange(from, to, maxDays) {
  if (to < from) throw new Error("Дата окончания не может быть раньше даты начала");
  const result = [];
  let current = from;
  while (current <= to) {
    result.push(current);
    if (result.length > maxDays) throw new Error(`Период не может быть длиннее ${maxDays} дней`);
    current = addDays(current, 1);
  }
  return result;
}

function addDays(dateKey, amount) {
  const date = new Date(`${normalizeDate(dateKey)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  const text = String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error("Дата должна быть в формате YYYY-MM-DD");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])
  ) throw new Error("Указана несуществующая дата");
  return text;
}

function normalizeRequestId(value) {
  const id = clean(value);
  if (!/^[a-zA-Z0-9._:-]{8,100}$/.test(id)) {
    throw new Error("requestId должен быть уникальной строкой длиной 8–100 символов");
  }
  return id;
}

function normalizeColor(value) {
  const color = String(value || "").trim();
  if (!HEX_COLOR.test(color)) throw new Error("Цвет должен быть в формате #RRGGBB");
  return color.toLowerCase();
}

function requiredText(value, label) {
  const text = clean(value);
  if (!text) throw new Error(`${label} не может быть пустым`);
  return text;
}

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function percentage(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

function priorityRank(value) {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clone(value) {
  return structuredClone(value || {});
}
