const ENTITY_TYPES = [
  "tasks", "habits", "goals", "journalEntries", "categories",
  "nutritionFoods", "nutritionMeals", "nutritionTemplates",
];
const MAX_ACTIVITY = 100;

export function recordMcpActivity(beforeState, nextState, details, now = new Date().toISOString()) {
  const inverse = createInversePatch(beforeState, nextState);
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

function createInversePatch(beforeState, nextState) {
  const patch = { entities: {}, taskOrder: {}, tombstones: {} };
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
      patch.entities[type] = { restore: changedBefore, removeIds };
    }
  });

  const orderKeys = new Set([
    ...Object.keys(beforeState?.taskOrder || {}),
    ...Object.keys(nextState?.taskOrder || {}),
  ]);
  orderKeys.forEach((dateKey) => {
    const before = beforeState?.taskOrder?.[dateKey];
    const after = nextState?.taskOrder?.[dateKey];
    if (!same(before, after)) patch.taskOrder[dateKey] = Array.isArray(before) ? [...before] : null;
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
  return { entities, taskOrder, tombstones };
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
