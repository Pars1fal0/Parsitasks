import recurrence from "../app/src/tasks/recurrence.js";
import habitSchedule from "../app/src/habits/habit-schedule.js";
import taskChecklist from "../app/src/tasks/task-checklist.js";
import goalActivity from "../app/src/goals/goal-activity.js";
import documentState from "../app/src/core/document-state.js";
import studyModel from "../app/src/study/study-model.js";

export const normalizeCustomRepeat = recurrence.normalizeCustomRepeat;

const PRIORITIES = new Set(["low", "medium", "high"]);
const REPEATS = new Set(["none", "daily", "every2days", "every3days", "weekdays", "weekends", "weekly", "monthly", "yearly", "custom"]);
const CATEGORY_COLORS = ["#19b394", "#4f8cff", "#f59e0b", "#e96b75", "#8b7cf6", "#2ca6a4"];

export function createEmptyState() {
  return documentState.createEmptyState();
}

export function getTodayOverview(state, dateKey) {
  const categories = categoryMap(state);
  const tasks = tasksForDate(state, dateKey).map((task) => serializeTask(task, dateKey, categories));
  const habits = habitsForDate(state, dateKey).map((habit) => serializeHabit(habit, dateKey));
  const goals = (Array.isArray(state?.goals) ? state.goals : [])
    .filter((goal) => goal.status !== "done")
    .map((goal) => serializeGoal(goal, state, dateKey));

  return {
    date: dateKey,
    tasks,
    habits,
    lessons: studyModel.eventsForDate(state, dateKey),
    deadlines: (state.tasks || []).filter((task) => task.dueDate === dateKey).map((task) => ({ taskId: task.id, title: task.title,
      workDate: task.date, dueDate: task.dueDate, dueTime: task.dueTime || "", completed: task.completed?.[task.date || task.dueDate] === true })),
    activeGoals: goals,
    summary: {
      tasksTotal: tasks.length,
      tasksCompleted: tasks.filter((task) => task.completed).length,
      habitsTotal: habits.filter((habit) => ["complete", "missed"].includes(habit.status)).length,
      habitsFlexible: habits.filter((habit) => habit.weeklyProgress).length,
      habitsCompleted: habits.filter((habit) => habit.completed).length,
      habitsFrozen: habits.filter((habit) => habit.frozen).length,
      goalsTotal: goals.length,
    },
  };
}

export function searchKnowledge(state, query, options = {}) {
  const normalizedQuery = cleanText(query).toLocaleLowerCase("ru-RU");
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const limit = clampInteger(options.limit, 1, 50, 20);
  const baseUrl = cleanText(options.baseUrl).replace(/\/+$/, "");
  const categories = categoryMap(state);
  const results = [];

  for (const task of Array.isArray(state?.tasks) ? state.tasks : []) {
    const category = categories.get(task.categoryId)?.name || "";
    const text = [task.title, task.date, task.time, task.startTime, task.endTime, task.priority, category].join(" ");
    if (matchesTokens(text, tokens)) {
      results.push({
        id: `task:${task.id}`,
        title: task.title || "Задача",
        url: `${baseUrl}/#tasks`,
        type: "task",
      });
    }
  }

  for (const habit of Array.isArray(state?.habits) ? state.habits : []) {
    if (matchesTokens(habit.title, tokens)) {
      results.push({
        id: `habit:${habit.id}`,
        title: habit.title || "Привычка",
        url: `${baseUrl}/#habits`,
        type: "habit",
      });
    }
  }

  for (const goal of Array.isArray(state?.goals) ? state.goals : []) {
    const text = [goal.title, goal.why, ...(goal.steps || []).map((step) => step.title)].join(" ");
    if (matchesTokens(text, tokens)) {
      results.push({
        id: `goal:${goal.id}`,
        title: goal.title || "Цель",
        url: `${baseUrl}/#goals`,
        type: "goal",
      });
    }
  }

  for (const entry of Array.isArray(state?.journalEntries) ? state.journalEntries : []) {
    if (state?.profile?.journalAccess?.read === false) continue;
    if (entry?.text && matchesTokens(`${entry.date} ${entry.text}`, tokens)) {
      results.push({
        id: `journal:${entry.id}`,
        title: `Дневник за ${entry.date}`,
        url: `${baseUrl}/#journal`,
        type: "journal",
      });
    }
  }

  const subjects = new Map((state.studySubjects || []).map((item) => [item.id, item.name]));
  const extraTypes = { note: "notes", board: "boardItems", subject: "studySubjects", lesson: "studyLessons", material: "studyFiles", category: "categories" };
  for (const [type, collection] of Object.entries(extraTypes)) {
    for (const item of state[collection] || []) {
      const title = item.title || item.name || (type === "lesson" ? subjects.get(item.subjectId) : item.text) || type;
      if (!matchesTokens([title, item.body, item.text, item.teacher, item.room, subjects.get(item.subjectId)].join(" "), tokens)) continue;
      results.push({ id: `${type}:${item.id}`, title: String(title).slice(0, 200), type,
        url: `${baseUrl}/app#${type === "note" ? "journal" : type === "board" ? "board" : type === "category" ? "tasks" : "study"}` });
    }
  }
  const score = (item) => tokens.reduce((total, token) => total + (item.title.toLocaleLowerCase("ru").includes(token) ? 1 : 0), 0);
  return { results: results.filter((item) => !options.types || options.types.includes(item.type))
    .sort((a, b) => score(b) - score(a)).slice(0, limit) };
}

