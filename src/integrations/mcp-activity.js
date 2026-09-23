(function (global) {
  const MAX_ACTIVITY = 100;
  const ENTITY_TYPES = [
    "tasks", "habits", "goals", "journalEntries", "categories",
    "nutritionFoods", "nutritionMeals", "nutritionTemplates",
  ];

  function normalizeActivity(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value
      .filter((item) => item?.id && !seen.has(item.id))
      .map((item) => {
        seen.add(item.id);
        return {
          id: String(item.id),
          requestId: String(item.requestId || ""),
          type: String(item.type || "change"),
          title: String(item.title || "Изменение через ChatGPT").slice(0, 200),
          summary: String(item.summary || "").slice(0, 500),
          createdAt: validTimestamp(item.createdAt) || new Date(0).toISOString(),
          updatedAt: validTimestamp(item.updatedAt),
          status: item.status === "undone" ? "undone" : "applied",
          undoneAt: validTimestamp(item.undoneAt),
          inverse: normalizePatch(item.inverse),
        };
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_ACTIVITY);
  }

  function mergeActivity(local, remote) {
    const byId = new Map();
    [...normalizeActivity(local), ...normalizeActivity(remote)].forEach((item) => {
      const current = byId.get(item.id);
      if (!current || timestamp(item) >= timestamp(current)) byId.set(item.id, item);
    });
    return normalizeActivity([...byId.values()]);
  }

  function undoActivity(state, actionId, now = new Date().toISOString()) {
    const nextState = clone(state);
    nextState.mcpActivity = normalizeActivity(nextState.mcpActivity);
    const activity = nextState.mcpActivity.find((item) => item.id === actionId);
    if (!activity) throw new Error("Действие ChatGPT не найдено");
    if (activity.status === "undone") return { changed: false, state: nextState, activity };
    applyPatch(nextState, activity.inverse, now);
    activity.status = "undone";
    activity.undoneAt = now;
    activity.updatedAt = now;
    return { changed: true, state: nextState, activity };
  }

  function applyPatch(state, value, now) {
    const patch = normalizePatch(value);
    const restoredIds = Object.fromEntries(ENTITY_TYPES.map((type) => [type, new Map()]));
    ENTITY_TYPES.forEach((type) => {
      patch.entities[type]?.restore.forEach((entity) => {
        if (patch.tombstones[type]?.[entity.id] === null && state.tombstones?.[type]?.[entity.id]) {
          restoredIds[type].set(entity.id, `${entity.id}-undo-${Date.parse(now).toString(36)}`);
        }
      });
    });
    ENTITY_TYPES.forEach((type) => {
      const change = patch.entities[type];
      if (!change) return;
      const remove = new Set(change.removeIds);
      const restoreIds = new Set(change.restore.map((item) => item.id));
      const current = (state[type] || []).filter((item) => !remove.has(item.id) && !restoreIds.has(item.id));
      const restored = change.restore.map((item) => {
        const entity = clone(item);
        if (restoredIds[type].has(entity.id)) entity.id = restoredIds[type].get(entity.id);
        return entity;
      });
      state[type] = [...current, ...restored];
      state.tombstones ||= {};
      state.tombstones[type] ||= {};
      change.removeIds.forEach((id) => {
        state.tombstones[type][id] = now;
      });
    });
    (state.tasks || []).forEach((task) => {
      if (restoredIds.categories.has(task.categoryId)) task.categoryId = restoredIds.categories.get(task.categoryId);
      if (restoredIds.tasks.has(task.sourceTaskId)) task.sourceTaskId = restoredIds.tasks.get(task.sourceTaskId);
    });
    state.taskOrder ||= {};
    Object.entries(patch.taskOrder).forEach(([date, order]) => {
      if (order === null) delete state.taskOrder[date];
      else state.taskOrder[date] = order.map((id) => restoredIds.tasks.get(id) || id);
    });
    state.tombstones ||= {};
    ENTITY_TYPES.forEach((type) => {
      state.tombstones[type] ||= {};
      Object.entries(patch.tombstones[type] || {}).forEach(([id, value]) => {
        if (value === null && restoredIds[type].has(id)) return;
        if (value === null) delete state.tombstones[type][id];
        else state.tombstones[type][id] = value;
      });
    });
  }

  function normalizePatch(value) {
    const source = value && typeof value === "object" ? value : {};
    const entities = {};
    ENTITY_TYPES.forEach((type) => {
      const change = source.entities?.[type];
      if (!change) return;
      entities[type] = {
        restore: Array.isArray(change.restore) ? change.restore.filter((item) => item?.id).map(clone) : [],
        removeIds: Array.isArray(change.removeIds) ? change.removeIds.map(String).filter(Boolean) : [],
      };
    });
    const taskOrder = {};
    Object.entries(source.taskOrder || {}).forEach(([date, order]) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && (order === null || Array.isArray(order))) {
        taskOrder[date] = order === null ? null : order.map(String);
      }
    });
    const tombstones = {};
    ENTITY_TYPES.forEach((type) => {
      tombstones[type] = {};
      Object.entries(source.tombstones?.[type] || {}).forEach(([id, value]) => {
        if (id && (value === null || validTimestamp(value))) tombstones[type][id] = value;
      });
    });
    return { entities, taskOrder, tombstones };
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
  }

  function timestamp(item) {
    return Date.parse(item.updatedAt || item.createdAt || "") || 0;
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  const api = { mergeActivity, normalizeActivity, undoActivity };
  global.RhythmMcpActivity = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
