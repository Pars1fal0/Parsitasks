import { recordMcpActivity, undoMcpActivity } from "./activity-service.mjs";
import { getTodayOverview, normalizeCustomRepeat, taskScheduledOn } from "./task-service.mjs";
import documentState from "../app/src/core/document-state.js";
import goalActivity from "../app/src/goals/goal-activity.js";
import habitSchedule from "../app/src/habits/habit-schedule.js";
import taskChecklist from "../app/src/tasks/task-checklist.js";

const PRIORITIES = new Set(["low", "medium", "high"]);
const SCOPES = new Set(["occurrence", "following", "series"]);

export function updateTaskCommand(state, input, options = {}) {
  const before = clone(state);
  const nextState = prepareState(state);
  const requestId = normalizeRequestId(input.requestId);
  const previousActivity = findActivity(nextState, requestId);
  if (previousActivity) {
    const taskId = stripPrefix(input.taskId, "task");
    const task = nextState.tasks.find((item) => item.id === taskId)
      || nextState.tasks.find((item) => item.id === `mcp-${requestId}`)
      || { id: taskId, title: "Task", date: input.occurrenceDate || input.date || "" };
    return {
      changed: false,
      state: nextState,
      task,
      scope: SCOPES.has(input.scope) ? input.scope : "series",
      activity: previousActivity,
      summary: previousActivity.summary,
    };
  }
  const task = findTask(nextState, input.taskId);
  const occurrenceDate = task.repeat === "none" && task.date === null
    ? input.date ? normalizeDate(input.date) : null : normalizeDate(input.occurrenceDate || task.date);
  const scope = resolveScope(task, input.scope);
  const now = options.now || new Date().toISOString();
  let target = task;

  if (task.repeat !== "none" && scope === "occurrence") {
    assertOccurrence(task, occurrenceDate);
    task.excludedDates[occurrenceDate] = true;
    markTaskDateMeta(nextState, task.id, "excludedDates", occurrenceDate, now);
    target = createSplitTask(task, `mcp-${requestId}`, occurrenceDate, "none", now);
    nextState.tasks.push(target);
  } else if (task.repeat !== "none" && scope === "following" && occurrenceDate > task.date) {
    assertOccurrence(task, occurrenceDate);
    task.repeatUntil = previousDate(occurrenceDate);
    task.updatedAt = now;
    markEntityFields(nextState, "tasks", task.id, ["repeatUntil"], now);
    target = createSplitTask(task, `mcp-${requestId}`, occurrenceDate, input.repeat || task.repeat, now);
    target.repeatUntil = input.repeatUntil === undefined ? originalRepeatUntil(before, task.id) : target.repeatUntil;
    nextState.tasks.push(target);
  }

  const changedFields = applyTaskChanges(nextState, target, input, options, now);
  if (target.id === task.id && !changedFields.length) throw new Error("Не указано ни одного изменения задачи");
  target.updatedAt = now;
  if (target.id === task.id) markEntityFields(nextState, "tasks", target.id, changedFields, now);
  addTaskToOrder(nextState, target.date, target.id, now);
  reconcileLinkedGoals(nextState, now, options.today);
  const summary = `Задача «${target.title}» обновлена`;
  const activity = recordMcpActivity(before, nextState, {
    requestId,
    type: "update_task",
    title: "Изменение задачи",
    summary,
  }, now);
  return { changed: true, state: nextState, task: target, scope, activity, summary };
}

