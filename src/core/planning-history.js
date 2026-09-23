(function (global) {
  function buildBacklogEntries(options = {}) {
    const {
      addDays,
      isTaskDone,
      isTaskExcluded,
      taskOccursOn,
      tasks = [],
      todayKey,
      recurringWindowDays,
    } = options;
    const yesterdayKey = addDays(todayKey, -1);
    const entries = [];

    tasks.forEach((task) => {
      if (task.repeat === "none") {
        if (task.date < yesterdayKey && !isTaskDone(task, task.date) && task.acknowledgedOverdue?.[task.date] !== true) {
          entries.push({ dateKey: task.date, recurring: false, task });
        }
        return;
      }

      const startDate = Number.isFinite(recurringWindowDays)
        ? [task.date, addDays(todayKey, -recurringWindowDays)].sort().at(-1)
        : task.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || "")) return;
      for (let dateKey = startDate; dateKey < yesterdayKey; dateKey = addDays(dateKey, 1)) {
        if (task.repeatUntil && dateKey > task.repeatUntil) break;
        if (!taskOccursOn(task, dateKey) || isTaskDone(task, dateKey) || isTaskExcluded(task, dateKey)) continue;
        if (task.acknowledgedOverdue?.[dateKey] === true) continue;
        entries.push({ dateKey, recurring: true, task });
      }
    });

    return entries.sort((a, b) => b.dateKey.localeCompare(a.dateKey) || a.task.title.localeCompare(b.task.title, "ru"));
  }

  function archiveEntryInPeriod(dateKey, period, todayKey, addDays) {
    if (!dateKey || period === "all") return true;
    const days = { week: 7, month: 31, quarter: 93 }[period];
    if (!days) return true;
    return dateKey >= addDays(todayKey, -days + 1) && dateKey <= todayKey;
  }

  const api = { archiveEntryInPeriod, buildBacklogEntries };
  global.RhythmPlanningHistory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