export function fetchKnowledge(state, compoundId, options = {}) {
  const separator = String(compoundId || "").indexOf(":");
  const type = String(compoundId || "").slice(0, separator);
  const id = String(compoundId || "").slice(separator + 1);
  const baseUrl = cleanText(options.baseUrl).replace(/\/+$/, "");
  const extraTypes = { note: "notes", board: "boardItems", subject: "studySubjects", lesson: "studyLessons", material: "studyFiles", category: "categories" };
  if (id && extraTypes[type]) {
    const item = (state[extraTypes[type]] || []).find((entry) => entry.id === id);
    if (!item) return null;
    return { id: compoundId, title: String(item.title || item.name || item.text || type).slice(0, 200), text: JSON.stringify(item),
      url: `${baseUrl}/app#${type === "note" ? "journal" : type === "board" ? "board" : type === "category" ? "tasks" : "study"}`, metadata: { type } };
  }
  if (!id || !["task", "habit", "goal", "journal"].includes(type)) return null;

  if (type === "task") {
    const task = (state.tasks || []).find((item) => item.id === id);
    if (!task) return null;
    const category = categoryMap(state).get(task.categoryId)?.name || "";
    return {
      id: compoundId,
      title: task.title || "Задача",
      text: JSON.stringify({
        ...serializeTask(task, task.date, categoryMap(state)),
        repeat: task.repeat || "none",
        repeatUntil: task.repeatUntil || "",
        category,
      }),
      url: `${baseUrl}/#tasks`,
      metadata: { type: "task" },
    };
  }

  if (type === "habit") {
    const habit = (state.habits || []).find((item) => item.id === id);
    if (!habit) return null;
    return {
      id: compoundId,
      title: habit.title || "Привычка",
      text: JSON.stringify({
        title: habit.title,
        type: habit.type || "check",
        goal: habit.goal || 1,
        unit: habit.unit || "",
        repeat: habit.repeat || "daily",
        archived: habit.archived === true,
      }),
      url: `${baseUrl}/#habits`,
      metadata: { type: "habit" },
    };
  }

  if (type === "journal") {
    if (state?.profile?.journalAccess?.read === false) return null;
    const entry = (state.journalEntries || []).find((item) => item.id === id);
    if (!entry) return null;
    return {
      id: compoundId,
      title: `Дневник за ${entry.date}`,
      text: entry.text || "",
      url: `${baseUrl}/#journal`,
      metadata: { type: "journal", date: entry.date },
    };
  }

  const goal = (state.goals || []).find((item) => item.id === id);
  if (!goal) return null;
  return {
    id: compoundId,
    title: goal.title || "Цель",
    text: JSON.stringify(serializeGoal(goal, state, options.today || new Date().toISOString().slice(0, 10))),
    url: `${baseUrl}/#goals`,
    metadata: { type: "goal" },
  };
}

