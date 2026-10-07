const ENTITY_TYPES = [
  "tasks", "habits", "goals", "journalEntries", "categories",
  "nutritionFoods", "nutritionMeals", "nutritionTemplates",
  "notes", "boardItems", "studySubjects", "studyLessons", "studyFiles",
];
const GLOBAL_FIELDS = ["profile", "studyWeekCycle", "nutritionSettings"];
const MAX_ACTIVITY = 100;

export function recordMcpActivity(beforeState, nextState, details, now = new Date().toISOString()) {
  const inverse = createInversePatch(beforeState, nextState, details.guard === true);
  const activity = {
    id: `mcp-action-${details.requestId}`,
    requestId: details.requestId,
    type: details.type,
    title: details.title,
    summary: details.summary,
    createdAt: now,
    status: "applied",
    undoneAt: "",
    inverse,
  };
  nextState.mcpActivity = normalizeMcpActivity([activity, ...(nextState.mcpActivity || [])]);
  return activity;
}

export function undoMcpActivity(state, actionId, now = new Date().toISOString()) {
  const nextState = clone(state);
  nextState.mcpActivity = normalizeMcpActivity(nextState.mcpActivity);
  const activity = nextState.mcpActivity.find((item) => item.id === actionId);
  if (!activity) throw new Error("Действие MCP не найдено");
  if (activity.status === "undone") {
    return { changed: false, state: nextState, activity };
  }

  const stateBeforeUndo = clone(nextState);
  applyInversePatch(nextState, activity.inverse, now);
  touchUndoMetadata(nextState, activity.inverse, now, stateBeforeUndo);
  activity.status = "undone";
  activity.undoneAt = now;
  activity.updatedAt = now;
  return { changed: true, state: nextState, activity };
}

export function normalizeMcpActivity(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .filter((item) => item && typeof item === "object" && item.id && !seen.has(item.id))
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
        inverse: normalizeInversePatch(item.inverse),
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_ACTIVITY);
}

export function mergeMcpActivity(local, remote) {
  const byId = new Map();
  [...normalizeMcpActivity(local), ...normalizeMcpActivity(remote)].forEach((item) => {
    const current = byId.get(item.id);
    if (!current || activityTimestamp(item) >= activityTimestamp(current)) byId.set(item.id, item);
  });
  return normalizeMcpActivity([...byId.values()]);
}

function createInversePatch(beforeState, nextState, guard) {
  const patch = { entities: {}, taskOrder: {}, tombstones: {}, globals: {}, expectedTaskOrder: {} };
  GLOBAL_FIELDS.forEach((field) => {
    if (!same(beforeState?.[field], nextState?.[field])) {
      patch.globals[field] = { restore: clone(beforeState?.[field] ?? null), expected: clone(nextState?.[field] ?? null) };
    }
  });
  const beforeHabitOrder = (beforeState?.habits || []).map((item) => item.id);
  const afterHabitOrder = (nextState?.habits || []).map((item) => item.id);
  if (!same(beforeHabitOrder, afterHabitOrder)) patch.habitOrder = { restore: beforeHabitOrder, expected: afterHabitOrder };
  ENTITY_TYPES.forEach((type) => {
    const before = mapById(beforeState?.[type]);
    const after = mapById(nextState?.[type]);
    const changedBefore = [];
    const removeIds = [];
    new Set([...before.keys(), ...after.keys()]).forEach((id) => {
      const beforeEntity = before.get(id);
      const afterEntity = after.get(id);
      if (same(beforeEntity, afterEntity)) return;
      if (beforeEntity) changedBefore.push(clone(beforeEntity));
      else removeIds.push(id);
    });
    if (changedBefore.length || removeIds.length) {
      patch.entities[type] = { restore: changedBefore, removeIds,
        ...(guard ? { expected: [...changedBefore.map((item) => item.id), ...removeIds].map((id) => ({ id, value: clone(after.get(id) ?? null) })) } : {}) };
    }
  });

  const orderKeys = new Set([
    ...Object.keys(beforeState?.taskOrder || {}),
    ...Object.keys(nextState?.taskOrder || {}),
  ]);
  orderKeys.forEach((dateKey) => {
    const before = beforeState?.taskOrder?.[dateKey];
    const after = nextState?.taskOrder?.[dateKey];
    if (!same(before, after)) {
      patch.taskOrder[dateKey] = Array.isArray(before) ? [...before] : null;
      if (guard) patch.expectedTaskOrder[dateKey] = Array.isArray(after) ? [...after] : null;
    }
  });

  ENTITY_TYPES.forEach((type) => {
    const before = beforeState?.tombstones?.[type] || {};
    const after = nextState?.tombstones?.[type] || {};
    const changed = {};
    new Set([...Object.keys(before), ...Object.keys(after)]).forEach((id) => {
      if (before[id] !== after[id]) changed[id] = before[id] || null;
    });
    if (Object.keys(changed).length) patch.tombstones[type] = changed;
  });
  return patch;
}

