(function (global) {
  const syncMetadata = global.RhythmSyncMetadata || require("../sync/sync-metadata.js");
  const mcpActivity = global.RhythmMcpActivity || require("../integrations/mcp-activity.js");
  const habitTitleHistory = global.RhythmHabitTitleHistory || require("../habits/habit-title-history.js");
  const habitConfigHistory = global.RhythmHabitConfigHistory || require("../habits/habit-config-history.js");
  const habitFreeze = global.RhythmHabitFreeze || require("../habits/habit-freeze.js");
  const TASK_DATE_FIELDS = syncMetadata.TASK_DATE_FIELDS;
  const ENTITY_FIELDS = syncMetadata.ENTITY_FIELDS;

  function mergeStates(localState = {}, remoteState = {}) {
    const localMeta = syncMetadata.normalizeSyncMeta(localState.syncMeta);
    const remoteMeta = syncMetadata.normalizeSyncMeta(remoteState.syncMeta);
    const syncMeta = mergeSyncMeta(localMeta, remoteMeta);
    const tombstones = mergeTombstones(localState.tombstones, remoteState.tombstones);
    const tasks = withoutDeleted(
      mergeEntities(localState.tasks, remoteState.tasks, (local, remote) => mergeTask(local, remote, localMeta, remoteMeta)),
      tombstones.tasks,
    );
    const habits = withoutDeleted(
      mergeEntities(localState.habits, remoteState.habits, (local, remote) => mergeHabit(local, remote, localMeta, remoteMeta)),
      tombstones.habits,
    );
    const goals = withoutDeleted(
      mergeEntities(localState.goals, remoteState.goals, (local, remote) => mergeGoal(local, remote, localMeta, remoteMeta)),
      tombstones.goals,
    );
    const boardItems = mergeSimpleEntities(
      localState.boardItems,
      remoteState.boardItems,
      "boardItems",
      localMeta,
      remoteMeta,
      tombstones.boardItems,
    );
    const journalEntries = withoutDeleted(
      mergeEntities(localState.journalEntries, remoteState.journalEntries, (local, remote) =>
        mergeEntityFields(
          local,
          remote,
          chooseNewest(local, remote),
          ENTITY_FIELDS.journalEntries,
          localMeta.entityFields.journalEntries?.[local.id],
          remoteMeta.entityFields.journalEntries?.[remote.id],
        )),
      tombstones.journalEntries,
    );
    const nutritionFoods = mergeSimpleEntities(
      localState.nutritionFoods,
      remoteState.nutritionFoods,
      "nutritionFoods",
      localMeta,
      remoteMeta,
      tombstones.nutritionFoods,
    );
    const nutritionMeals = mergeSimpleEntities(
      localState.nutritionMeals,
      remoteState.nutritionMeals,
      "nutritionMeals",
      localMeta,
      remoteMeta,
      tombstones.nutritionMeals,
    );
    const nutritionTemplates = mergeSimpleEntities(
      localState.nutritionTemplates,
      remoteState.nutritionTemplates,
      "nutritionTemplates",
      localMeta,
      remoteMeta,
      tombstones.nutritionTemplates,
    );
    const categories = withoutDeleted(
      mergeEntities(localState.categories, remoteState.categories, (local, remote) =>
        mergeEntityFields(
          local,
          remote,
          chooseNewest(local, remote),
          ENTITY_FIELDS.categories,
          localMeta.entityFields.categories?.[local.id],
          remoteMeta.entityFields.categories?.[remote.id],
        )),
      tombstones.categories,
    );
    return {
      ...localState,
      ...remoteState,
      defaultsSeeded: localState.defaultsSeeded === true || remoteState.defaultsSeeded === true || categories.length > 0,
      profile: mergeProfile(localState.profile, remoteState.profile),
      categories,
      tasks,
      habits: applyEntityOrder(habits, localState.habits, remoteState.habits, localMeta.habitOrderUpdatedAt, remoteMeta.habitOrderUpdatedAt),
      goals,
      boardItems,
      journalEntries: deduplicateJournalDates(journalEntries),
      nutritionFoods,
      nutritionMeals,
      nutritionTemplates,
      nutritionSettings: chooseNewest(localState.nutritionSettings || {}, remoteState.nutritionSettings || {}),
      googleCalendarLinks: mergeGoogleCalendarLinks(localState.googleCalendarLinks, remoteState.googleCalendarLinks),
      mcpActivity: mcpActivity.mergeActivity(localState.mcpActivity, remoteState.mcpActivity),
      taskOrder: mergeTaskOrder(localState.taskOrder, remoteState.taskOrder, localMeta, remoteMeta, new Set(tasks.map((task) => task.id))),
      tombstones,
      syncMeta,
    };
  }

  function mergeGoogleCalendarLinks(local = {}, remote = {}) {
    const result = {};
    const taskIds = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
    taskIds.forEach((taskId) => {
      const localLink = local?.[taskId];
      const remoteLink = remote?.[taskId];
      if (!localLink) result[taskId] = clone(remoteLink);
      else if (!remoteLink) result[taskId] = clone(localLink);
      else result[taskId] = clone(String(remoteLink.syncedAt || "") >= String(localLink.syncedAt || "") ? remoteLink : localLink);
    });
    return result;
  }

  function mergeSimpleEntities(local, remote, type, localMeta, remoteMeta, tombstones) {
    return withoutDeleted(
      mergeEntities(local, remote, (localEntity, remoteEntity) =>
        mergeEntityFields(
          localEntity,
          remoteEntity,
          chooseNewest(localEntity, remoteEntity),
          ENTITY_FIELDS[type],
          localMeta.entityFields[type]?.[localEntity.id],
          remoteMeta.entityFields[type]?.[remoteEntity.id],
        )),
      tombstones,
    );
  }

  function mergeProfile(local = {}, remote = {}) {
    const localUpdatedAt = String(local?.updatedAt || "");
    const remoteUpdatedAt = String(remote?.updatedAt || "");
    if (!localUpdatedAt) return clone(remote);
    if (!remoteUpdatedAt) return clone(local);
    return clone(remoteUpdatedAt >= localUpdatedAt ? remote : local);
  }

  function mergeEntities(local = [], remote = [], mergeEntity = chooseNewest) {
    const byId = new Map();
    (Array.isArray(local) ? local : []).forEach((item) => byId.set(item.id, clone(item)));
    (Array.isArray(remote) ? remote : []).forEach((item) => {
      const existing = byId.get(item.id);
      byId.set(item.id, existing ? mergeEntity(existing, clone(item)) : clone(item));
    });
    return [...byId.values()];
  }

  function deduplicateJournalDates(entries) {
    const byDate = new Map();
    entries.forEach((entry) => {
      const current = byDate.get(entry.date);
      if (!current || timestampOf(entry) >= timestampOf(current)) byDate.set(entry.date, entry);
    });
    return [...byDate.values()].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  }

  function mergeTask(local, remote, localMeta, remoteMeta) {
    const newest = chooseNewest(local, remote);
    const result = mergeEntityFields(
      local,
      remote,
      newest,
      ENTITY_FIELDS.tasks,
      localMeta.entityFields.tasks?.[local.id],
      remoteMeta.entityFields.tasks?.[remote.id],
    );
    TASK_DATE_FIELDS.forEach((field) => {
      result[field] = mergeDatedValues(
        local[field],
        remote[field],
        localMeta.taskFields?.[local.id]?.[field],
        remoteMeta.taskFields?.[remote.id]?.[field],
        timestampOf(local),
        timestampOf(remote),
      );
    });
    return result;
  }

  function mergeHabit(local, remote, localMeta, remoteMeta) {
    const titleHistory = habitTitleHistory.mergeHabitTitleHistory(local, remote);
    const configHistory = habitConfigHistory.mergeHabitConfigHistory(local, remote);
    const availabilityHistory = habitConfigHistory.mergeHabitAvailabilityHistory(local, remote);
    const latestConfig = configHistory.at(-1);
    const latestAvailability = availabilityHistory.at(-1);
    const archived = latestAvailability?.active === false;
    const newest = chooseNewest(local, remote);
    return {
      ...mergeEntityFields(
        local,
        remote,
        newest,
        ENTITY_FIELDS.habits,
        localMeta.entityFields.habits?.[local.id],
        remoteMeta.entityFields.habits?.[remote.id],
      ),
      title: titleHistory.at(-1)?.title || "Привычка",
      titleHistory,
      type: latestConfig.type,
      repeat: latestConfig.repeat,
      customRepeat: clone(latestConfig.customRepeat),
      unit: latestConfig.unit,
      goal: latestConfig.goal,
      configHistory,
      availabilityHistory,
      archived,
      archivedAt: archived ? latestAvailability.updatedAt : "",
      archivedFromDate: archived ? latestAvailability.fromDate : "",
      logs: mergeDatedValues(
        local.logs,
        remote.logs,
        localMeta.habitLogs?.[local.id],
        remoteMeta.habitLogs?.[remote.id],
        timestampOf(local),
        timestampOf(remote),
      ),
      freezeDays: habitFreeze.mergeFreezeDays(local.freezeDays, remote.freezeDays),
    };
  }

  function mergeGoal(local, remote, localMeta, remoteMeta) {
    const newest = chooseNewest(local, remote);
    const mergedFields = mergeEntityFields(
      local,
      remote,
      newest,
      ENTITY_FIELDS.goals,
      localMeta.entityFields.goals?.[local.id],
      remoteMeta.entityFields.goals?.[remote.id],
    );
    const localVersions = localMeta.goalSteps?.[local.id] || {};
    const remoteVersions = remoteMeta.goalSteps?.[remote.id] || {};
    const localSteps = mapById(local.steps);
    const remoteSteps = mapById(remote.steps);
    const mergedById = new Map();
    const stepIds = new Set([...localSteps.keys(), ...remoteSteps.keys(), ...Object.keys(localVersions), ...Object.keys(remoteVersions)]);
    stepIds.forEach((stepId) => {
      const source = chooseVersionedSource(
        localSteps.has(stepId), remoteSteps.has(stepId), localVersions[stepId], remoteVersions[stepId], timestampOf(local), timestampOf(remote),
      );
      const step = source === "local" ? localSteps.get(stepId) : remoteSteps.get(stepId);
      if (step) mergedById.set(stepId, clone(step));
    });

    const preferredOrder = chooseOrder(
      idsOf(local.steps), idsOf(remote.steps), localMeta.goalStepOrder?.[local.id], remoteMeta.goalStepOrder?.[remote.id], timestampOf(local), timestampOf(remote),
    );
    const steps = orderFromIds(mergedById, preferredOrder);
    const achieved = steps.length > 0 && steps.every((step) => step.done === true);
    return {
      ...mergedFields,
      steps,
      status: achieved ? "done" : "active",
      completedAt: achieved ? newest.completedAt || latestTimestamp(local.completedAt, remote.completedAt) : "",
    };
  }

  function mergeEntityFields(local, remote, base, fields, localVersions = {}, remoteVersions = {}) {
    const result = { ...base };
    fields.forEach((field) => {
      const source = chooseVersionedSource(
        Object.hasOwn(local, field),
        Object.hasOwn(remote, field),
        localVersions[field],
        remoteVersions[field],
        timestampOf(local),
        timestampOf(remote),
      );
      const entity = source === "local" ? local : remote;
      if (Object.hasOwn(entity, field)) result[field] = clone(entity[field]);
      else delete result[field];
    });
    return result;
  }

  function mergeDatedValues(local = {}, remote = {}, localVersions = {}, remoteVersions = {}, localParent = 0, remoteParent = 0) {
    const result = {};
    const keys = new Set([
      ...Object.keys(local || {}), ...Object.keys(remote || {}), ...Object.keys(localVersions || {}), ...Object.keys(remoteVersions || {}),
    ]);
    keys.forEach((key) => {
      const source = chooseVersionedSource(
        Object.hasOwn(local || {}, key), Object.hasOwn(remote || {}, key), localVersions?.[key], remoteVersions?.[key], localParent, remoteParent,
      );
      const values = source === "local" ? local : remote;
      if (Object.hasOwn(values || {}, key)) result[key] = clone(values[key]);
    });
    return result;
  }

  function chooseVersionedSource(hasLocal, hasRemote, localVersion, remoteVersion, localParent = 0, remoteParent = 0) {
    const localTime = timestampValue(localVersion);
    const remoteTime = timestampValue(remoteVersion);
    if (localTime || remoteTime) {
      const effectiveLocal = localTime || (hasLocal ? localParent : 0);
      const effectiveRemote = remoteTime || (hasRemote ? remoteParent : 0);
      return remoteTime && effectiveRemote >= effectiveLocal ? "remote" : "local";
    }
    if (hasLocal && !hasRemote) return "local";
    if (hasRemote && !hasLocal) return "remote";
    return remoteParent >= localParent ? "remote" : "local";
  }

  function chooseNewest(local, remote) {
    return timestampOf(remote) >= timestampOf(local) ? remote : local;
  }

  function timestampOf(entity) {
    return timestampValue(entity?.updatedAt || entity?.createdAt);
  }

  function timestampValue(value) {
    const timestamp = typeof value === "number" ? value : Date.parse(value || "");
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function mergeTombstones(local = {}, remote = {}) {
    const result = {
      tasks: {}, habits: {}, goals: {}, boardItems: {}, journalEntries: {}, categories: {},
      nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {},
    };
    Object.keys(result).forEach((type) => {
      const ids = new Set([...Object.keys(local?.[type] || {}), ...Object.keys(remote?.[type] || {})]);
      ids.forEach((id) => {
        result[type][id] = latestTimestamp(local?.[type]?.[id], remote?.[type]?.[id]);
      });
    });
    return result;
  }

  function mergeSyncMeta(local, remote) {
    return {
      entityFields: mergeTimestampTree(local.entityFields, remote.entityFields),
      taskFields: mergeTimestampTree(local.taskFields, remote.taskFields),
      habitLogs: mergeTimestampTree(local.habitLogs, remote.habitLogs),
      taskOrder: mergeTimestampTree(local.taskOrder, remote.taskOrder),
      habitOrderUpdatedAt: latestTimestamp(local.habitOrderUpdatedAt, remote.habitOrderUpdatedAt),
      goalSteps: mergeTimestampTree(local.goalSteps, remote.goalSteps),
      goalStepOrder: mergeTimestampTree(local.goalStepOrder, remote.goalStepOrder),
    };
  }

  function mergeTimestampTree(local = {}, remote = {}) {
    const result = {};
    new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]).forEach((key) => {
      const localValue = local?.[key];
      const remoteValue = remote?.[key];
      if (isPlainObject(localValue) || isPlainObject(remoteValue)) {
        result[key] = mergeTimestampTree(isPlainObject(localValue) ? localValue : {}, isPlainObject(remoteValue) ? remoteValue : {});
      } else {
        result[key] = latestTimestamp(localValue, remoteValue);
      }
    });
    return result;
  }

  function mergeTaskOrder(local = {}, remote = {}, localMeta, remoteMeta, taskIds = null) {
    const result = {};
    new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]).forEach((dateKey) => {
      const preferred = chooseOrder(
        local?.[dateKey] || [], remote?.[dateKey] || [], localMeta.taskOrder?.[dateKey], remoteMeta.taskOrder?.[dateKey], 0, 0,
      );
      const allIds = [...new Set([...preferred, ...(local?.[dateKey] || []), ...(remote?.[dateKey] || [])])];
      result[dateKey] = allIds.filter((id) => !taskIds || taskIds.has(id));
    });
    return result;
  }

  function applyEntityOrder(entities, local, remote, localVersion, remoteVersion) {
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    return orderFromIds(byId, chooseOrder(idsOf(local), idsOf(remote), localVersion, remoteVersion));
  }

  function chooseOrder(local, remote, localVersion, remoteVersion, localParent = 0, remoteParent = 0) {
    const source = chooseVersionedSource(true, true, localVersion, remoteVersion, localParent, remoteParent);
    return source === "remote" ? remote : local;
  }

  function orderFromIds(byId, preferredIds) {
    const ordered = [];
    [...preferredIds, ...byId.keys()].forEach((id) => {
      if (byId.has(id) && !ordered.some((item) => item.id === id)) ordered.push(byId.get(id));
    });
    return ordered;
  }

  function withoutDeleted(entities, tombstones = {}) {
    return entities.filter((entity) => !tombstones[entity.id]);
  }

  function latestTimestamp(localValue, remoteValue) {
    if (!timestampValue(localValue)) return remoteValue || "";
    if (!timestampValue(remoteValue)) return localValue || "";
    return timestampValue(remoteValue) >= timestampValue(localValue) ? remoteValue : localValue;
  }

  function mapById(items = []) {
    return new Map((Array.isArray(items) ? items : []).filter((item) => item?.id).map((item) => [item.id, item]));
  }

  function idsOf(items = []) {
    return (Array.isArray(items) ? items : []).map((item) => item?.id).filter(Boolean);
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  global.RhythmStateMerge = { mergeStates };
  if (typeof module !== "undefined" && module.exports) module.exports = { mergeStates };
})(typeof window !== "undefined" ? window : globalThis);