export function deleteTaskCommand(state, input, options = {}) {
  if (input.confirm !== true) throw new Error("Для удаления нужно явно передать confirm: true");
  const before = clone(state);
  const nextState = prepareState(state);
  const requestId = normalizeRequestId(input.requestId);
  const previousActivity = findActivity(nextState, requestId);
  if (previousActivity) {
    return {
      changed: false,
      state: nextState,
      taskId: stripPrefix(input.taskId, "task"),
      scope: SCOPES.has(input.scope) ? input.scope : "series",
      activity: previousActivity,
      summary: previousActivity.summary,
    };
  }
  const task = findTask(nextState, input.taskId);
  const occurrenceDate = task.repeat === "none" && task.date === null
    ? null : normalizeDate(input.occurrenceDate || task.date);
  const scope = resolveScope(task, input.scope);
  const now = options.now || new Date().toISOString();

  if (task.repeat !== "none" && scope === "occurrence") {
    assertOccurrence(task, occurrenceDate);
    task.excludedDates[occurrenceDate] = true;
    task.updatedAt = now;
    markTaskDateMeta(nextState, task.id, "excludedDates", occurrenceDate, now);
  } else if (task.repeat !== "none" && scope === "following" && occurrenceDate > task.date) {
    assertOccurrence(task, occurrenceDate);
    task.repeatUntil = previousDate(occurrenceDate);
    task.updatedAt = now;
    markEntityFields(nextState, "tasks", task.id, ["repeatUntil"], now);
  } else {
    nextState.tasks = nextState.tasks.filter((item) => item.id !== task.id);
    Object.keys(nextState.taskOrder).forEach((dateKey) => {
      nextState.taskOrder[dateKey] = nextState.taskOrder[dateKey].filter((id) => id !== task.id);
    });
    nextState.tombstones.tasks[task.id] = now;
  }

  const summary = scope === "occurrence"
    ? `Задача «${task.title}» удалена только за ${occurrenceDate}`
    : scope === "following"
      ? `Задача «${task.title}» удалена с ${occurrenceDate} и далее`
      : `Задача «${task.title}» удалена`;
  reconcileLinkedGoals(nextState, now, options.today);
  const activity = recordMcpActivity(before, nextState, {
    requestId,
    type: "delete_task",
    title: "Удаление задачи",
    summary,
  }, now);
  return { changed: true, state: nextState, taskId: task.id, scope, activity, summary };
}

export function setHabitValueCommand(state, input, options = {}) {
  const before = clone(state);
  const nextState = prepareState(state);
  const requestId = normalizeRequestId(input.requestId);
  const previousActivity = findActivity(nextState, requestId);
  if (previousActivity) {
    const habitId = stripPrefix(input.habitId, "habit");
    const habit = nextState.habits.find((item) => item.id === habitId)
      || { id: habitId, title: "Habit" };
    return {
      changed: false,
      state: nextState,
      habit,
      date: normalizeDate(input.date || options.today),
      activity: previousActivity,
      summary: previousActivity.summary,
    };
  }
  const habit = nextState.habits.find((item) => item.id === stripPrefix(input.habitId, "habit"));
  if (!habit) throw new Error("Привычка не найдена");
  const date = normalizeDate(input.date || options.today);
  const now = options.now || new Date().toISOString();
  const config = effectiveEntry(habit.configHistory, date) || habit;
  if (getTodayOverview(nextState, date).habits.find((item) => item.id === habit.id)?.frozen) {
    throw new Error("Привычка заморожена на этот день. Сначала снимите заморозку в приложении.");
  }
  habit.logs ||= {};
  if ((config.type || habit.type) === "number") {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0) throw new Error("Значение привычки должно быть неотрицательным числом");
    if (value === 0) delete habit.logs[date];
    else habit.logs[date] = value;
  } else if (input.completed === false) {
    delete habit.logs[date];
  } else {
    habit.logs[date] = true;
  }
  habit.updatedAt = now;
  (nextState.syncMeta.habitLogs[habit.id] ||= {})[date] = now;
  reconcileLinkedGoals(nextState, now, options.today || date);
  const summary = `Привычка «${habit.title}» обновлена за ${date}`;
  const activity = recordMcpActivity(before, nextState, {
    requestId,
    type: "set_habit_value",
    title: "Отметка привычки",
    summary,
  }, now);
  return { changed: true, state: nextState, habit, date, activity, summary };
}