function applyInversePatch(state, patch, now) {
  const normalized = normalizeInversePatch(patch);
  assertPatchCurrent(state, normalized);
  const restoredIds = Object.fromEntries(ENTITY_TYPES.map((type) => [type, new Map()]));
  ENTITY_TYPES.forEach((type) => {
    const tombstoneChanges = normalized.tombstones[type] || {};
    normalized.entities[type]?.restore.forEach((entity) => {
      if (tombstoneChanges[entity.id] === null && state.tombstones?.[type]?.[entity.id]) {
        restoredIds[type].set(entity.id, `${entity.id}-undo-${Date.parse(now).toString(36)}`);
      }
    });
  });
  ENTITY_TYPES.forEach((type) => {
    const change = normalized.entities[type];
    if (!change) return;
    const remove = new Set(change.removeIds);
    const restore = mapById(change.restore);
    const current = (Array.isArray(state[type]) ? state[type] : [])
      .filter((item) => !remove.has(item.id) && !restore.has(item.id));
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
    if (restoredIds.studySubjects.has(task.studySubjectId)) task.studySubjectId = restoredIds.studySubjects.get(task.studySubjectId);
    if (restoredIds.notes.has(task.sourceNoteId)) task.sourceNoteId = restoredIds.notes.get(task.sourceNoteId);
    task.studyFileIds = (task.studyFileIds || []).map((id) => restoredIds.studyFiles.get(id) || id);
  });
  remapReferences(state, restoredIds);
  if (normalized.habitOrder) {
    const order = normalized.habitOrder.restore.map((id) => restoredIds.habits.get(id) || id);
    state.habits.sort((a, b) => (order.includes(a.id) ? order.indexOf(a.id) : order.length) - (order.includes(b.id) ? order.indexOf(b.id) : order.length));
    state.syncMeta ||= {}; state.syncMeta.habitOrderUpdatedAt = now;
  }
  Object.entries(normalized.globals).forEach(([field, change]) => {
    state[field] = clone(change.restore);
    if (state[field]) state[field].updatedAt = now;
    if (field === "profile") Object.values(state.profile?.preferences || {}).forEach((entry) => { entry.updatedAt = now; });
  });

  state.taskOrder ||= {};
  Object.entries(normalized.taskOrder).forEach(([dateKey, order]) => {
    if (order === null) delete state.taskOrder[dateKey];
    else state.taskOrder[dateKey] = order.map((id) => restoredIds.tasks.get(id) || id);
  });

  state.tombstones ||= {};
  ENTITY_TYPES.forEach((type) => {
    state.tombstones[type] ||= {};
    Object.entries(normalized.tombstones[type] || {}).forEach(([id, value]) => {
      if (value === null && restoredIds[type].has(id)) return;
      if (value === null) delete state.tombstones[type][id];
      else state.tombstones[type][id] = value;
    });
  });
}

function touchUndoMetadata(state, patch, now, previousState) {
  const normalized = normalizeInversePatch(patch);
  state.syncMeta ||= {};
  state.syncMeta.entityFields ||= {
    tasks: {}, habits: {}, goals: {}, journalEntries: {}, categories: {},
    nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {},
  };
  state.syncMeta.taskFields ||= {};
  state.syncMeta.habitLogs ||= {};
  state.syncMeta.taskOrder ||= {};
  state.syncMeta.goalSteps ||= {};
  state.syncMeta.goalStepOrder ||= {};
  ENTITY_TYPES.forEach((type) => {
    const change = normalized.entities[type];
    if (!change) return;
    change.restore.forEach((entity) => {
      const versions = (((state.syncMeta.entityFields[type] ||= {})[entity.id] ||= {}));
      Object.keys(entity).filter((field) => !["id", "createdAt", "updatedAt"].includes(field)).forEach((field) => {
        versions[field] = now;
      });
      if (type === "tasks") {
        const previous = previousState.tasks?.find((item) => item.id === entity.id);
        ["completed", "acknowledgedOverdue", "excludedDates", "notified", "workNotified"].forEach((field) => {
          new Set([...Object.keys(entity[field] || {}), ...Object.keys(previous?.[field] || {})]).forEach((date) => {
            (((state.syncMeta.taskFields[entity.id] ||= {})[field] ||= {}))[date] = now;
          });
        });
      }
      if (type === "habits") {
        const previous = previousState.habits?.find((item) => item.id === entity.id);
        new Set([...Object.keys(entity.logs || {}), ...Object.keys(previous?.logs || {})]).forEach((date) => {
          (state.syncMeta.habitLogs[entity.id] ||= {})[date] = now;
        });
      }
      if (type === "goals") {
        const previous = previousState.goals?.find((item) => item.id === entity.id);
        new Set([...(entity.steps || []).map((step) => step.id), ...(previous?.steps || []).map((step) => step.id)]).forEach((stepId) => {
          (state.syncMeta.goalSteps[entity.id] ||= {})[stepId] = now;
        });
        state.syncMeta.goalStepOrder[entity.id] = now;
      }
    });
  });
  Object.keys(normalized.taskOrder).forEach((date) => {
    state.syncMeta.taskOrder[date] = now;
  });
}

