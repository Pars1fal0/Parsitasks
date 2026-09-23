(function (global) {
  function createOverdueController(ctx) {
    let cachedEntries = [];
    let cachedKey = "";

    function list(now = new Date()) {
      const yesterday = new Date(now);
      yesterday.setHours(12, 0, 0, 0);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = ctx.toDateKey(yesterday);
      const nextKey = `${ctx.getCacheKey?.() || ""}:${yesterdayKey}`;
      if (nextKey === cachedKey) return cachedEntries;
      const entries = [];

      ctx.getTasks().forEach((task) => {
        if (task.repeat === "none") {
          if (task.date === yesterdayKey) addEntry(entries, task, yesterdayKey, now);
          return;
        }
        if (ctx.taskScheduledOn(task, yesterdayKey) && !ctx.isTaskExcluded(task, yesterdayKey)) {
          addEntry(entries, task, yesterdayKey, now);
        }
      });

      cachedEntries = entries.sort((a, b) => a.dueAt - b.dueAt || a.task.title.localeCompare(b.task.title, "ru"));
      cachedKey = nextKey;
      return cachedEntries;
    }

    function addEntry(entries, task, dateKey, now) {
      if (ctx.isAcknowledged?.(task, dateKey)) return;
      const dueAt = ctx.getTaskDeadlineDate(task, dateKey);
      if (dueAt >= now || ctx.isTaskDone(task, dateKey)) return;
      entries.push({ task, dateKey, dueAt });
    }

    return { list };
  }

  global.RhythmOverdueController = { createOverdueController };
  if (typeof module !== "undefined" && module.exports) module.exports = { createOverdueController };
})(typeof window !== "undefined" ? window : globalThis);
