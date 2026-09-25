(function (global) {
  const configHistory = global.RhythmHabitConfigHistory || (typeof require === "function" ? require("./habit-config-history.js") : null);

  function validDate(dateKey) {
    if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
    const date = new Date(`${dateKey}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateKey;
  }

  function datesBetween(start, end) {
    if (!validDate(start) || !validDate(end) || end < start) throw new Error("Проверьте даты заморозки");
    const dates = [];
    const cursor = new Date(`${start}T12:00:00Z`);
    const last = new Date(`${end}T12:00:00Z`);
    while (cursor <= last) {
      if (dates.length >= 3660) throw new Error("Выберите период короче 10 лет за одно действие");
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }

  function normalizeFreezeDays(value) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const [dateKey, entry] of Object.entries(value)) {
      if (!validDate(dateKey) || !entry || typeof entry !== "object") continue;
      if (typeof entry.updatedAt !== "string" || !Number.isFinite(Date.parse(entry.updatedAt))) continue;
      result[dateKey] = {
        active: entry.active === true,
        reason: entry.active === true ? String(entry.reason || "").trim().slice(0, 160) : "",
        updatedAt: entry.updatedAt,
      };
    }
    return result;
  }

  function mergeFreezeDays(local, remote) {
    const merged = normalizeFreezeDays(local);
    for (const [dateKey, entry] of Object.entries(normalizeFreezeDays(remote))) {
      if (!merged[dateKey] || entry.updatedAt > merged[dateKey].updatedAt
        || (entry.updatedAt === merged[dateKey].updatedAt && entry.active === false)) merged[dateKey] = entry;
    }
    return merged;
  }

  function isComplete(habit, dateKey, config = habit) {
    const value = habit.logs?.[dateKey];
    return config.type === "number" ? Number(value || 0) >= Number(config.goal || 1) : value === true;
  }

  function statusOnDate(habit, dateKey, options = {}) {
    const active = options.active ?? !configHistory?.habitIsArchivedOnDate(habit, dateKey);
    if (!active || !options.scheduled) return "not-due";
    if (isComplete(habit, dateKey, options.config || habit)) return "complete";
    return habit.freezeDays?.[dateKey]?.active === true ? "frozen" : "missed";
  }

  function setFrozen(habit, dateKey, active, reason = "", updatedAt = new Date().toISOString()) {
    habit.freezeDays ||= {};
    habit.freezeDays[dateKey] = { active, reason: active ? String(reason).trim().slice(0, 160) : "", updatedAt };
    habit.updatedAt = updatedAt;
  }

  function streak(habit, dateKey, status) {
    if (!validDate(dateKey)) return 0;
    const cursor = new Date(`${dateKey}T12:00:00Z`);
    let count = 0;
    for (let checked = 0; checked < 3660; checked += 1) {
      const day = cursor.toISOString().slice(0, 10);
      if (day < habit.startDate) break;
      const dayStatus = status(habit, day);
      if (dayStatus === "missed") break;
      if (dayStatus === "complete") count += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return count;
  }

  const api = { datesBetween, isComplete, mergeFreezeDays, normalizeFreezeDays, setFrozen, statusOnDate, streak, validDate };
  global.RhythmHabitFreeze = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