function normalizeInversePatch(value) {
  const source = value && typeof value === "object" ? value : {};
  const entities = {};
  ENTITY_TYPES.forEach((type) => {
    const change = source.entities?.[type];
    if (!change || typeof change !== "object") return;
    entities[type] = {
      restore: Array.isArray(change.restore) ? change.restore.filter((item) => item?.id).map(clone) : [],
      removeIds: Array.isArray(change.removeIds) ? change.removeIds.map(String).filter(Boolean) : [],
      ...(Array.isArray(change.expected) ? { expected: change.expected.map(clone) } : {}),
    };
  });
  const taskOrder = {};
  Object.entries(source.taskOrder || {}).forEach(([dateKey, order]) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && (order === null || Array.isArray(order))) {
      taskOrder[dateKey] = order === null ? null : order.map(String);
    }
  });
  const tombstones = {};
  ENTITY_TYPES.forEach((type) => {
    tombstones[type] = {};
    Object.entries(source.tombstones?.[type] || {}).forEach(([id, timestamp]) => {
      if (id && (timestamp === null || validTimestamp(timestamp))) tombstones[type][id] = timestamp;
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

function assertPatchCurrent(state, patch) {
  for (const [date, order] of Object.entries(patch.expectedTaskOrder)) {
    if (!same(state.taskOrder?.[date] ?? null, order)) throw new Error("Порядок задач изменился после действия. Отмена не применена.");
  }
  if (patch.habitOrder && !same((state.habits || []).map((item) => item.id), patch.habitOrder.expected)) throw new Error("Порядок привычек изменился после действия. Отмена не применена.");
  for (const [type, change] of Object.entries(patch.entities)) {
    for (const expected of change.expected || []) {
      if (!same((state[type] || []).find((item) => item.id === expected.id) ?? null, expected.value)) {
        throw new Error("После этого действия данные изменились. Отмена не применена, чтобы сохранить новые изменения.");
      }
    }
  }
  for (const [field, change] of Object.entries(patch.globals)) {
    if (!same(state[field] ?? null, change.expected)) throw new Error("Настройки изменились после действия. Отмена не применена.");
  }
}

function remapReferences(state, ids) {
  for (const lesson of state.studyLessons || []) lesson.subjectId = ids.studySubjects.get(lesson.subjectId) || lesson.subjectId;
  for (const file of state.studyFiles || []) file.subjectId = ids.studySubjects.get(file.subjectId) || file.subjectId;
  for (const note of state.notes || []) {
    note.subjectId = ids.studySubjects.get(note.subjectId) || note.subjectId;
    note.taskId = ids.tasks.get(note.taskId) || note.taskId;
  }
  const types = { task: "tasks", goal: "goals", note: "notes", subject: "studySubjects", material: "studyFiles" };
  for (const item of state.boardItems || []) {
    item.boardId = ids.boardItems.get(item.boardId) || item.boardId;
    item.sourceId = ids[types[item.sourceType]]?.get(item.sourceId) || item.sourceId;
  }
  for (const goal of state.goals || []) {
    goal.linkedTaskIds = (goal.linkedTaskIds || []).map((id) => ids.tasks.get(id) || id);
    for (const target of goal.taskTargets || []) target.taskId = ids.tasks.get(target.taskId) || target.taskId;
    for (const target of goal.habitTargets || []) target.habitId = ids.habits.get(target.habitId) || target.habitId;
  }
}

function activityTimestamp(item) {
  return Date.parse(item.updatedAt || item.createdAt || "") || 0;
}

function mapById(items) {
  return new Map((Array.isArray(items) ? items : []).filter((item) => item?.id).map((item) => [item.id, item]));
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