export function createGoalCommand(state, input, options = {}) {
  const before = clone(state);
  const nextState = prepareState(state);
  const requestId = normalizeRequestId(input.requestId);
  const id = `mcp-goal-${requestId}`;
  const previousActivity = findActivity(nextState, requestId);
  const existing = nextState.goals.find((goal) => goal.id === id);
  if (previousActivity) {
    return {
      changed: false,
      state: nextState,
      goal: existing || { id, title: clean(input.title).slice(0, 200), steps: [] },
      created: false,
      activity: previousActivity,
      summary: previousActivity.summary,
    };
  }
  if (existing) return { changed: false, state: nextState, goal: existing, created: false };
  const now = options.now || new Date().toISOString();
  const title = clean(input.title).slice(0, 200);
  if (!title) throw new Error("Название цели не может быть пустым");
  const goal = {
    id,
    title,
    why: clean(input.why).slice(0, 500),
    dueDate: input.dueDate ? normalizeDate(input.dueDate) : "",
    steps: normalizeStepTitles(input.checkpoints).map((stepTitle, index) => ({
      id: `${id}-step-${index + 1}`,
      title: stepTitle,
      done: false,
    })),
    status: "active",
    completedAt: "",
    createdAt: now,
    updatedAt: now,
  };
  nextState.goals.push(goal);
  const summary = `Цель «${goal.title}» создана`;
  const activity = recordMcpActivity(before, nextState, {
    requestId,
    type: "create_goal",
    title: "Создание цели",
    summary,
  }, now);
  return { changed: true, state: nextState, goal, created: true, activity, summary };
}

export function updateGoalCheckpointCommand(state, input, options = {}) {
  if (input.action === "delete" && input.confirm !== true) {
    throw new Error("Для удаления чекпоинта нужно явно передать confirm: true");
  }
  const before = clone(state);
  const nextState = prepareState(state);
  const requestId = normalizeRequestId(input.requestId);
  const previousActivity = findActivity(nextState, requestId);
  if (previousActivity) {
    const goalId = stripPrefix(input.goalId, "goal");
    const goal = nextState.goals.find((item) => item.id === goalId)
      || { id: goalId, title: "Goal", steps: [] };
    const checkpoint = goal.steps?.find((item) => item.id === input.checkpointId)
      || goal.steps?.find((item) => item.id === `mcp-step-${requestId}`);
    return {
      changed: false,
      state: nextState,
      goal,
      checkpoint,
      activity: previousActivity,
      summary: previousActivity.summary,
    };
  }
  const goal = nextState.goals.find((item) => item.id === stripPrefix(input.goalId, "goal"));
  if (!goal) throw new Error("Цель не найдена");
  const now = options.now || new Date().toISOString();
  goal.steps = Array.isArray(goal.steps) ? goal.steps : [];
  let step = goal.steps.find((item) => item.id === input.checkpointId);

  if (input.action === "add") {
    const title = clean(input.title).slice(0, 200);
    if (!title) throw new Error("Название чекпоинта не может быть пустым");
    step = { id: `mcp-step-${requestId}`, title, done: false };
    goal.steps.push(step);
  } else {
    if (!step) throw new Error("Чекпоинт не найден");
    if (input.action === "rename") {
      const title = clean(input.title).slice(0, 200);
      if (!title) throw new Error("Название чекпоинта не может быть пустым");
      step.title = title;
    } else if (input.action === "complete") {
      step.done = input.completed !== false;
    } else if (input.action === "delete") {
      goal.steps = goal.steps.filter((item) => item.id !== step.id);
    }
  }

  const achieved = goalActivity.goalActivity(goal, nextState, {
    todayKey: options.today || now.slice(0, 10),
    habitStatusOnDate: linkedHabitStatusOnDate,
  }).achieved;
  goal.status = achieved ? "done" : "active";
  goal.completedAt = achieved ? goal.completedAt || now : "";
  goal.updatedAt = now;
  const changedStepId = step?.id || input.checkpointId;
  if (changedStepId) (nextState.syncMeta.goalSteps[goal.id] ||= {})[changedStepId] = now;
  nextState.syncMeta.goalStepOrder[goal.id] = now;
  markEntityFields(nextState, "goals", goal.id, ["title", "dueDate"], now);
  const summary = `Чекпоинты цели «${goal.title}» обновлены`;
  const activity = recordMcpActivity(before, nextState, {
    requestId,
    type: "update_goal_checkpoint",
    title: "Изменение цели",
    summary,
  }, now);
  return { changed: true, state: nextState, goal, checkpoint: step, activity, summary };
}

