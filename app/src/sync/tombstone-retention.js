(function (global) {
  const DEFAULT_RETENTION_DAYS = 730;

  function pruneTombstones(value, options = {}) {
    const now = Number(options.now) || Date.now();
    const retentionDays = Math.max(365, Number(options.retentionDays) || DEFAULT_RETENTION_DAYS);
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    const result = {
      tasks: {}, habits: {}, goals: {}, boardItems: {}, journalEntries: {}, notes: {}, categories: {},
      nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {},
      studySubjects: {}, studyLessons: {}, studyFiles: {},
    };

    Object.keys(result).forEach((type) => {
      Object.entries(value?.[type] || {}).forEach(([id, deletedAt]) => {
        const timestamp = Date.parse(deletedAt);
        if (id && Number.isFinite(timestamp) && timestamp >= cutoff) result[type][id] = deletedAt;
      });
    });
    return result;
  }

  const api = { DEFAULT_RETENTION_DAYS, pruneTombstones };
  global.RhythmTombstoneRetention = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