export function createTaskCommand(state, input, options = {}) {
  const nextState = cloneState(state);
  ensureStateShape(nextState);
  const requestId = normalizeRequestId(input.requestId);
  const taskId = `mcp-${requestId}`;
  const existing = nextState.tasks.find((task) => task.id === taskId);
  const previousActivity = nextState.mcpActivity.find((activity) => activity?.requestId === requestId);
  if (previousActivity) {
    return {
      changed: false,
      state: nextState,
      task: existing || {
        id: taskId,
        title: cleanText(input.title).slice(0, 200) || "Task",
        date: input.date || options.today || "",
      },
      created: false,
      activity: previousActivity,
    };
  }
  if (existing) return { changed: false, state: nextState, task: existing, created: false };

  const now = options.now || new Date().toISOString();
  const date = input.date === null ? null : normalizeDateKey(input.date || options.today);
  const title = cleanText(input.title).slice(0, 200);
  if (!title) throw new Error("Название задачи не может быть пустым");

  const schedule = normalizeSchedule(input);
  const category = ensureCategory(nextState, input.category, now, requestId);
  const task = {
    id: taskId,
    title,
    date,
    time: schedule.time,
    scheduleMode: schedule.mode,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    categoryId: category?.id || "",
    priority: PRIORITIES.has(input.priority) ? input.priority : "medium",
    repeat: REPEATS.has(input.repeat) ? input.repeat : "none",
    repeatUntil: input.repeatUntil ? normalizeDateKey(input.repeatUntil) : "",
    sourceTaskId: "",
    movedFromDate: "",
    customRepeat: normalizeCustomRepeat(input.customRepeat),
    reminderOffset: schedule.mode === "none" ? "none" : normalizeReminder(input.reminderOffset),
    completed: {},
    acknowledgedOverdue: {},
    excludedDates: {},
    notified: {},
    createdAt: now,
    updatedAt: now,
    dueDate: input.dueDate ? normalizeDateKey(input.dueDate) : "",
    dueTime: input.dueTime ? normalizeTime(input.dueTime) : "",
    dueReminderOffset: input.dueReminderOffset || "none",
    checklist: taskChecklist.normalizeItems((input.checklist || []).map((title, index) => ({ id: `mcp-sub-${requestId.slice(0, 80)}-${index}`, title }))),
    checklistLogs: {},
  };

  if (task.dueTime && !task.dueDate) throw new Error("Для времени сдачи нужна дата сдачи");
  if (date === null && (task.repeat !== "none" || schedule.mode !== "none")) throw new Error("Задаче в «Позже» нельзя назначить повтор или время работы без даты");

  if (task.repeatUntil && task.repeatUntil < task.date) {
    throw new Error("Дата окончания повтора не может быть раньше даты задачи");
  }

  nextState.tasks.push(task);
  if (date) {
    const order = new Set(Array.isArray(nextState.taskOrder[date]) ? nextState.taskOrder[date] : []);
    order.add(task.id);
    nextState.taskOrder[date] = [...order];
    nextState.syncMeta.taskOrder[date] = now;
  }
  return { changed: true, state: nextState, task, created: true };
}

export function completeTaskCommand(state, input, options = {}) {
  const nextState = cloneState(state);
  ensureStateShape(nextState);
  const task = nextState.tasks.find((item) => item.id === cleanText(input.taskId));
  if (!task) throw new Error("Задача не найдена");

  const date = normalizeDateKey(input.date || options.today);
  if (!taskScheduledOn(task, date) || task.excludedDates?.[date] === true) {
    throw new Error("На выбранную дату у этой задачи нет активного выполнения");
  }

  const completed = input.completed !== false;
  const wasCompleted = task.completed?.[date] === true;
  if (wasCompleted === completed) {
    return { changed: false, state: nextState, task, date, completed };
  }

  const now = options.now || new Date().toISOString();
  task.completed ||= {};
  if (completed) task.completed[date] = true;
  else delete task.completed[date];
  task.updatedAt = now;
  (((nextState.syncMeta.taskFields[task.id] ||= {}).completed ||= {}))[date] = now;
  goalActivity.reconcileGoalStatuses(nextState, {
    now,
    todayKey: options.today || date,
    habitStatusOnDate: (habit, day) => linkedHabitStatusOnDate(nextState, habit, day),
  });
  return { changed: true, state: nextState, task, date, completed };
}

export function tasksForDate(state, dateKey) {
  const normalizedDate = normalizeDateKey(dateKey);
  const order = new Map((state?.taskOrder?.[normalizedDate] || []).map((id, index) => [id, index]));
  return (Array.isArray(state?.tasks) ? state.tasks : [])
    .filter((task) => taskScheduledOn(task, normalizedDate) && task.excludedDates?.[normalizedDate] !== true)
    .sort((left, right) => {
      const orderDiff = (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER);
      if (orderDiff) return orderDiff;
      return taskSortTime(left).localeCompare(taskSortTime(right)) || String(left.title).localeCompare(String(right.title), "ru");
    });
}

