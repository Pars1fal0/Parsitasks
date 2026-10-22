// Document and UI state bootstrapping: storage, settings and the state controller.

import * as documentState from "../core/document-state.js";
import * as appUtilsModule from "../core/app-utils.js";
import * as syncMetadata from "../sync/sync-metadata.js";
import * as storageModule from "../core/storage.js";
import * as settingsStateModule from "../settings/settings-state.js";
import * as navigationStateModule from "../core/navigation-state.js";
import * as stateControllerModule from "../core/state-controller.js";
import * as stateMerge from "../core/state-merge.js";
import * as navigationPreferencesModule from "../settings/navigation-preferences.js";
import * as reminderPolicy from "../platform/reminder-policy.js";
import * as overdueControllerModule from "../tasks/overdue-controller.js";
import * as taskStateModule from "../tasks/task-state.js";
import { app } from "./store.js";
import { normalizeState } from "./persistence.js";
import { getTaskDeadlineDate } from "./platform.js";
import { isTaskDone, isTaskExcluded, taskScheduledOn } from "./queries.js";
import { remoteAuth } from "./services.js";
import { normalizeAccentPreference, normalizeBackupSchedule, normalizeDensityPreference, normalizeFirstDayOfWeek, normalizeNotificationSetting, normalizeRemoteSyncEnabled, normalizeThemePreference, normalizeTimeFormat } from "./settings.js";

export let appUtils, addDays, cleanText, cleanTimeValue, createId, escapeHtml, formatLongDate, formatMonthLabel, formatShortDate, formatTime, formatWeekday, getMonthCalendarDates, getWeekDates, heatAlpha, minutesToTime, normalizeDateKey, parseDate, randomCategoryColor, timeToMinutes, toDateKey, toTimeValue, syncMetadataTracker, storage, initialStateLoad, settingsState, initialUiState, initialRoute, stateController, startupToday, storedActiveDate, storedToday, formSnapshots, overdueController, taskState;

export const SCHEMA_VERSION = documentState.SCHEMA_VERSION;

export const VALID_BACKUP_SCHEDULES = ["0", "5", "15", "30", "60"];

export const VALID_VIEWS = ["tasks", "timeline", "habits", "goals", "overview", "study", "nutrition", "journal", "board", "archive", "settings"];

