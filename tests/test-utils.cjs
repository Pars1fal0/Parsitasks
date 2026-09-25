const quickInput = require("../app/src/tasks/quick-input.js");
const recurrence = require("../app/src/tasks/recurrence.js");
const storageApi = require("../app/src/core/storage.js");
const taskMoves = require("../app/src/tasks/task-moves.js");
const stateNormalizerApi = require("../app/src/core/state-normalizer.js");
const syncMetadata = require("../app/src/sync/sync-metadata.js");
const habitTitleHistory = require("../app/src/habits/habit-title-history.js");
const habitConfigHistory = require("../app/src/habits/habit-config-history.js");
const mcpActivity = require("../app/src/integrations/mcp-activity.js");
const journalModel = require("../app/src/journal/journal-model.js");
const nutritionModel = require("../app/src/nutrition/nutrition-model.js");
const boardModel = require("../app/src/board/board-model.js");

function normalizeDateKey(value, fallback = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return fallback;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return fallback;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(value) {
  const normalized = normalizeDateKey(value, "");
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toTimeValue(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function cleanText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function createStateNormalizer() {
  return stateNormalizerApi.createStateNormalizer({
    schemaVersion: 16,
    validPriorities: ["high", "medium", "low"],
    cleanText,
    cleanTimeValue: (value) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
      if (!match) return "";
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    },
    createId: (() => {
      let index = 0;
      return () => `id-${(index += 1)}`;
    })(),
    normalizeDateKey: (value, fallback = "2026-06-26") => normalizeDateKey(value, fallback),
    normalizeHabitLogs: (value) => {
      const logs = {};
      Object.entries(value || {}).forEach(([dateKey, entry]) => {
        const normalizedDate = normalizeDateKey(dateKey, "");
        if (!normalizedDate) return;
        if (entry === true) logs[normalizedDate] = true;
        else if (Number(entry) > 0) logs[normalizedDate] = Number(entry);
      });
      return logs;
    },
    normalizeHabitFreezeDays: require("../app/src/habits/habit-freeze.js").normalizeFreezeDays,
    normalizeHabitConfigHistory: habitConfigHistory.normalizeHabitConfigHistory,
    normalizeHabitAvailabilityHistory: habitConfigHistory.normalizeHabitAvailabilityHistory,
    normalizeHabitRepeat: (value) =>
      ["daily", "every2days", "every3days", "weekdays", "weekends", "weekly", "custom"].includes(value)
        ? value
        : "daily",
    normalizeHabitTitleHistory: habitTitleHistory.normalizeHabitTitleHistory,
    normalizeReminderOffset: (value, hasTime = true) => {
      const offset = String(value ?? (hasTime ? "15" : "none"));
      return ["none", "0", "5", "15", "30", "60", "1440"].includes(offset) ? offset : hasTime ? "15" : "none";
    },
    normalizeSyncMeta: syncMetadata.normalizeSyncMeta,
    normalizeMcpActivity: mcpActivity.normalizeActivity,
    normalizeJournalEntries: journalModel.normalizeJournalEntries,
    normalizeNutritionFood: nutritionModel.normalizeFood,
    normalizeNutritionMeal: nutritionModel.normalizeMeal,
    normalizeNutritionTemplate: nutritionModel.normalizeTemplate,
    normalizeNutritionSettings: nutritionModel.normalizeSettings,
    normalizeBoardItems: boardModel.normalizeItems,
    pruneSyncMeta: syncMetadata.pruneSyncMeta,
    normalizeTaskFlags: (value) => {
      const flags = {};
      Object.entries(value || {}).forEach(([dateKey, entry]) => {
        const normalizedDate = normalizeDateKey(dateKey, "");
        if (normalizedDate && entry === true) flags[normalizedDate] = true;
      });
      return flags;
    },
    normalizeTaskOrder: (value) => {
      const order = {};
      Object.entries(value || {}).forEach(([dateKey, ids]) => {
        const normalizedDate = normalizeDateKey(dateKey, "");
        if (normalizedDate && Array.isArray(ids)) order[normalizedDate] = ids.map(String);
      });
      return order;
    },
    randomCategoryColor: () => "#00a78e",
    recurrence,
    sanitizeColor: (value) => (/^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : ""),
    toDateKey,
  });
}

module.exports = {
  cleanText,
  createMemoryStorage,
  createStateNormalizer,
  normalizeDateKey,
  parseDateKey,
  quickInput,
  recurrence,
  storageApi,
  taskMoves,
  toDateKey,
  toTimeValue,
};
