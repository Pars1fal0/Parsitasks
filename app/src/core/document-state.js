import * as appUtilsApi from "./app-utils.js";
import * as dataNormalizersApi from "./data-normalizers.js";
import * as habitConfigHistoryApi from "../habits/habit-config-history.js";
import * as goalActivityApi from "../goals/goal-activity.js";
import * as nutritionModelApi from "../nutrition/nutrition-model.js";
import * as studyModelApi from "../study/study-model.js";
import * as syncMetadataApi from "../sync/sync-metadata.js";
import * as taskChecklistApi from "../tasks/task-checklist.js";
import * as stateNormalizerApi from "./state-normalizer.js";
import * as habitFreezeApi from "../habits/habit-freeze.js";
import * as habitTitleHistoryApi from "../habits/habit-title-history.js";
import * as mcpActivityApi from "../integrations/mcp-activity.js";
import * as boardModelApi from "../board/board-model.js";
import * as journalModelApi from "../journal/journal-model.js";
import * as notesModelApi from "../notes/notes-model.js";
import * as profileSettingsApi from "../settings/profile-settings.js";
import * as tombstoneRetentionApi from "../sync/tombstone-retention.js";
import * as recurrenceApi from "../tasks/recurrence.js";

const SCHEMA_VERSION = 26;
const VALID_HABIT_REPEATS = ["daily", "every2days", "every3days", "weekdays", "weekends", "weekly", "weeklyGoal", "custom"];
const VALID_REMINDER_OFFSETS = ["none", "0", "5", "15", "30", "60", "1440"];
const VALID_PRIORITIES = ["high", "medium", "low"];

let normalizer = null;

function normalizeHabitRepeat(value) {
  return VALID_HABIT_REPEATS.includes(value) ? value : "daily";
}

function normalizeReminderOffset(value, hasTime = true) {
  const offset = String(value ?? (hasTime ? "15" : "none"));
  if (VALID_REMINDER_OFFSETS.includes(offset)) return offset;
  return hasTime ? "15" : "none";
}

function createNormalizer() {
  const utils = appUtilsApi.createAppUtils({
    getFirstDayOfWeek: () => 1,
    getTimeFormat: () => "24",
  });
  const dataNormalizers = dataNormalizersApi.createDataNormalizers({
    normalizeDateKey: utils.normalizeDateKey,
  });
  const habitConfigHistory = habitConfigHistoryApi;
  const goalActivity = goalActivityApi;
  const nutritionModel = nutritionModelApi;
  const studyModel = studyModelApi;
  const syncMetadata = syncMetadataApi;
  const taskChecklist = taskChecklistApi;

  return stateNormalizerApi.createStateNormalizer({
    schemaVersion: SCHEMA_VERSION,
    validPriorities: VALID_PRIORITIES,
    cleanText: utils.cleanText,
    cleanTimeValue: utils.cleanTimeValue,
    createId: utils.createId,
    normalizeDateKey: utils.normalizeDateKey,
    normalizeHabitLogs: dataNormalizers.normalizeHabitLogs,
    normalizeTaskChecklist: taskChecklist.normalizeItems,
    normalizeTaskChecklistLogs: taskChecklist.normalizeLogs,
    normalizeHabitFreezeDays: habitFreezeApi.normalizeFreezeDays,
    normalizeHabitRepeat,
    normalizeHabitConfigHistory: habitConfigHistory.normalizeHabitConfigHistory,
    normalizeHabitAvailabilityHistory: habitConfigHistory.normalizeHabitAvailabilityHistory,
    normalizeHabitTitleHistory: habitTitleHistoryApi.normalizeHabitTitleHistory,
    normalizeReminderOffset,
    normalizeMcpActivity: mcpActivityApi.normalizeActivity,
    normalizeBoardItems: boardModelApi.normalizeItems,
    normalizeJournalEntries: journalModelApi.normalizeJournalEntries,
    normalizeNotes: notesModelApi.normalizeNotes,
    normalizeLinkedTaskIds: goalActivity.normalizeLinkedTaskIds,
    normalizeTaskTargets: goalActivity.normalizeTaskTargets,
    normalizeHabitTargets: goalActivity.normalizeHabitTargets,
    normalizeNutritionFood: nutritionModel.normalizeFood,
    normalizeNutritionMeal: nutritionModel.normalizeMeal,
    normalizeNutritionSettings: nutritionModel.normalizeSettings,
    normalizeNutritionTemplate: nutritionModel.normalizeTemplate,
    normalizeProfile: profileSettingsApi.normalizeProfile,
    pruneTombstones: tombstoneRetentionApi.pruneTombstones,
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
    recurrence: recurrenceApi,
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

export { SCHEMA_VERSION, VALID_HABIT_REPEATS, createEmptyState, ensureDocumentShape, normalizeHabitRepeat, normalizeState };
export default api;
