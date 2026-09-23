(function (global) {
  function createDataNormalizers(config) {
    function normalizeTaskFlags(value) {
      const flags = {};
      if (!value || typeof value !== "object" || Array.isArray(value)) return flags;
      Object.entries(value).forEach(([dateKey, done]) => {
        const normalizedDate = config.normalizeDateKey(dateKey, "");
        if (normalizedDate && done === true) flags[normalizedDate] = true;
      });
      return flags;
    }

    function normalizeHabitLogs(value) {
      const logs = {};
      if (!value || typeof value !== "object" || Array.isArray(value)) return logs;
      Object.entries(value).forEach(([dateKey, entry]) => {
        const normalizedDate = config.normalizeDateKey(dateKey, "");
        if (!normalizedDate) return;
        if (entry === true) {
          logs[normalizedDate] = true;
          return;
        }
        const amount = Number(entry);
        if (Number.isFinite(amount) && amount > 0) logs[normalizedDate] = amount;
      });
      return logs;
    }

    function normalizeTaskOrder(value) {
      const taskOrder = {};
      if (!value || typeof value !== "object" || Array.isArray(value)) return taskOrder;
      Object.entries(value).forEach(([dateKey, ids]) => {
        const normalizedDate = config.normalizeDateKey(dateKey, "");
        if (!normalizedDate || !Array.isArray(ids)) return;
        const normalizedIds = [...new Set(ids.map((id) => String(id || "")).filter(Boolean))];
        if (normalizedIds.length) taskOrder[normalizedDate] = normalizedIds;
      });
      return taskOrder;
    }

    return { normalizeHabitLogs, normalizeTaskFlags, normalizeTaskOrder };
  }

  const api = { createDataNormalizers };
  global.RhythmDataNormalizers = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
