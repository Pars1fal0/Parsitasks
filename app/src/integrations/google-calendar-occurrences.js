(function (global) {
  const recurrence = global.RhythmRecurrence || (typeof require === "function" ? require("../tasks/recurrence.js") : null);
  const DEFAULT_LIMIT = 1000;

  function buildCalendarTasks(state = {}, range = {}, options = {}) {
    const categories = new Map((state.categories || []).map((category) => [category.id, category.name]));
    const links = state.googleCalendarLinks || {};
    const limit = positiveInteger(options.limit, DEFAULT_LIMIT);
    const timedTasks = (state.tasks || []).filter(isTimedTask);
    const managedSourceIds = new Set(timedTasks.map((task) => task.id));
    const expanded = [];

    timedTasks.forEach((task) => {
      occurrenceDates(task, range).forEach((date) => expanded.push(toCalendarTask(task, date, categories)));
    });
    expanded.sort(compareCalendarTasks);

    const tasks = expanded.slice(0, limit);
    const activeIds = new Set(tasks.map((task) => task.id));
    const staleTaskIds = Object.entries(links)
      .filter(([linkId, link]) => managedSourceIds.has(link?.sourceTaskId || linkId) && !activeIds.has(linkId))
      .map(([linkId]) => linkId);

    return {
      skipped: Math.max(0, expanded.length - tasks.length),
      staleTaskIds,
      tasks,
    };
  }

  function occurrenceDates(task, range = {}) {
    const from = validDateKey(range.from) ? range.from : task.date;
    const to = validDateKey(range.to) ? range.to : task.date;
    if (!validDateKey(task.date) || from > to) return [];
    if (task.repeat === "none") return task.date >= from && task.date <= to ? [task.date] : [];

    const dates = [];
    let date = from > task.date ? from : task.date;
    for (let guard = 0; date <= to && guard < 740; guard += 1) {
      if (recurrence?.taskScheduledOn(task, date) && !task.excludedDates?.[date]) dates.push(date);
      date = addDays(date, 1);
    }
    return dates;
  }

  function toCalendarTask(task, date, categories) {
    const recurring = task.repeat !== "none";
    return {
      category: categories.get(task.categoryId) || "",
      date,
      endTime: task.endTime,
      id: recurring ? occurrenceId(task.id, date) : task.id,
      occurrenceDate: recurring ? date : "",
      priority: ["low", "medium", "high"].includes(task.priority) ? task.priority : "medium",
      sourceTaskId: recurring ? task.id : "",
      startTime: task.startTime,
      title: task.title,
      updatedAt: task.updatedAt || task.createdAt || "",
    };
  }

  function occurrenceId(taskId, date) {
    return `${String(taskId || "")}::${date}`;
  }

  function compareCalendarTasks(left, right) {
    return left.date.localeCompare(right.date)
      || left.startTime.localeCompare(right.startTime)
      || left.id.localeCompare(right.id);
  }

  function isTimedTask(task) {
    return task?.scheduleMode === "block" && task.startTime && task.endTime;
  }

  function addDays(dateKey, amount) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + amount));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function validDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  }

  function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
  }

  const api = { DEFAULT_LIMIT, buildCalendarTasks, occurrenceDates, occurrenceId };
  global.RhythmGoogleCalendarOccurrences = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