export function taskScheduledOn(task, dateKey) {
  if (!task?.date || !dateKey) return false;
  const repeat = REPEATS.has(task.repeat) ? task.repeat : "none";
  if (repeat === "none") return task.date === dateKey;
  if (task.repeatUntil && dateKey > task.repeatUntil) return false;

  const date = parseDate(dateKey);
  const start = parseDate(task.date);
  if (!date || !start || date < start) return false;
  const diff = Math.floor((date - start) / 86400000);
  if (repeat === "daily") return true;
  if (repeat === "every2days") return diff % 2 === 0;
  if (repeat === "every3days") return diff % 3 === 0;
  if (repeat === "weekdays") return ![0, 6].includes(date.getUTCDay());
  if (repeat === "weekends") return [0, 6].includes(date.getUTCDay());
  if (repeat === "weekly") return date.getUTCDay() === start.getUTCDay();
  if (repeat === "monthly") return date.getUTCDate() === start.getUTCDate();
  if (repeat === "yearly") {
    return date.getUTCDate() === start.getUTCDate() && date.getUTCMonth() === start.getUTCMonth();
  }
  if (repeat === "custom") {
    const custom = task.customRepeat && typeof task.customRepeat === "object" ? task.customRepeat : {};
    if (custom.type === "weekdays") {
      const weekdays = Array.isArray(custom.weekdays) ? custom.weekdays.map(Number) : [];
      return weekdays.includes(date.getUTCDay());
    }
    if (custom.type === "monthDay") return date.getUTCDate() === clampInteger(custom.day, 1, 31, 1);
    if (custom.type === "interval") return diff % clampInteger(custom.every, 1, 365, 2) === 0;
  }
  return false;
}

export function toDateKey(date = new Date(), timeZone = "Europe/Moscow") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function stateTimeZone(state, fallback = "Europe/Moscow") {
  return normalizeTimeZone(state?.profile?.timeZone || fallback);
}

function habitsForDate(state, dateKey) {
  return (Array.isArray(state?.habits) ? state.habits : []).filter((habit) => {
    const availability = effectiveHistoryEntry(habit.availabilityHistory, dateKey);
    if (availability ? availability.active === false : habit.archived === true) return false;
    return habitSchedule.occursOn(habit, dateKey);
  });
}

function effectiveHistoryEntry(history, dateKey) {
  return (Array.isArray(history) ? history : [])
    .filter((entry) => entry?.fromDate && entry.fromDate <= dateKey)
    .sort((left, right) => left.fromDate.localeCompare(right.fromDate) || String(left.updatedAt).localeCompare(String(right.updatedAt)))
    .at(-1);
}

function serializeTask(task, dateKey, categories) {
  return {
    id: task.id,
    title: task.title,
    date: dateKey,
    deferred: task.date === null,
    scheduleMode: task.scheduleMode || (task.time ? "deadline" : "none"),
    time: task.time || "",
    startTime: task.startTime || "",
    endTime: task.endTime || "",
    dueDate: task.dueDate || "",
    dueTime: task.dueTime || "",
    dueReminderOffset: task.dueReminderOffset || "none",
    reminderOffset: task.reminderOffset || "none",
    categoryId: task.categoryId || "",
    sourceNoteId: task.sourceNoteId || "",
    studySubjectId: task.studySubjectId || "",
    studyDetails: task.studyDetails || "",
    studyFileIds: task.studyFileIds || [],
    priority: task.priority || "medium",
    category: categories.get(task.categoryId)?.name || "",
    completed: task.completed?.[dateKey] === true,
    repeat: task.repeat || "none",
    checklist: (task.checklist || []).map((item) => ({ ...item, done: task.checklistLogs?.[dateKey]?.[item.id]?.done === true })),
    checklistProgress: taskChecklist.progress(task, dateKey),
  };
}

function serializeHabit(habit, dateKey) {
  const config = effectiveHistoryEntry(habit.configHistory, dateKey) || habit;
  const value = habit.logs?.[dateKey];
  const completed = config.type === "number"
    ? Number(value || 0) >= Number(config.goal || 1)
    : value === true;
  const status = habitSchedule.statusOnDate(habit, dateKey);
  return {
    id: habit.id,
    title: effectiveHistoryEntry(habit.titleHistory, dateKey)?.title || habit.title,
    type: config.type || habit.type || "check",
    goal: Number(config.goal || habit.goal || 1),
    unit: config.unit || habit.unit || "",
    value: value || 0,
    completed,
    frozen: status === "frozen",
    status,
    reminderTime: habit.reminderTime || "",
    numberStep: config.numberStep || habit.numberStep || 0,
    weeklyProgress: habitSchedule.weekProgress(habit, dateKey, dateKey),
  };
}