export function undoMcpCommand(state, input, options = {}) {
  const activity = state.mcpActivity?.find((item) => item.id === input.actionId);
  if (activity?.inverse?.entities?.journalEntries && state.profile?.journalAccess?.write === false) {
    throw new Error("Запись дневника запрещена владельцем аккаунта; это действие нельзя отменить через MCP");
  }
  return undoMcpActivity(state, String(input.actionId || ""), options.now || new Date().toISOString());
}

export function getDayBrief(state, date, mode = "plan") {
  const tasks = (state.tasks || [])
    .filter((task) => taskScheduledOn(task, date) && task.excludedDates?.[date] !== true)
    .map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority || "medium",
      completed: task.completed?.[date] === true,
      startTime: task.startTime || "",
      endTime: task.endTime || "",
      time: task.time || "",
    }));
  const overview = getTodayOverview(state, date);
  const habits = overview.habits;
  const conflicts = findTimelineConflicts(tasks);
  return {
    date,
    mode,
    tasks,
    habits,
    conflicts,
    summary: {
      totalTasks: tasks.length,
      completedTasks: tasks.filter((task) => task.completed).length,
      openHighPriority: tasks.filter((task) => !task.completed && task.priority === "high").length,
      timelineConflicts: conflicts.length,
      totalHabits: overview.summary.habitsTotal,
      completedHabits: overview.summary.habitsCompleted,
      frozenHabits: overview.summary.habitsFrozen,
      flexibleHabits: overview.summary.habitsFlexible,
    },
  };
}

function applyTaskChanges(state, task, input, options, now) {
  const changed = [];
  if (input.title !== undefined) {
    const title = clean(input.title).slice(0, 200);
    if (!title) throw new Error("Название задачи не может быть пустым");
    task.title = title;
    changed.push("title");
  }
  if (input.date !== undefined) {
    const previousDate = task.date;
    if (input.date === null) {
      if (task.repeat !== "none") throw new Error("Для переноса в «Позже» сначала отключите повтор выбранного выполнения");
      task.deferredFromDate = task.date || task.deferredFromDate || "";
      task.time = ""; task.startTime = ""; task.endTime = ""; task.scheduleMode = "none"; task.reminderOffset = "none";
      changed.push("deferredFromDate", "time", "startTime", "endTime", "scheduleMode", "reminderOffset");
    }
    task.date = input.date === null ? null : normalizeDate(input.date);
    changed.push("date");
    if (task.repeat === "none" && previousDate && task.date && task.date !== previousDate) {
      taskChecklist.moveDate(task, previousDate, task.date);
      if (task.completed?.[previousDate] === true) {
        delete task.completed[previousDate]; task.completed[task.date] = true;
        markTaskDateMeta(state, task.id, "completed", previousDate, now);
        markTaskDateMeta(state, task.id, "completed", task.date, now);
      }
      task.notified = {}; task.workNotified = {};
      if (Array.isArray(state.taskOrder[previousDate])) {
        state.taskOrder[previousDate] = state.taskOrder[previousDate].filter((id) => id !== task.id);
        state.syncMeta.taskOrder[previousDate] = now;
      }
      changed.push("checklistLogs", "notified", "workNotified");
    }
    if (task.deferredFromDate && task.date !== null) {
      const sourceDate = task.deferredFromDate;
      taskChecklist.moveDate(task, sourceDate, task.date);
      if (task.completed?.[sourceDate] === true) {
        delete task.completed[sourceDate];
        task.completed[task.date] = true;
      }
      task.deferredFromDate = "";
      changed.push("deferredFromDate", "completed", "checklistLogs");
    }
  }
  if (input.checklist !== undefined) {
    task.checklist = taskChecklist.normalizeItems(input.checklist);
    const ids = new Set(task.checklist.map((item) => item.id));
    Object.values(task.checklistLogs || {}).forEach((logs) => Object.keys(logs).forEach((id) => { if (!ids.has(id)) delete logs[id]; }));
    changed.push("checklist", "checklistLogs");
  }
  if (input.dueDate !== undefined) {
    task.dueDate = input.dueDate ? normalizeDate(input.dueDate) : ""; changed.push("dueDate");
    if (!task.dueDate) { task.dueTime = ""; task.dueReminderOffset = "none"; changed.push("dueTime", "dueReminderOffset"); }
  }
  if (input.dueTime !== undefined) { task.dueTime = input.dueTime ? normalizeTime(input.dueTime) : ""; changed.push("dueTime"); }
  if (input.dueReminderOffset !== undefined) { task.dueReminderOffset = input.dueReminderOffset; changed.push("dueReminderOffset"); }
  if ((task.dueTime || "") && !task.dueDate) throw new Error("Для времени сдачи нужна дата сдачи");
  if (input.priority !== undefined) {
    if (!PRIORITIES.has(input.priority)) throw new Error("Неизвестный приоритет");
    task.priority = input.priority;
    changed.push("priority");
  }
  if (input.category !== undefined) {
    const category = ensureCategory(state, input.category, now, options.requestId || input.requestId);
    task.categoryId = category?.id || "";
    changed.push("categoryId");
  }
  if (input.scheduleMode !== undefined || input.time !== undefined || input.startTime !== undefined || input.endTime !== undefined) {
    applySchedule(task, input);
    changed.push("time", "scheduleMode", "startTime", "endTime", "reminderOffset");
  }
  if (input.reminderOffset !== undefined) {
    task.reminderOffset = String(input.reminderOffset);
    changed.push("reminderOffset");
  }
  if (input.repeat !== undefined) {
    if (!new Set(["none", "daily", "every2days", "every3days", "weekdays", "weekends", "weekly", "monthly", "yearly", "custom"]).has(input.repeat)) {
      throw new Error("Неизвестный тип повтора");
    }
    task.repeat = input.repeat;
    changed.push("repeat");
  }
  if (input.customRepeat !== undefined) {
    task.customRepeat = normalizeCustomRepeat(input.customRepeat);
    changed.push("customRepeat");
  }
  if (input.repeatUntil !== undefined) {
    task.repeatUntil = input.repeatUntil ? normalizeDate(input.repeatUntil) : "";
    changed.push("repeatUntil");
  }
  if (task.date === null && (task.repeat !== "none" || task.time || task.startTime || task.endTime || (task.reminderOffset || "none") !== "none")) {
    throw new Error("Сначала назначь дату задаче из списка «Позже», затем настрой время, повтор или напоминание");
  }
  return [...new Set(changed)];
}

