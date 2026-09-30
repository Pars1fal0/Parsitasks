(function (global) {
  function normalizeQuietHours(value = {}) {
    value ||= {};
    const time = (input, fallback) => typeof input === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input) ? input : fallback;
    const start = time(value.start, "22:00");
    const end = time(value.end, "08:00");
    return { enabled: value.enabled === true && start !== end, start, end };
  }

  function nextAllowed(date, preference) {
    const result = new Date(date);
    const prefs = normalizeQuietHours(preference);
    if (!prefs.enabled || !Number.isFinite(result.getTime())) return result;
    const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const start = minutes(prefs.start);
    const end = minutes(prefs.end);
    const current = result.getHours() * 60 + result.getMinutes();
    const quiet = start < end ? current >= start && current < end : current >= start || current < end;
    if (!quiet) return result;
    if (start > end && current >= start) result.setDate(result.getDate() + 1);
    result.setHours(Math.floor(end / 60), end % 60, 0, 0);
    return result;
  }

  function snoozeUntil(now, choice) {
    const date = new Date(now);
    if (choice === "tomorrow") {
      date.setDate(date.getDate() + 1);
      date.setHours(9, 0, 0, 0);
    } else {
      const minutes = [10, 30, 60].includes(Number(choice)) ? Number(choice) : 10;
      date.setMinutes(date.getMinutes() + minutes);
    }
    return date;
  }

  const api = { normalizeQuietHours, nextAllowed, snoozeUntil };
  global.RhythmReminderPolicy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
