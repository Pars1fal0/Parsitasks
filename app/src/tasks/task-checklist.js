(function (global) {
  function normalizeItems(value, createId = () => global.crypto.randomUUID()) {
    const ids = new Set();
    return (Array.isArray(value) ? value : []).slice(0, 50).map((item) => {
      const title = String(item?.title || "").trim().replace(/\s+/g, " ").slice(0, 200);
      const id = String(item?.id || createId()).slice(0, 100);
      if (!title || ids.has(id)) return null;
      ids.add(id);
      return { id, title };
    }).filter(Boolean);
  }
  function normalizeLogs(value) {
    const result = {};
    for (const [day, items] of Object.entries(value || {})) {
      const date = new Date(`${day}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) continue;
      for (const [id, entry] of Object.entries(items || {})) {
        if (!id || typeof entry?.done !== "boolean" || !Number.isFinite(Date.parse(entry.updatedAt))) continue;
        (result[day] ||= {})[id] = { done: entry.done, updatedAt: entry.updatedAt };
      }
    }
    return result;
  }
  function mergeLogs(local, remote) {
    const result = normalizeLogs(local);
    for (const [day, items] of Object.entries(normalizeLogs(remote))) {
      for (const [id, entry] of Object.entries(items)) {
        const current = result[day]?.[id];
        if (!current || entry.updatedAt > current.updatedAt || (entry.updatedAt === current.updatedAt && !entry.done)) (result[day] ||= {})[id] = entry;
      }
    }
    return result;
  }
  function progress(task, dateKey) {
    const items = task.checklist || [];
    return { done: items.filter((item) => task.checklistLogs?.[dateKey]?.[item.id]?.done === true).length, total: items.length };
  }
  function setDone(task, dateKey, itemId, done, updatedAt = new Date().toISOString()) {
    if (!task.checklist?.some((item) => item.id === itemId)) return false;
    ((task.checklistLogs ||= {})[dateKey] ||= {})[itemId] = { done: done === true, updatedAt };
    task.updatedAt = updatedAt;
    return true;
  }
  function moveDate(task, sourceDate, targetDate) {
    if (sourceDate === targetDate || !task.checklistLogs?.[sourceDate]) return;
    task.checklistLogs[targetDate] = mergeLogs({ [targetDate]: task.checklistLogs[targetDate] }, { [targetDate]: task.checklistLogs[sourceDate] })[targetDate];
    delete task.checklistLogs[sourceDate];
  }
  const api = { mergeLogs, moveDate, normalizeItems, normalizeLogs, progress, setDone };
  global.RhythmTaskChecklist = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
