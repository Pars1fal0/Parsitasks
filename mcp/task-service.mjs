import recurrence from "../src/tasks/recurrence.js";

export const normalizeCustomRepeat = recurrence.normalizeCustomRepeat;

const PRIORITIES = new Set(["low", "medium", "high"]);
const REPEATS = new Set(["none", "daily", "every2days", "every3days", "weekdays", "weekends", "weekly", "monthly", "yearly", "custom"]);
const CATEGORY_COLORS = ["#19b394", "#4f8cff", "#f59e0b", "#e96b75", "#8b7cf6", "#2ca6a4"];

export function createEmptyState() {
  return {
    schemaVersion: 15,
    defaultsSeeded: false,
    profile: { timeZone: "Europe/Moscow" },
    tasks: [],
    habits: [],
    goals: [],
    journalEntries: [],
    nutritionFoods: [],
    nutritionMeals: [],
    nutritionTemplates: [],
    nutritionSettings: { targets: { calories: 0, protein: 0, fat: 0, carbs: 0 }, paused: false, updatedAt: "" },
    googleCalendarLinks: {},
    categories: [],
    taskOrder: {},
    mcpActivity: [],
    tombstones: {
      tasks: {}, habits: {}, goals: {}, journalEntries: {}, categories: {},
      nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {},
    },
    syncMeta: emptySyncMeta(),
  };
}

export function getTodayOverview(state, dateKey) {
  const categories = categoryMap(state);
  const tasks = tasksForDate(state, dateKey).map((task) => serializeTask(task, dateKey, categories));
  const habits = habitsForDate(state, dateKey).map((habit) => serializeHabit(habit, dateKey));
  const goals = (Array.isArray(state?.goals) ? state.goals : [])
    .filter((goal) => goal.status !== "done")
    .map(serializeGoal);

  return {
    date: dateKey,
    tasks,
    habits,
    activeGoals: goals,
    summary: {
      tasksTotal: tasks.length,
      tasksCompleted: tasks.filter((task) => task.completed).length,
      habitsTotal: habits.length,
      habitsCompleted: habits.filter((habit) => habit.completed).length,
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
    if (entry?.text && matchesTokens(`${entry.date} ${entry.text}`, tokens)) {
      results.push({
        id: `journal:${entry.id}`,
        title: `Дневник за ${entry.date}`,
        url: `${baseUrl}/#journal`,
        type: "journal",
      });
    }
  }

  return { results: results.slice(0, limit) };
}

export function fetchKnowledge(state, compoundId, options = {}) {
  const [type, id] = String(compoundId || "").split(":");
  const baseUrl = cleanText(options.baseUrl).replace(/\/+$/, "");
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
    text: JSON.stringify(serializeGoal(goal)),
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
  const date = normalizeDateKey(input.date || options.today);
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
  };

  if (task.repeatUntil && task.repeatUntil < task.date) {
    throw new Error("Дата окончания повтора не может быть раньше даты задачи");
  }

  nextState.tasks.push(task);
  const order = new Set(Array.isArray(nextState.taskOrder[date]) ? nextState.taskOrder[date] : []);
  order.add(task.id);
  nextState.taskOrder[date] = [...order];
  nextState.syncMeta.taskOrder[date] = now;
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
  if (!task || !dateKey) return false;
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
    const config = effectiveHistoryEntry(habit.configHistory, dateKey) || habit;
    return taskScheduledOn({
      date: habit.startDate || dateKey,
      repeat: config.repeat || habit.repeat || "daily",
      repeatUntil: "",
      customRepeat: config.customRepeat || habit.customRepeat,
    }, dateKey);
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
    scheduleMode: task.scheduleMode || (task.time ? "deadline" : "none"),
    time: task.time || "",
    startTime: task.startTime || "",
    endTime: task.endTime || "",
    priority: task.priority || "medium",
    category: categories.get(task.categoryId)?.name || "",
    completed: task.completed?.[dateKey] === true,
    repeat: task.repeat || "none",
  };
}

