(function (global) {
  const TASK_DATE_FIELDS = ["completed", "acknowledgedOverdue", "excludedDates", "notified"];
  const ENTITY_FIELDS = {
    tasks: [
      "title", "date", "time", "scheduleMode", "startTime", "endTime", "categoryId", "priority",
      "repeat", "repeatUntil", "sourceTaskId", "movedFromDate", "customRepeat", "reminderOffset",
    ],
    habits: ["startDate", "archived", "archivedAt", "archivedFromDate"],
    goals: ["title", "dueDate", "why"],
    boardItems: [
      "type", "x", "y", "width", "height", "z", "text", "fontSize", "fontWeight", "color",
      "groupId", "locked",
      "assetId", "remotePath", "mime", "name",
    ],
    journalEntries: ["date", "text", "revisions"],
    nutritionFoods: ["name", "unit", "calories", "protein", "fat", "carbs", "source", "approximate"],
    nutritionMeals: ["date", "type", "time", "title", "servings", "ingredients", "nutrition", "status", "notes"],
    nutritionTemplates: ["title", "type", "time", "servings", "ingredients", "nutrition", "notes"],
    categories: ["name", "color"],
  };

  function createSyncMetadataTracker(options = {}) {
    const now = options.now || (() => new Date().toISOString());

    function trackChanges(previousState = {}, nextState = {}) {
      const meta = normalizeSyncMeta(nextState.syncMeta);
      const changedAt = now();
      trackEntityFields(previousState, nextState, meta, changedAt);
      trackTaskFields(previousState.tasks, nextState.tasks, meta, changedAt);
      trackHabitLogs(previousState.habits, nextState.habits, meta, changedAt);
      trackTaskOrder(previousState.taskOrder, nextState.taskOrder, meta, changedAt);
      trackHabitOrder(previousState.habits, nextState.habits, meta, changedAt);
      trackGoalSteps(previousState.goals, nextState.goals, meta, changedAt);
      nextState.syncMeta = meta;
      return nextState;
    }

    return { trackChanges };
  }

  function trackEntityFields(previousState, nextState, meta, changedAt) {
    Object.entries(ENTITY_FIELDS).forEach(([type, fields]) => {
      const previousById = mapById(previousState?.[type]);
      (Array.isArray(nextState?.[type]) ? nextState[type] : []).forEach((entity) => {
        const previous = previousById.get(entity.id);
        if (!previous) return;
        fields.forEach((field) => {
          if (!sameValue(previous[field], entity[field])) {
            (((meta.entityFields[type] ||= {})[entity.id] ||= {}))[field] = changedAt;
          }
        });
      });
    });
  }

  function trackTaskFields(previousTasks = [], nextTasks = [], meta, changedAt) {
    const previousById = mapById(previousTasks);
    (Array.isArray(nextTasks) ? nextTasks : []).forEach((task) => {
      const previous = previousById.get(task.id);
      if (!previous) return;
      TASK_DATE_FIELDS.forEach((field) => {
        changedKeys(previous[field], task[field]).forEach((dateKey) => {
          (((meta.taskFields[task.id] ||= {})[field] ||= {}))[dateKey] = changedAt;
        });
      });
    });
  }

  function trackHabitLogs(previousHabits = [], nextHabits = [], meta, changedAt) {
    const previousById = mapById(previousHabits);
    (Array.isArray(nextHabits) ? nextHabits : []).forEach((habit) => {
      const previous = previousById.get(habit.id);
      if (!previous) return;
      changedKeys(previous.logs, habit.logs).forEach((dateKey) => {
        (meta.habitLogs[habit.id] ||= {})[dateKey] = changedAt;
      });
    });
  }

  function trackTaskOrder(previous = {}, next = {}, meta, changedAt) {
    const dateKeys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
    dateKeys.forEach((dateKey) => {
      if (!sameValue(previous?.[dateKey] || [], next?.[dateKey] || [])) meta.taskOrder[dateKey] = changedAt;
    });
  }

  function trackHabitOrder(previous = [], next = [], meta, changedAt) {
    const previousOrder = idsOf(previous);
    const nextOrder = idsOf(next);
    if (!sameValue(previousOrder, nextOrder)) meta.habitOrderUpdatedAt = changedAt;
  }

  function trackGoalSteps(previousGoals = [], nextGoals = [], meta, changedAt) {
    const previousById = mapById(previousGoals);
    (Array.isArray(nextGoals) ? nextGoals : []).forEach((goal) => {
      const previous = previousById.get(goal.id);
      if (!previous) return;
      const previousSteps = mapById(previous.steps);
      const nextSteps = mapById(goal.steps);
      const stepIds = new Set([...previousSteps.keys(), ...nextSteps.keys()]);
      stepIds.forEach((stepId) => {
        if (!sameValue(previousSteps.get(stepId), nextSteps.get(stepId))) {
          ((meta.goalSteps[goal.id] ||= {})[stepId]) = changedAt;
        }
      });
      if (!sameValue(idsOf(previous.steps), idsOf(goal.steps))) meta.goalStepOrder[goal.id] = changedAt;
    });
  }

  function normalizeSyncMeta(value = {}) {
    return {
      entityFields: normalizeEntityFields(value.entityFields),
      taskFields: normalizeNestedTimestampMap(value.taskFields, 3),
      habitLogs: normalizeNestedTimestampMap(value.habitLogs, 2),
      taskOrder: normalizeTimestampMap(value.taskOrder),
      habitOrderUpdatedAt: validTimestamp(value.habitOrderUpdatedAt),
      goalSteps: normalizeNestedTimestampMap(value.goalSteps, 2),
      goalStepOrder: normalizeTimestampMap(value.goalStepOrder),
    };
  }

  function pruneSyncMeta(value = {}, state = {}) {
    const meta = normalizeSyncMeta(value);
    const ids = {
      tasks: new Set(idsOf(state.tasks)),
      habits: new Set(idsOf(state.habits)),
      goals: new Set(idsOf(state.goals)),
      boardItems: new Set(idsOf(state.boardItems)),
      journalEntries: new Set(idsOf(state.journalEntries)),
      categories: new Set(idsOf(state.categories)),
    };
    Object.keys(meta.entityFields).forEach((type) => {
      Object.keys(meta.entityFields[type]).forEach((id) => {
        if (!ids[type]?.has(id)) delete meta.entityFields[type][id];
      });
    });
    Object.keys(meta.taskFields).forEach((id) => {
      if (!ids.tasks.has(id)) delete meta.taskFields[id];
    });
    Object.keys(meta.habitLogs).forEach((id) => {
      if (!ids.habits.has(id)) delete meta.habitLogs[id];
    });
    Object.keys(meta.goalSteps).forEach((id) => {
      if (!ids.goals.has(id)) delete meta.goalSteps[id];
    });
    Object.keys(meta.goalStepOrder).forEach((id) => {
      if (!ids.goals.has(id)) delete meta.goalStepOrder[id];
    });
    return meta;
  }

  function normalizeEntityFields(value = {}) {
    const result = {};
    Object.keys(ENTITY_FIELDS).forEach((type) => {
      result[type] = normalizeNestedTimestampMap(value?.[type], 2);
    });
    return result;
  }

  function normalizeNestedTimestampMap(value, depth) {
    if (depth <= 1) return normalizeTimestampMap(value);
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    Object.entries(value).forEach(([key, child]) => {
      const normalized = normalizeNestedTimestampMap(child, depth - 1);
      if (Object.keys(normalized).length) result[key] = normalized;
    });
    return result;
  }

  function normalizeTimestampMap(value) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    Object.entries(value).forEach(([key, timestamp]) => {
      const normalized = validTimestamp(timestamp);
      if (key && normalized) result[key] = normalized;
    });
    return result;
  }

  function changedKeys(previous = {}, next = {}) {
    return [...new Set([...Object.keys(previous || {}), ...Object.keys(next || {})])]
      .filter((key) => !sameValue(previous?.[key], next?.[key]));
  }

  function mapById(items = []) {
    return new Map((Array.isArray(items) ? items : []).filter((item) => item?.id).map((item) => [item.id, item]));
  }

  function idsOf(items = []) {
    return (Array.isArray(items) ? items : []).map((item) => item?.id).filter(Boolean);
  }

  function sameValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const api = { ENTITY_FIELDS, TASK_DATE_FIELDS, clone, createSyncMetadataTracker, normalizeSyncMeta, pruneSyncMeta };
  global.RhythmSyncMetadata = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