function applySchedule(task, input) {
  const mode = input.scheduleMode || (input.startTime || input.endTime ? "block" : input.time ? "deadline" : "none");
  if (mode === "none") {
    Object.assign(task, { scheduleMode: "none", time: "", startTime: "", endTime: "", reminderOffset: "none" });
    return;
  }
  if (mode === "deadline") {
    const time = normalizeTime(input.time);
    if (!time) throw new Error("Для дедлайна нужно указать time");
    Object.assign(task, { scheduleMode: "deadline", time, startTime: "", endTime: "" });
    return;
  }
  const startTime = normalizeTime(input.startTime);
  const endTime = normalizeTime(input.endTime);
  if (!startTime || !endTime || toMinutes(endTime) <= toMinutes(startTime)) {
    throw new Error("Для временного блока нужны корректные startTime и endTime");
  }
  if (toMinutes(startTime) % 15 || toMinutes(endTime) % 15) {
    throw new Error("Временной блок должен использовать шаг 15 минут");
  }
  Object.assign(task, { scheduleMode: "block", time: endTime, startTime, endTime });
}

function createSplitTask(task, id, date, repeat, now) {
  return {
    ...clone(task),
    id,
    date,
    repeat,
    completed: pickDated(task.completed, date, repeat !== "none"),
    acknowledgedOverdue: pickDated(task.acknowledgedOverdue, date, repeat !== "none"),
    excludedDates: {},
    notified: {},
    sourceTaskId: task.id,
    movedFromDate: date,
    createdAt: now,
    updatedAt: now,
  };
}

function pickDated(values, fromDate, includeFollowing) {
  return Object.fromEntries(Object.entries(values || {}).filter(([date]) => includeFollowing ? date >= fromDate : date === fromDate));
}