export function setupState() {
  appUtils = appUtilsModule.createAppUtils({
    getFirstDayOfWeek: () => app.firstDayOfWeek,
    getTimeFormat: () => app.timeFormat,
  });

  ({
    addDays,
    cleanText,
    cleanTimeValue,
    createId,
    escapeHtml,
    formatLongDate,
    formatMonthLabel,
    formatShortDate,
    formatTime,
    formatWeekday,
    getMonthCalendarDates,
    getWeekDates,
    heatAlpha,
    minutesToTime,
    normalizeDateKey,
    parseDate,
    randomCategoryColor,
    timeToMinutes,
    toDateKey,
    toTimeValue,
  } = appUtils);

  syncMetadataTracker = syncMetadata.createSyncMetadataTracker();

  storage = storageModule.createLocalStorageAdapter({
    appName: "Parsitasks",
    schemaVersion: SCHEMA_VERSION,
  });

  initialStateLoad = storage.loadStateWithRecovery();

  settingsState = settingsStateModule.createSettingsState({
    cleanText,
    validBackupSchedules: VALID_BACKUP_SCHEDULES,
  });

  initialUiState = storage.loadUiState();

  initialRoute = navigationStateModule.parseHash(window.location.hash);

  stateController = stateControllerModule.createStateController({
    clone: syncMetadata.clone,
    initialState: initialStateLoad.state,
    normalizeState,
    schemaVersion: SCHEMA_VERSION,
    storage,
    getOwner: () => remoteAuth.getSession()?.user?.id || app.remoteSyncAccountId || "",
    mergeStates: stateMerge.mergeStates,
    sameValue: syncMetadata.sameValue,
    trackChanges: (previous, next) => syncMetadataTracker.trackChanges(previous, next),
  });

  app.state = stateController.getState();

  startupToday = toDateKey(new Date());

  storedActiveDate = normalizeDateKey(initialUiState.activeDate, "");

  storedToday = normalizeDateKey(initialUiState.currentToday, "");

  app.activeDate = storedActiveDate && storedToday && storedActiveDate !== storedToday
    ? storedActiveDate
    : startupToday;

  app.currentToday = startupToday;

  app.taskFilter = ["all", "open", "done"].includes(initialUiState.taskFilter)
    ? initialUiState.taskFilter
    : "all";

  app.activeView = initialRoute?.view || (VALID_VIEWS.includes(initialUiState.activeView) ? initialUiState.activeView : "tasks");

  app.taskPane = ["day", "later", "backlog"].includes(initialUiState.taskPane) ? initialUiState.taskPane : "day";

  app.showStudyEvents = initialUiState.showStudyEvents !== false;

  app.overviewMode = initialRoute?.overviewMode || (["day", "week", "month", "year"].includes(initialUiState.overviewMode)
    ? initialUiState.overviewMode
    : "week");

  app.taskCategoryFilter = initialUiState.taskCategoryFilter || "all";

  app.taskSearchQuery = initialUiState.taskSearchQuery || "";

  app.archiveCategoryFilter = initialUiState.archiveCategoryFilter || "all";

  app.archiveSearchQuery = initialUiState.archiveSearchQuery || "";

  app.archivePeriod = ["all", "week", "month", "quarter"].includes(initialUiState.archivePeriod)
    ? initialUiState.archivePeriod
    : "all";

  app.overdueHidden = initialUiState.overdueHidden === true;

  app.themePreference = normalizeThemePreference(initialUiState.themePreference);

  app.accentPreference = normalizeAccentPreference(initialUiState.accentPreference);

  app.notificationSetting = normalizeNotificationSetting(initialUiState.notificationSetting);

  app.navigationPreferences = navigationPreferencesModule.normalize(initialUiState.navigationPreferences);

  app.quietHours = reminderPolicy.normalizeQuietHours(initialUiState.quietHours);

  app.backupSchedule = normalizeBackupSchedule(initialUiState.backupSchedule);

  app.firstDayOfWeek = normalizeFirstDayOfWeek(initialUiState.firstDayOfWeek);

  app.densityPreference = normalizeDensityPreference(initialUiState.densityPreference);

  app.timeFormat = normalizeTimeFormat(initialUiState.timeFormat);

  app.appliedAccountPreferences = "";

  app.remoteSyncEnabled = normalizeRemoteSyncEnabled(initialUiState.remoteSyncEnabled);

  app.remoteSyncUrl = cleanText(initialUiState.remoteSyncUrl || "");

  app.remoteSyncAnonKey = cleanText(initialUiState.remoteSyncAnonKey || "");

  app.remoteSyncAccountId = cleanText(initialUiState.remoteSyncAccountId || "");

  app.authenticatedSyncGeneration = 0;

  app.remoteSyncLastPushedAt = initialUiState.remoteSyncLastPushedAt || "";

  app.remoteSyncLastPulledAt = initialUiState.remoteSyncLastPulledAt || "";

  app.remoteSyncPending = initialUiState.remoteSyncPending === true;

  app.managedRemoteConfig = false;

  app.localStateUpdatedAt = initialUiState.localStateUpdatedAt || "";

  app.autoBackupTimerId = null;

  app.lastAutoBackupAt = typeof initialUiState.lastAutoBackupAt === "string"
    && Number.isFinite(Date.parse(initialUiState.lastAutoBackupAt))
    ? initialUiState.lastAutoBackupAt
    : "";

  app.nextAutoBackupAt = "";

  formSnapshots = new WeakMap();

  app.localStorageError = initialStateLoad.status === "newer" || initialStateLoad.reason === "newer-backup"
    ? "Данные созданы более новой версией · обнови приложение, исходные данные сохранены"
    : initialStateLoad.status === "corrupt"
    ? "Локальные данные повреждены · восстанови backup или облако"
    : initialStateLoad.status === "recovered-memory"
      ? "Backup открыт, но локальное сохранение недоступно"
      : "";

  overdueController = overdueControllerModule.createOverdueController({
    getCacheKey: () => app.localStateUpdatedAt,
    getTaskDeadlineDate,
    getTasks: () => app.state.tasks,
    isAcknowledged: (task, dateKey) => task.acknowledgedOverdue?.[dateKey] === true,
    isTaskDone,
    isTaskExcluded,
    taskScheduledOn,
    toDateKey,
  });

  taskState = taskStateModule.createTaskState({ getState: () => app.state });
}
