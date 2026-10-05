(function (global) {
  const syncMetadata = global.RhythmSyncMetadata || require("../sync/sync-metadata.js");
  const mcpActivity = global.RhythmMcpActivity || require("../integrations/mcp-activity.js");
  const habitTitleHistory = global.RhythmHabitTitleHistory || require("../habits/habit-title-history.js");
  const habitConfigHistory = global.RhythmHabitConfigHistory || require("../habits/habit-config-history.js");
  const habitFreeze = global.RhythmHabitFreeze || require("../habits/habit-freeze.js");
  const taskChecklist = global.RhythmTaskChecklist || require("../tasks/task-checklist.js");
  const journalModel = global.RhythmJournalModel || require("../journal/journal-model.js");
  const TASK_DATE_FIELDS = syncMetadata.TASK_DATE_FIELDS;
  const ENTITY_FIELDS = syncMetadata.ENTITY_FIELDS;

  function mergeStates(localState = {}, remoteState = {}) {
    const localMeta = syncMetadata.normalizeSyncMeta(localState.syncMeta);
    const remoteMeta = syncMetadata.normalizeSyncMeta(remoteState.syncMeta);
    const syncMeta = mergeSyncMeta(localMeta, remoteMeta);
    const tombstones = mergeTombstones(localState.tombstones, remoteState.tombstones, localMeta, remoteMeta);
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
        mergeJournal(
          local,
          remote,
          chooseNewest(local, remote),
          localMeta.entityFields.journalEntries?.[local.id],
          remoteMeta.entityFields.journalEntries?.[remote.id],
        )),
      tombstones.journalEntries,
    );
    const notes = mergeSimpleEntities(localState.notes, remoteState.notes, "notes", localMeta, remoteMeta, tombstones.notes);
    preserveNoteConflicts(notes, localState.notes, remoteState.notes, tombstones.notes);
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
    const studySubjects = mergeSimpleEntities(localState.studySubjects, remoteState.studySubjects, "studySubjects", localMeta, remoteMeta, tombstones.studySubjects);
    const studyLessons = mergeSimpleEntities(localState.studyLessons, remoteState.studyLessons, "studyLessons", localMeta, remoteMeta, tombstones.studyLessons);
    const studyFiles = mergeSimpleEntities(localState.studyFiles, remoteState.studyFiles, "studyFiles", localMeta, remoteMeta, tombstones.studyFiles);
    return {
      ...localState,
      ...remoteState,
      defaultsSeeded: localState.defaultsSeeded === true || remoteState.defaultsSeeded === true || categories.length > 0,
      profile: mergeProfile(localState.profile, remoteState.profile),
      categories,
      studySubjects,
      studyLessons,
      studyFiles,
      studyWeekCycle: chooseNewest(localState.studyWeekCycle || {}, remoteState.studyWeekCycle || {}),
      tasks,
      habits: applyEntityOrder(habits, localState.habits, remoteState.habits, localMeta.habitOrderUpdatedAt, remoteMeta.habitOrderUpdatedAt),
      goals,
      boardItems,
      journalEntries: deduplicateJournalDates(journalEntries),
      notes,
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

  function mergeJournal(local, remote, base, localVersions, remoteVersions) {
    const merged = mergeEntityFields(local, remote, base, ENTITY_FIELDS.journalEntries, localVersions, remoteVersions);
    merged.revisions = journalModel.normalizeRevisions([
      ...(local.revisions || []), ...(remote.revisions || []),
      ...(local.text && local.text !== merged.text ? [{ text: local.text, savedAt: local.updatedAt || local.createdAt }] : []),
      ...(remote.text && remote.text !== merged.text ? [{ text: remote.text, savedAt: remote.updatedAt || remote.createdAt }] : []),
    ]);
    return merged;
  }

  function preserveNoteConflicts(merged, local = [], remote = [], tombstones = {}) {
    const remoteById = mapById(remote);
    for (const note of local || []) {
      const other = remoteById.get(note.id);
      if (!other || tombstones[note.id] || !note.bodyBaseUpdatedAt || note.bodyBaseUpdatedAt !== other.bodyBaseUpdatedAt
        || note.body === other.body) continue;
      const winner = merged.find((item) => item.id === note.id);
      const losing = winner?.body === note.body ? other : note;
      let hash = 2166136261;
      for (const character of `${losing.id}:${losing.updatedAt}:${losing.body}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      const id = `conflict-${(hash >>> 0).toString(16)}-${note.id.slice(0, 100)}`;
      if (!tombstones[id] && !merged.some((item) => item.id === id)) {
        merged.push({ ...clone(losing), id, title: `${losing.title} · другая версия`.slice(0, 120), bodyBaseUpdatedAt: "" });
      }
    }
  }

  function mergeProfile(local = {}, remote = {}) {
    const localUpdatedAt = String(local?.updatedAt || "");
    const remoteUpdatedAt = String(remote?.updatedAt || "");
    const newest = !localUpdatedAt ? remote : !remoteUpdatedAt ? local : remoteUpdatedAt >= localUpdatedAt ? remote : local;
    const profileApi = global.RhythmProfileSettings || (typeof require === "function" ? require("../settings/profile-settings.js") : null);
    return { ...clone(newest), preferences: profileApi.mergePreferences(local?.preferences, remote?.preferences) };
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
      byDate.set(entry.date, current ? mergeJournal(current, entry, chooseNewest(current, entry)) : entry);
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
    result.checklistLogs = taskChecklist.mergeLogs(local.checklistLogs, remote.checklistLogs);
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
      weeklyTarget: latestConfig.weeklyTarget,
      customRepeat: clone(latestConfig.customRepeat),
      unit: latestConfig.unit,
      goal: latestConfig.goal,
      numberStep: latestConfig.numberStep,
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
    if (mergedFields.linkedTaskIds?.length || mergedFields.habitTargets?.length) {
      return { ...mergedFields, steps };
    }
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

  function mergeTombstones(local = {}, remote = {}, localMeta, remoteMeta) {
    const result = {
      tasks: {}, habits: {}, goals: {}, boardItems: {}, journalEntries: {}, notes: {}, categories: {},
      nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {},
      studySubjects: {}, studyLessons: {}, studyFiles: {},
    };
    Object.keys(result).forEach((type) => {
      const ids = new Set([...Object.keys(local?.[type] || {}), ...Object.keys(remote?.[type] || {}),
        ...Object.keys(localMeta.deletions?.[type] || {}), ...Object.keys(remoteMeta.deletions?.[type] || {})]);
      ids.forEach((id) => {
        // A versioned removal of a tombstone is an undo, not a missing deletion.
        const localTime = Math.max(timestampValue(localMeta.deletions?.[type]?.[id]), timestampValue(local?.[type]?.[id]));
        const remoteTime = Math.max(timestampValue(remoteMeta.deletions?.[type]?.[id]), timestampValue(remote?.[type]?.[id]));
        const value = remoteTime > localTime ? remote?.[type]?.[id] : localTime > remoteTime ? local?.[type]?.[id]
          : latestTimestamp(local?.[type]?.[id], remote?.[type]?.[id]);
        if (value) result[type][id] = value;
      });
    });
    return result;
  }

  function mergeSyncMeta(local, remote) {
    return {
      entityFields: mergeTimestampTree(local.entityFields, remote.entityFields),
      deletions: mergeTimestampTree(local.deletions, remote.deletions),
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

  function undoChanges(before, after, current, now = new Date().toISOString()) {
    const same = syncMetadata.sameValue;
    function invert(old, applied, latest) {
      if (same(old, applied)) return clone(latest);
      if (isPlainObject(old) && isPlainObject(applied) && isPlainObject(latest)) {
        const result = clone(latest);
        new Set([...Object.keys(old), ...Object.keys(applied)]).forEach((key) => {
          const value = invert(old[key], applied[key], latest[key]);
          if (value === undefined) delete result[key]; else result[key] = value;
        });
        return result;
      }
      return clone(same(latest, applied) ? old : latest);
    }
    const result = clone(current);
    const removed = [];
    const restored = [];
    Object.keys(ENTITY_FIELDS).forEach((type) => {
      const old = mapById(before[type]); const applied = mapById(after[type]); const latest = mapById(current[type]);
      new Set([...old.keys(), ...applied.keys()]).forEach((id) => {
        const previous = old.get(id); const next = applied.get(id); const live = latest.get(id);
        if (same(previous, next)) return;
        if (!previous && same(live, next)) { latest.delete(id); removed.push([type, id]); return; }
        if (!next) {
          if (!live && same(current.tombstones?.[type]?.[id], after.tombstones?.[type]?.[id])) {
            latest.set(id, clone(previous)); restored.push([type, id]);
          }
          return;
        }
        if (previous && live) {
          const reverted = invert(previous, next, live);
          if (!same(reverted, live)) reverted.updatedAt = new Date(Math.max(Date.parse(now), timestampOf(live) + 1)).toISOString();
          latest.set(id, reverted);
        }
      });
      const order = same(idsOf(current[type]), idsOf(after[type])) ? [...new Set([...idsOf(before[type]), ...latest.keys()])] : [...latest.keys()];
      result[type] = order.filter((id) => latest.has(id)).map((id) => latest.get(id));
    });
    Object.keys(before).forEach((key) => {
      if (Object.hasOwn(ENTITY_FIELDS, key) || ["syncMeta", "schemaVersion", "tombstones"].includes(key)) return;
      const value = invert(before[key], after[key], current[key]);
      if (value === undefined) delete result[key]; else result[key] = value;
    });
    result.tombstones = invert(before.tombstones || {}, after.tombstones || {}, current.tombstones || {});
    removed.forEach(([type, id]) => { (result.tombstones[type] ||= {})[id] = now; });
    restored.forEach(([type, id]) => { delete result.tombstones[type]?.[id]; });
    return result;
  }

  global.RhythmStateMerge = { mergeStates, undoChanges };
  if (typeof module !== "undefined" && module.exports) module.exports = { mergeStates, undoChanges };
})(typeof window !== "undefined" ? window : globalThis);