function originalRepeatUntil(state, taskId) {
  return state.tasks?.find((task) => task.id === taskId)?.repeatUntil || "";
}

function resolveScope(task, scope) {
  if (task.repeat === "none") return "series";
  if (!SCOPES.has(scope)) throw new Error("Для повторяющейся задачи укажи scope: occurrence, following или series");
  return scope;
}

function assertOccurrence(task, date) {
  if (!taskScheduledOn(task, date) || task.excludedDates?.[date] === true) {
    throw new Error("На выбранную дату у серии нет активного повторения");
  }
}

function prepareState(state) {
  const next = documentState.ensureDocumentShape(clone(state));
  next.tasks.forEach((task) => {
    if (task && typeof task === "object") task.excludedDates ||= {};
  });
  return next;
}

function findTask(state, id) {
  const task = state.tasks.find((item) => item.id === stripPrefix(id, "task"));
  if (!task) throw new Error("Задача не найдена");
  return task;
}

function findActivity(state, requestId) {
  return state.mcpActivity.find((activity) => activity?.requestId === requestId);
}

function addTaskToOrder(state, date, taskId, now) {
  if (!date) return;
  const order = new Set(state.taskOrder[date] || []);
  order.add(taskId);
  state.taskOrder[date] = [...order];
  state.syncMeta.taskOrder[date] = now;
}

function markEntityFields(state, type, id, fields, now) {
  const versions = (((state.syncMeta.entityFields[type] ||= {})[id] ||= {}));
  fields.forEach((field) => {
    versions[field] = now;
  });
}

function markTaskDateMeta(state, taskId, field, date, now) {
  (((state.syncMeta.taskFields[taskId] ||= {})[field] ||= {}))[date] = now;
}

function ensureCategory(state, value, now, requestId) {
  const name = clean(value).slice(0, 60);
  if (!name) return null;
  const existing = state.categories.find((category) => clean(category.name).toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const category = {
    id: `mcp-category-${normalizeRequestId(requestId)}`,
    name,
    color: "#4f8cff",
    createdAt: now,
    updatedAt: now,
  };
  state.categories.push(category);
  return category;
}

function findTimelineConflicts(tasks) {
  const blocks = tasks
    .filter((task) => task.startTime && task.endTime)
    .sort((left, right) => left.startTime.localeCompare(right.startTime));
  const conflicts = [];
  for (let index = 0; index < blocks.length; index += 1) {
    for (let other = index + 1; other < blocks.length; other += 1) {
      if (blocks[other].startTime >= blocks[index].endTime) break;
      conflicts.push([blocks[index].id, blocks[other].id]);
    }
  }
  return conflicts;
}

function normalizeStepTitles(value) {
  return (Array.isArray(value) ? value : []).map(clean).filter(Boolean).slice(0, 50);
}

function effectiveEntry(history, date) {
  return (Array.isArray(history) ? history : [])
    .filter((entry) => entry?.fromDate && entry.fromDate <= date)
    .sort((left, right) => left.fromDate.localeCompare(right.fromDate))
    .at(-1);
}

function linkedHabitStatusOnDate(habit, date) {
  return habitSchedule.statusOnDate(habit, date);
}

function reconcileLinkedGoals(state, now, todayKey) {
  goalActivity.reconcileGoalStatuses(state, {
    now,
    todayKey: todayKey || now.slice(0, 10),
    habitStatusOnDate: linkedHabitStatusOnDate,
  });
}

function normalizeRequestId(value) {
  const id = clean(value);
  if (!/^[a-zA-Z0-9._:-]{8,100}$/.test(id)) {
    throw new Error("requestId должен быть уникальной строкой длиной 8–100 символов");
  }
  return id;
}

function normalizeDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error("Дата должна быть в формате YYYY-MM-DD");
  }
  return text;
}

function previousDate(value) {
  const date = new Date(`${normalizeDate(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function normalizeTime(value) {
  const text = String(value || "");
  if (!text) return "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error("Время должно быть в формате HH:mm");
  return text;
}

function toMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function stripPrefix(value, prefix) {
  return String(value || "").replace(new RegExp(`^${prefix}:`), "");
}

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function clone(value) {
  return structuredClone(value || {});
}