function serializeGoal(goal, state, todayKey) {
  const steps = Array.isArray(goal.steps) ? goal.steps : [];
  const progress = goalActivity.goalActivity(goal, state, {
    todayKey,
    habitStatusOnDate: (habit, day) => linkedHabitStatusOnDate(state, habit, day),
  }).percent;
  return {
    id: goal.id,
    title: goal.title,
    dueDate: goal.dueDate || "",
    why: goal.why || "",
    status: goal.status || "active",
    paused: goal.paused === true,
    archived: goal.archived === true,
    progress,
    steps: steps.map((step) => ({ id: step.id, title: step.title, done: step.done === true })),
    linkedTaskIds: goal.linkedTaskIds || [],
    habitTargets: goal.habitTargets || [],
    taskTargets: goal.taskTargets || [],
  };
}

function linkedHabitStatusOnDate(state, habit, day) {
  return habitsForDate(state, day).some((item) => item.id === habit.id)
    ? serializeHabit(habit, day).status
    : "not-due";
}

function ensureCategory(state, name, now, requestId) {
  const normalizedName = cleanText(name).slice(0, 60);
  if (!normalizedName) return null;
  const existing = state.categories.find(
    (category) => String(category.name || "").toLocaleLowerCase("ru-RU") === normalizedName.toLocaleLowerCase("ru-RU"),
  );
  if (existing) return existing;
  const category = {
    id: `mcp-category-${requestId}`,
    name: normalizedName,
    color: CATEGORY_COLORS[state.categories.length % CATEGORY_COLORS.length],
    createdAt: now,
    updatedAt: now,
  };
  state.categories.push(category);
  return category;
}

function normalizeSchedule(input) {
  const startTime = normalizeTime(input.startTime);
  const endTime = normalizeTime(input.endTime);
  const deadlineTime = normalizeTime(input.time);
  if (startTime || endTime) {
    if (!startTime || !endTime || timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      throw new Error("Для временного блока нужны корректные startTime и endTime");
    }
    if (timeToMinutes(startTime) % 15 || timeToMinutes(endTime) % 15) {
      throw new Error("Временной блок должен начинаться и заканчиваться с шагом 15 минут");
    }
    return { mode: "block", time: endTime, startTime, endTime };
  }
  if (deadlineTime) return { mode: "deadline", time: deadlineTime, startTime: "", endTime: "" };
  return { mode: "none", time: "", startTime: "", endTime: "" };
}

function normalizeReminder(value) {
  const normalized = String(value ?? "15");
  return new Set(["none", "0", "5", "15", "30", "60", "1440"]).has(normalized) ? normalized : "15";
}

function ensureStateShape(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Состояние приложения повреждено");
  documentState.ensureDocumentShape(state);
}

function normalizeTimeZone(value) {
  const candidate = String(value || "Europe/Moscow");
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "Europe/Moscow";
  }
}

function categoryMap(state) {
  return new Map((Array.isArray(state?.categories) ? state.categories : []).map((category) => [category.id, category]));
}

function cloneState(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value || createEmptyState())
    : JSON.parse(JSON.stringify(value || createEmptyState()));
}

function matchesTokens(value, tokens) {
  const haystack = String(value || "").toLocaleLowerCase("ru-RU");
  return tokens.every((token) => haystack.includes(token));
}

function taskSortTime(task) {
  return normalizeTime(task.startTime) || normalizeTime(task.time) || "99:99";
}

function normalizeRequestId(value) {
  const id = cleanText(value);
  if (!/^[a-zA-Z0-9._:-]{8,100}$/.test(id)) {
    throw new Error("requestId должен быть уникальной строкой длиной 8–100 символов");
  }
  return id;
}

function normalizeDateKey(value) {
  const text = String(value || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error("Дата должна быть в формате YYYY-MM-DD");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error("Указана несуществующая дата");
  }
  return text;
}

function parseDate(value) {
  try {
    const [year, month, day] = normalizeDateKey(value).split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  } catch {
    return null;
  }
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error("Время должно быть в формате HH:mm");
  return text;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  return hours * 60 + minutes;
}

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
