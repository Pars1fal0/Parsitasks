(function (global) {
  const MAX_ACTIVITY = 100;
  const ENTITY_TYPES = [
    "tasks", "habits", "goals", "journalEntries", "categories",
    "nutritionFoods", "nutritionMeals", "nutritionTemplates",
    "notes", "boardItems", "studySubjects", "studyLessons", "studyFiles",
  ];
  const GLOBAL_FIELDS = ["profile", "studyWeekCycle", "nutritionSettings"];

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
    for (const [date, order] of Object.entries(patch.expectedTaskOrder)) {
      if (JSON.stringify(state.taskOrder?.[date] ?? null) !== JSON.stringify(order)) throw new Error("Порядок задач изменился после действия. Отмена не применена.");
    }
    if (patch.habitOrder && JSON.stringify((state.habits || []).map((item) => item.id)) !== JSON.stringify(patch.habitOrder.expected)) throw new Error("Порядок привычек изменился после действия. Отмена не применена.");
    for (const [type, change] of Object.entries(patch.entities)) {
      for (const expected of change.expected || []) {
        if (JSON.stringify((state[type] || []).find((item) => item.id === expected.id) ?? null) !== JSON.stringify(expected.value)) {
          throw new Error("После этого действия данные изменились. Отмена не применена, чтобы сохранить новые изменения.");
        }
      }
    }
    for (const [field, change] of Object.entries(patch.globals)) {
      if (JSON.stringify(state[field] ?? null) !== JSON.stringify(change.expected)) throw new Error("Настройки изменились после действия. Отмена не применена.");
    }
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
      task.studySubjectId = restoredIds.studySubjects.get(task.studySubjectId) || task.studySubjectId;
      task.sourceNoteId = restoredIds.notes.get(task.sourceNoteId) || task.sourceNoteId;
      task.studyFileIds = (task.studyFileIds || []).map((id) => restoredIds.studyFiles.get(id) || id);
    });
    for (const lesson of state.studyLessons || []) lesson.subjectId = restoredIds.studySubjects.get(lesson.subjectId) || lesson.subjectId;
    for (const file of state.studyFiles || []) file.subjectId = restoredIds.studySubjects.get(file.subjectId) || file.subjectId;
    for (const note of state.notes || []) {
      note.subjectId = restoredIds.studySubjects.get(note.subjectId) || note.subjectId;
      note.taskId = restoredIds.tasks.get(note.taskId) || note.taskId;
    }
    const types = { task: "tasks", goal: "goals", note: "notes", subject: "studySubjects", material: "studyFiles" };
    for (const item of state.boardItems || []) {
      item.boardId = restoredIds.boardItems.get(item.boardId) || item.boardId;
      item.sourceId = restoredIds[types[item.sourceType]]?.get(item.sourceId) || item.sourceId;
    }
    for (const goal of state.goals || []) {
      goal.linkedTaskIds = (goal.linkedTaskIds || []).map((id) => restoredIds.tasks.get(id) || id);
      for (const target of goal.taskTargets || []) target.taskId = restoredIds.tasks.get(target.taskId) || target.taskId;
      for (const target of goal.habitTargets || []) target.habitId = restoredIds.habits.get(target.habitId) || target.habitId;
    }
    if (patch.habitOrder) {
      const order = patch.habitOrder.restore.map((id) => restoredIds.habits.get(id) || id);
      state.habits.sort((a, b) => (order.includes(a.id) ? order.indexOf(a.id) : order.length) - (order.includes(b.id) ? order.indexOf(b.id) : order.length));
    }
    Object.entries(patch.globals).forEach(([field, change]) => {
      state[field] = clone(change.restore);
      if (state[field]) state[field].updatedAt = now;
      if (field === "profile") Object.values(state.profile?.preferences || {}).forEach((entry) => { entry.updatedAt = now; });
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
        ...(Array.isArray(change.expected) ? { expected: change.expected.map(clone) } : {}),
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
    const globals = {};
    GLOBAL_FIELDS.forEach((field) => { if (source.globals?.[field]) globals[field] = clone(source.globals[field]); });
    const habitOrder = source.habitOrder && Array.isArray(source.habitOrder.restore) && Array.isArray(source.habitOrder.expected) ? clone(source.habitOrder) : null;
    const expectedTaskOrder = {};
    Object.entries(source.expectedTaskOrder || {}).forEach(([date, order]) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && (order === null || Array.isArray(order))) expectedTaskOrder[date] = clone(order);
    });
    return { entities, taskOrder, tombstones, globals, habitOrder, expectedTaskOrder };
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
