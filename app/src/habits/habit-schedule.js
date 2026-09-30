(function (global) {
  const history = global.RhythmHabitConfigHistory || (typeof require === "function" ? require("./habit-config-history.js") : null);
  const freeze = global.RhythmHabitFreeze || (typeof require === "function" ? require("./habit-freeze.js") : null);
  const recurrence = global.RhythmRecurrence || (typeof require === "function" ? require("../tasks/recurrence.js") : null);

  function addDays(dateKey, days) {
    const date = new Date(`${dateKey}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  function weekStart(dateKey) {
    const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
    return addDays(dateKey, -((weekday + 6) % 7));
  }
  function configOnDate(habit, dateKey) { return history.habitConfigOnDate(habit, dateKey); }
  function occursOn(habit, dateKey) {
    if (!freeze.validDate(dateKey) || dateKey < habit.startDate) return false;
    const config = configOnDate(habit, dateKey);
    return config.repeat === "weeklyGoal" || recurrence.taskScheduledOn({ date: habit.startDate || dateKey, repeat: config.repeat, customRepeat: config.customRepeat }, dateKey);
  }
  function statusOnDate(habit, dateKey) {
    const config = configOnDate(habit, dateKey);
    const status = freeze.statusOnDate(habit, dateKey, { scheduled: occursOn(habit, dateKey), config });
    return config.repeat === "weeklyGoal" && status === "missed" ? "not-due" : status;
  }
  function weekProgress(habit, dateKey, throughDate = weekEnd(dateKey)) {
    const config = configOnDate(habit, dateKey);
    if (config.repeat !== "weeklyGoal") return null;
    const start = weekStart(dateKey);
    const end = addDays(start, 6);
    let completed = 0;
    let available = 0;
    let frozen = 0;
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addDays(start, offset);
      if (day < habit.startDate || history.habitIsArchivedOnDate(habit, day) || configOnDate(habit, day).repeat !== "weeklyGoal") continue;
      const complete = freeze.isComplete(habit, day, configOnDate(habit, day));
      if (!complete && habit.freezeDays?.[day]?.active === true) { frozen += 1; continue; }
      available += 1;
      if (day <= throughDate && complete) completed += 1;
    }
    const configuredTarget = Math.max(1, Math.min(7, Math.round(Number(config.weeklyTarget) || 3)));
    // Exempt dates reduce the quota only when too few active days remain.
    const target = Math.min(configuredTarget, available);
    return { start, end, completed, target, configuredTarget, frozen, achieved: target > 0 && completed >= target };
  }
  function weekEnd(dateKey) { return addDays(weekStart(dateKey), 6); }
  function streak(habit, dateKey, todayKey = dateKey) {
    if (configOnDate(habit, dateKey).repeat !== "weeklyGoal") return freeze.streak(habit, dateKey, statusOnDate);
    let cursor = dateKey;
    let count = 0;
    for (let checked = 0; checked < 523 && cursor >= habit.startDate; checked += 1) {
      const progress = weekProgress(habit, cursor, dateKey < todayKey ? dateKey : todayKey);
      if (!progress) break;
      if (progress.achieved) count += 1;
      else if (progress.target && progress.end < todayKey && progress.end <= dateKey) break;
      cursor = addDays(weekStart(cursor), -1);
    }
    return count;
  }
  function shouldRemind(habit, dateKey) {
    if (!habit.reminderTime || !occursOn(habit, dateKey) || history.habitIsArchivedOnDate(habit, dateKey)) return false;
    if (["complete", "frozen"].includes(statusOnDate(habit, dateKey))) return false;
    return !weekProgress(habit, dateKey, dateKey)?.achieved;
  }
  const api = { addDays, configOnDate, occursOn, shouldRemind, statusOnDate, streak, weekProgress, weekStart };
  global.RhythmHabitSchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
