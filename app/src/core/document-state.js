(function (global) {
  const SCHEMA_VERSION = 26;
  const VALID_HABIT_REPEATS = ["daily", "every2days", "every3days", "weekdays", "weekends", "weekly", "weeklyGoal", "custom"];
  const VALID_REMINDER_OFFSETS = ["none", "0", "5", "15", "30", "60", "1440"];
  const VALID_PRIORITIES = ["high", "medium", "low"];

  let normalizer = null;

  function load(name, path) {
    if (global[name]) return global[name];
    return require(path);
  }

  function normalizeHabitRepeat(value) {
    return VALID_HABIT_REPEATS.includes(value) ? value : "daily";
  }

  function normalizeReminderOffset(value, hasTime = true) {
    const offset = String(value ?? (hasTime ? "15" : "none"));
    if (VALID_REMINDER_OFFSETS.includes(offset)) return offset;
    return hasTime ? "15" : "none";
  }

  function createNormalizer() {
    const utils = load("RhythmAppUtils", "./app-utils.js").createAppUtils({
      getFirstDayOfWeek: () => 1,
      getTimeFormat: () => "24",
    });
    const dataNormalizers = load("RhythmDataNormalizers", "./data-normalizers.js").createDataNormalizers({
      normalizeDateKey: utils.normalizeDateKey,
    });
    const habitConfigHistory = load("RhythmHabitConfigHistory", "../habits/habit-config-history.js");
    const goalActivity = load("RhythmGoalActivity", "../goals/goal-activity.js");
    const nutritionModel = load("RhythmNutritionModel", "../nutrition/nutrition-model.js");
    const studyModel = load("RhythmStudyModel", "../study/study-model.js");
    const syncMetadata = load("RhythmSyncMetadata", "../sync/sync-metadata.js");
    const taskChecklist = load("RhythmTaskChecklist", "../tasks/task-checklist.js");

    return load("RhythmStateNormalizer", "./state-normalizer.js").createStateNormalizer({
      schemaVersion: SCHEMA_VERSION,
      validPriorities: VALID_PRIORITIES,
      cleanText: utils.cleanText,
      cleanTimeValue: utils.cleanTimeValue,
      createId: utils.createId,
      normalizeDateKey: utils.normalizeDateKey,
      normalizeHabitLogs: dataNormalizers.normalizeHabitLogs,
      normalizeTaskChecklist: taskChecklist.normalizeItems,
      normalizeTaskChecklistLogs: taskChecklist.normalizeLogs,
      normalizeHabitFreezeDays: load("RhythmHabitFreeze", "../habits/habit-freeze.js").normalizeFreezeDays,
      normalizeHabitRepeat,
      normalizeHabitConfigHistory: habitConfigHistory.normalizeHabitConfigHistory,
      normalizeHabitAvailabilityHistory: habitConfigHistory.normalizeHabitAvailabilityHistory,
      normalizeHabitTitleHistory: load("RhythmHabitTitleHistory", "../habits/habit-title-history.js").normalizeHabitTitleHistory,
      normalizeReminderOffset,
      normalizeMcpActivity: load("RhythmMcpActivity", "../integrations/mcp-activity.js").normalizeActivity,
      normalizeBoardItems: load("RhythmBoardModel", "../board/board-model.js").normalizeItems,
      normalizeJournalEntries: load("RhythmJournalModel", "../journal/journal-model.js").normalizeJournalEntries,
      normalizeNotes: load("RhythmNotesModel", "../notes/notes-model.js").normalizeNotes,
      normalizeLinkedTaskIds: goalActivity.normalizeLinkedTaskIds,
      normalizeTaskTargets: goalActivity.normalizeTaskTargets,
      normalizeHabitTargets: goalActivity.normalizeHabitTargets,
      normalizeNutritionFood: nutritionModel.normalizeFood,
      normalizeNutritionMeal: nutritionModel.normalizeMeal,
      normalizeNutritionSettings: nutritionModel.normalizeSettings,
      normalizeNutritionTemplate: nutritionModel.normalizeTemplate,
      normalizeProfile: load("RhythmProfileSettings", "../settings/profile-settings.js").normalizeProfile,
      pruneTombstones: load("RhythmTombstoneRetention", "../sync/tombstone-retention.js").pruneTombstones,
      normalizeSyncMeta: syncMetadata.normalizeSyncMeta,
      pruneSyncMeta: syncMetadata.pruneSyncMeta,
      normalizeTaskFlags: dataNormalizers.normalizeTaskFlags,
      normalizeTaskOrder: dataNormalizers.normalizeTaskOrder,
      normalizeStudySubjects: studyModel.normalizeSubjects,
      normalizeStudyLessons: studyModel.normalizeLessons,
      normalizeStudyFiles: studyModel.normalizeFiles,
      normalizeStudyWeekCycle: studyModel.normalizeWeekCycle,
      normalizeTaskStudy: studyModel.normalizeTaskStudy,
      randomCategoryColor: utils.randomCategoryColor,
      recurrence: load("RhythmRecurrence", "../tasks/recurrence.js"),
      sanitizeColor: utils.sanitizeColor,
      toDateKey: utils.toDateKey,
    });
  }

  function stateNormalizer() {
    normalizer ||= createNormalizer();
    return normalizer;
  }

  function normalizeState(raw) {
    return stateNormalizer().normalizeState(raw);
  }

  function cloneValue(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  function createEmptyState() {
    return normalizeState(null);
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function sameKind(example, value) {
    if (Array.isArray(example)) return Array.isArray(value);
    if (isPlainObject(example)) return isPlainObject(value);
    if (typeof example === "boolean") return typeof value === "boolean";
    return value !== undefined && value !== null;
  }

  function mergeBuckets(current, fallback) {
    const base = isPlainObject(current) ? current : {};
    Object.keys(fallback).forEach((key) => {
      if (!isPlainObject(base[key])) base[key] = {};
    });
    return base;
  }

  function mergeSyncMeta(current, fallback) {
    const base = isPlainObject(current) ? current : {};
    Object.keys(fallback).forEach((key) => {
      if (key === "entityFields") return;
      if (!sameKind(fallback[key], base[key])) base[key] = cloneValue(fallback[key]);
    });
    base.entityFields = mergeBuckets(base.entityFields, fallback.entityFields || {});
    return base;
  }

  function ensureDocumentShape(state) {
    if (!isPlainObject(state)) return createEmptyState();
    const empty = createEmptyState();
    Object.keys(empty).forEach((key) => {
      if (key === "schemaVersion" || key === "tombstones" || key === "syncMeta") return;
      if (!sameKind(empty[key], state[key])) state[key] = cloneValue(empty[key]);
    });
    const version = Number(state.schemaVersion);
    state.schemaVersion = Number.isInteger(version) && version > 0 ? version : SCHEMA_VERSION;
    state.tombstones = mergeBuckets(state.tombstones, empty.tombstones);
    state.syncMeta = mergeSyncMeta(state.syncMeta, empty.syncMeta);
    return state;
  }

  const api = {
    SCHEMA_VERSION,
    VALID_HABIT_REPEATS,
    createEmptyState,
    ensureDocumentShape,
    normalizeHabitRepeat,
    normalizeState,
  };
  global.RhythmDocumentState = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