function serializeHabit(habit, dateKey) {
  const config = effectiveHistoryEntry(habit.configHistory, dateKey) || habit;
  const value = habit.logs?.[dateKey];
  const completed = config.type === "number"
    ? Number(value || 0) >= Number(config.goal || 1)
    : value === true;
  return {
    id: habit.id,
    title: effectiveHistoryEntry(habit.titleHistory, dateKey)?.title || habit.title,
    type: config.type || habit.type || "check",
    goal: Number(config.goal || habit.goal || 1),
    unit: config.unit || habit.unit || "",
    value: value || 0,
    completed,
  };
}

function serializeGoal(goal) {
  const steps = Array.isArray(goal.steps) ? goal.steps : [];
  const completedSteps = steps.filter((step) => step.done === true).length;
  return {
    id: goal.id,
    title: goal.title,
    dueDate: goal.dueDate || "",
    why: goal.why || "",
    status: goal.status || "active",
    progress: steps.length ? Math.round((completedSteps / steps.length) * 100) : 0,
    steps: steps.map((step) => ({ id: step.id, title: step.title, done: step.done === true })),
  };
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
  state.schemaVersion = Number(state.schemaVersion) || 14;
  state.profile = state.profile && typeof state.profile === "object" ? state.profile : {};
  state.profile.timeZone = normalizeTimeZone(state.profile.timeZone);
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.habits = Array.isArray(state.habits) ? state.habits : [];
  state.goals = Array.isArray(state.goals) ? state.goals : [];
  state.journalEntries = Array.isArray(state.journalEntries) ? state.journalEntries : [];
  state.nutritionFoods = Array.isArray(state.nutritionFoods) ? state.nutritionFoods : [];
  state.nutritionMeals = Array.isArray(state.nutritionMeals) ? state.nutritionMeals : [];
  state.nutritionTemplates = Array.isArray(state.nutritionTemplates) ? state.nutritionTemplates : [];
  state.nutritionSettings = state.nutritionSettings && typeof state.nutritionSettings === "object"
    ? state.nutritionSettings
    : { targets: { calories: 0, protein: 0, fat: 0, carbs: 0 }, paused: false, updatedAt: "" };
  state.categories = Array.isArray(state.categories) ? state.categories : [];
  state.taskOrder = state.taskOrder && typeof state.taskOrder === "object" ? state.taskOrder : {};
  state.mcpActivity = Array.isArray(state.mcpActivity) ? state.mcpActivity : [];
  state.tombstones = state.tombstones && typeof state.tombstones === "object"
    ? state.tombstones
    : {
      tasks: {}, habits: {}, goals: {}, journalEntries: {}, categories: {},
      nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {},
    };
  [
    "tasks", "habits", "goals", "journalEntries", "categories",
    "nutritionFoods", "nutritionMeals", "nutritionTemplates",
  ].forEach((type) => {
    state.tombstones[type] ||= {};
  });
  state.syncMeta = normalizeSyncMeta(state.syncMeta);
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

function normalizeSyncMeta(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    entityFields: source.entityFields && typeof source.entityFields === "object"
      ? source.entityFields
      : {
        tasks: {}, habits: {}, goals: {}, journalEntries: {}, categories: {},
        nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {},
      },
    taskFields: source.taskFields && typeof source.taskFields === "object" ? source.taskFields : {},
    habitLogs: source.habitLogs && typeof source.habitLogs === "object" ? source.habitLogs : {},
    taskOrder: source.taskOrder && typeof source.taskOrder === "object" ? source.taskOrder : {},
    habitOrderUpdatedAt: source.habitOrderUpdatedAt || "",
    goalSteps: source.goalSteps && typeof source.goalSteps === "object" ? source.goalSteps : {},
    goalStepOrder: source.goalStepOrder && typeof source.goalStepOrder === "object" ? source.goalStepOrder : {},
  };
}

function emptySyncMeta() {
  return normalizeSyncMeta({});
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
