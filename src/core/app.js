const SCHEMA_VERSION = 15;
const VALID_PRIORITIES = ["high", "medium", "low"];
const VALID_HABIT_REPEATS = ["daily", "every2days", "every3days", "weekdays", "weekends", "weekly", "custom"];
const VALID_REMINDER_OFFSETS = ["none", "0", "5", "15", "30", "60", "1440"];
const VALID_BACKUP_SCHEDULES = ["0", "5", "15", "30", "60"];
const VALID_VIEWS = ["tasks", "timeline", "habits", "goals", "overview", "nutrition", "journal", "board", "archive", "settings"];

const appUtils = window.RhythmAppUtils.createAppUtils({
  getFirstDayOfWeek: () => firstDayOfWeek,
  getTimeFormat: () => timeFormat,
});
const {
  addDays,
  cleanText,
  cleanTimeValue,
  createId,
  escapeHtml,
  firstDayIndex,
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
  sanitizeColor,
  timeToMinutes,
  toDateKey,
  toTimeValue,
} = appUtils;

const dataNormalizers = window.RhythmDataNormalizers.createDataNormalizers({ normalizeDateKey });
const { normalizeHabitLogs, normalizeTaskFlags, normalizeTaskOrder } = dataNormalizers;
const syncMetadataTracker = window.RhythmSyncMetadata.createSyncMetadataTracker();

const storage = window.RhythmStorage.createLocalStorageAdapter({
  appName: "Parsitasks",
  schemaVersion: SCHEMA_VERSION,
});
const initialStateLoad = storage.loadStateWithRecovery();
const settingsState = window.RhythmSettingsState.createSettingsState({
  cleanText,
  validBackupSchedules: VALID_BACKUP_SCHEDULES,
});
const profileSettings = window.RhythmProfileSettings;
const stateNormalizer = window.RhythmStateNormalizer.createStateNormalizer({
  schemaVersion: SCHEMA_VERSION,
  validPriorities: VALID_PRIORITIES,
  cleanText,
  cleanTimeValue,
  createId,
  normalizeDateKey,
  normalizeHabitLogs,
  normalizeHabitRepeat,
  normalizeHabitConfigHistory: window.RhythmHabitConfigHistory.normalizeHabitConfigHistory,
  normalizeHabitAvailabilityHistory: window.RhythmHabitConfigHistory.normalizeHabitAvailabilityHistory,
  normalizeHabitTitleHistory: window.RhythmHabitTitleHistory.normalizeHabitTitleHistory,
  normalizeReminderOffset,
  normalizeMcpActivity: window.RhythmMcpActivity.normalizeActivity,
  normalizeBoardItems: window.RhythmBoardModel.normalizeItems,
  normalizeJournalEntries: window.RhythmJournalModel.normalizeJournalEntries,
  normalizeNutritionFood: window.RhythmNutritionModel.normalizeFood,
  normalizeNutritionMeal: window.RhythmNutritionModel.normalizeMeal,
  normalizeNutritionSettings: window.RhythmNutritionModel.normalizeSettings,
  normalizeNutritionTemplate: window.RhythmNutritionModel.normalizeTemplate,
  normalizeProfile: profileSettings.normalizeProfile,
  pruneTombstones: window.RhythmTombstoneRetention.pruneTombstones,
  normalizeSyncMeta: window.RhythmSyncMetadata.normalizeSyncMeta,
  pruneSyncMeta: window.RhythmSyncMetadata.pruneSyncMeta,
  normalizeTaskFlags,
  normalizeTaskOrder,
  randomCategoryColor,
  recurrence: window.RhythmRecurrence,
  sanitizeColor,
  toDateKey,
});

const initialUiState = storage.loadUiState();
const initialRoute = window.RhythmNavigationState.parseHash(window.location.hash);
const stateController = window.RhythmStateController.createStateController({
  clone: window.RhythmSyncMetadata.clone,
  initialState: initialStateLoad.state,
  normalizeState,
  schemaVersion: SCHEMA_VERSION,
  storage,
  trackChanges: (previous, next) => syncMetadataTracker.trackChanges(previous, next),
});
let state = stateController.getState();
const startupToday = toDateKey(new Date());
const storedActiveDate = normalizeDateKey(initialUiState.activeDate, "");
const storedToday = normalizeDateKey(initialUiState.currentToday, "");
let activeDate = storedActiveDate && storedToday && storedActiveDate !== storedToday
  ? storedActiveDate
  : startupToday;
let currentToday = startupToday;
let taskFilter = ["all", "open", "done"].includes(initialUiState.taskFilter)
  ? initialUiState.taskFilter
  : "all";
let activeView = initialRoute?.view || (VALID_VIEWS.includes(initialUiState.activeView) ? initialUiState.activeView : "tasks");
let overviewMode = initialRoute?.overviewMode || (["week", "month", "year"].includes(initialUiState.overviewMode)
  ? initialUiState.overviewMode
  : "week");
let taskCategoryFilter = initialUiState.taskCategoryFilter || "all";
let taskSearchQuery = initialUiState.taskSearchQuery || "";
let archiveCategoryFilter = initialUiState.archiveCategoryFilter || "all";
let archiveSearchQuery = initialUiState.archiveSearchQuery || "";
let archivePeriod = ["all", "week", "month", "quarter"].includes(initialUiState.archivePeriod)
  ? initialUiState.archivePeriod
  : "all";
let overdueHidden = initialUiState.overdueHidden === true;
let themePreference = normalizeThemePreference(initialUiState.themePreference);
let accentPreference = normalizeAccentPreference(initialUiState.accentPreference);
let notificationSetting = normalizeNotificationSetting(initialUiState.notificationSetting);
let backupSchedule = normalizeBackupSchedule(initialUiState.backupSchedule);
let firstDayOfWeek = normalizeFirstDayOfWeek(initialUiState.firstDayOfWeek);
let densityPreference = normalizeDensityPreference(initialUiState.densityPreference);
let timeFormat = normalizeTimeFormat(initialUiState.timeFormat);
let remoteSyncEnabled = normalizeRemoteSyncEnabled(initialUiState.remoteSyncEnabled);
let remoteSyncUrl = cleanText(initialUiState.remoteSyncUrl || "");
let remoteSyncAnonKey = cleanText(initialUiState.remoteSyncAnonKey || "");
let remoteSyncAccountId = cleanText(initialUiState.remoteSyncAccountId || "");
let remoteSyncLastPushedAt = initialUiState.remoteSyncLastPushedAt || "";
let remoteSyncLastPulledAt = initialUiState.remoteSyncLastPulledAt || "";
let remoteSyncPending = initialUiState.remoteSyncPending === true;
let managedRemoteConfig = false;
let localStateUpdatedAt = initialUiState.localStateUpdatedAt || "";
let autoBackupTimerId = null;
let lastAutoBackupAt = typeof initialUiState.lastAutoBackupAt === "string"
  && Number.isFinite(Date.parse(initialUiState.lastAutoBackupAt))
  ? initialUiState.lastAutoBackupAt
  : "";
let nextAutoBackupAt = "";
const formSnapshots = new WeakMap();
let localStorageError = initialStateLoad.status === "corrupt"
  ? "Локальные данные повреждены · восстанови backup или облако"
  : initialStateLoad.status === "recovered-memory"
    ? "Backup открыт, но локальное сохранение недоступно"
    : "";

const overdueController = window.RhythmOverdueController.createOverdueController({
  getCacheKey: () => localStateUpdatedAt,
  getTaskDeadlineDate,
  getTasks: () => state.tasks,
  isAcknowledged: (task, dateKey) => task.acknowledgedOverdue?.[dateKey] === true,
  isTaskDone,
  isTaskExcluded,
  taskScheduledOn,
  toDateKey,
});
const taskState = window.RhythmTaskState.createTaskState({ getState: () => state });

const els = {
  activeDate: document.querySelector("#activeDate"),
  archiveCategoryFilter: document.querySelector("#archiveCategoryFilter"),
  archiveBulkBar: document.querySelector("#archiveBulkBar"),
  archiveBulkCount: document.querySelector("#archiveBulkCount"),
  archiveBulkDelete: document.querySelector("#archiveBulkDelete"),
  archiveBulkRestore: document.querySelector("#archiveBulkRestore"),
  archiveEmpty: document.querySelector("#archiveEmpty"),
  archiveList: document.querySelector("#archiveList"),
  archivePeriodFilter: document.querySelector("#archivePeriodFilter"),
  archiveSearch: document.querySelector("#archiveSearch"),
  archiveSelectAll: document.querySelector("#archiveSelectAll"),
  accentPreferences: document.querySelectorAll('input[name="accentPreference"]'),
  backupStatus: document.querySelector("#backupStatus"),
  backupSchedule: document.querySelector("#backupSchedule"),
  categoryColor: document.querySelector("#categoryColor"),
  categoryForm: document.querySelector("#categoryForm"),
  taskInlineCategory: document.querySelector("#taskInlineCategory"),
  taskInlineCategoryName: document.querySelector("#taskInlineCategoryName"),
  taskInlineCategoryColor: document.querySelector("#taskInlineCategoryColor"),
  taskInlineCategorySave: document.querySelector("#taskInlineCategorySave"),
  activeTaskFilters: document.querySelector("#activeTaskFilters"),
  activeTaskFiltersLabel: document.querySelector("#activeTaskFiltersLabel"),
  taskFilterSummary: document.querySelector("#taskFilterSummary"),
  resetActiveTaskFilters: document.querySelector("#resetActiveTaskFilters"),
  categoryId: document.querySelector("#categoryId"),
  categoryList: document.querySelector("#categoryList"),
  categoryName: document.querySelector("#categoryName"),
  clearArchiveFilter: document.querySelector("#clearArchiveFilter"),
  clearTaskSearch: document.querySelector("#clearTaskSearch"),
  closeGoalForm: document.querySelector("#closeGoalForm"),
  confirmAccept: document.querySelector("#confirmAccept"),
  confirmCancel: document.querySelector("#confirmCancel"),
  confirmMessage: document.querySelector("#confirmMessage"),
  confirmModal: document.querySelector("#confirmModal"),
  confirmSecondary: document.querySelector("#confirmSecondary"),
  confirmTitle: document.querySelector("#confirmTitle"),
  confirmVerification: document.querySelector("#confirmVerification"),
  confirmVerificationInput: document.querySelector("#confirmVerificationInput"),
  confirmVerificationLabel: document.querySelector("#confirmVerificationLabel"),
  desktopStatus: document.querySelector("#desktopStatus"),
  densityPreference: document.querySelector("#densityPreference"),
  exportButton: document.querySelector("#exportButton"),
  excludedList: document.querySelector("#excludedList"),
  excludedPanel: document.querySelector("#excludedPanel"),
  focusBar: document.querySelector("#focusBar"),
  focusMeta: document.querySelector("#focusMeta"),
  focusPercent: document.querySelector("#focusPercent"),
  focusTitle: document.querySelector("#focusTitle"),
  fileBackupStatus: document.querySelector("#fileBackupStatus"),
  formBackdrop: document.querySelector("#formBackdrop"),
  firstDayOfWeek: document.querySelector("#firstDayOfWeek"),
  goalActiveMetric: document.querySelector("#goalActiveMetric"),
  addGoalCheckpoint: document.querySelector("#addGoalCheckpoint"),
  goalCheckpointEmpty: document.querySelector("#goalCheckpointEmpty"),
  goalCheckpointInput: document.querySelector("#goalCheckpointInput"),
  goalCheckpointList: document.querySelector("#goalCheckpointList"),
  goalDoneMetric: document.querySelector("#goalDoneMetric"),
  goalDueDate: document.querySelector("#goalDueDate"),
  goalEmpty: document.querySelector("#goalEmpty"),
  goalForm: document.querySelector("#goalForm"),
  goalFormHeading: document.querySelector("#goalFormHeading"),
  goalFormPanel: document.querySelector("#goalFormPanel"),
  goalId: document.querySelector("#goalId"),
  goalList: document.querySelector("#goalList"),
  goalOverdueMetric: document.querySelector("#goalOverdueMetric"),
  goalTitle: document.querySelector("#goalTitle"),
  globalSearchButton: document.querySelector("#globalSearchButton"),
  globalSearchClose: document.querySelector("#globalSearchClose"),
  globalSearchDialog: document.querySelector("#globalSearchDialog"),
  globalSearchInput: document.querySelector("#globalSearchInput"),
  globalSearchResults: document.querySelector("#globalSearchResults"),
  habitDoneMetric: document.querySelector("#habitDoneMetric"),
  habitEmpty: document.querySelector("#habitEmpty"),
  habitArchiveCount: document.querySelector("#habitArchiveCount"),
  habitArchiveList: document.querySelector("#habitArchiveList"),
  habitArchivePanel: document.querySelector("#habitArchivePanel"),
  habitForm: document.querySelector("#habitForm"),
  habitFormHeading: document.querySelector("#habitFormHeading"),
  habitFormPanel: document.querySelector("#habitFormPanel"),
  habitGoal: document.querySelector("#habitGoal"),
  habitCustomRepeatInterval: document.querySelector("#habitCustomRepeatInterval"),
  habitCustomRepeatMonthDay: document.querySelector("#habitCustomRepeatMonthDay"),
  habitCustomRepeatPanel: document.querySelector("#habitCustomRepeatPanel"),
  habitCustomRepeatSummary: document.querySelector("#habitCustomRepeatSummary"),
  habitId: document.querySelector("#habitId"),
  habitList: document.querySelector("#habitList"),
  historicalTaskCount: document.querySelector("#historicalTaskCount"),
  historicalTaskList: document.querySelector("#historicalTaskList"),
  historicalTaskPanel: document.querySelector("#historicalTaskPanel"),
  habitNumericFields: document.querySelector("#habitNumericFields"),
  habitRepeat: document.querySelector("#habitRepeat"),
  habitTemplate: document.querySelector("#habitTemplate"),
  habitTitle: document.querySelector("#habitTitle"),
  habitType: document.querySelector("#habitType"),
  habitUnit: document.querySelector("#habitUnit"),
  heatmapGrid: document.querySelector("#heatmapGrid"),
  importButton: document.querySelector("#importButton"),
  importFile: document.querySelector("#importFile"),
  journalCount: document.querySelector("#journalCount"),
  journalCalendarGrid: document.querySelector("#journalCalendarGrid"),
  journalCalendarTitle: document.querySelector("#journalCalendarTitle"),
  journalDate: document.querySelector("#journalDate"),
  journalHistoryCount: document.querySelector("#journalHistoryCount"),
  journalHistoryList: document.querySelector("#journalHistoryList"),
  journalNextMonth: document.querySelector("#journalNextMonth"),
  journalPrevMonth: document.querySelector("#journalPrevMonth"),
  journalPrompt: document.querySelector("#journalPrompt"),
  journalSearch: document.querySelector("#journalSearch"),
  journalSearchFrom: document.querySelector("#journalSearchFrom"),
  journalSearchResults: document.querySelector("#journalSearchResults"),
  journalSearchTo: document.querySelector("#journalSearchTo"),
  journalStatus: document.querySelector("#journalStatus"),
  journalText: document.querySelector("#journalText"),
  journalFormatButtons: [...document.querySelectorAll("[data-journal-format]")],
  journalWeekdays: document.querySelector("#journalWeekdays"),
  mcpJournalRead: document.querySelector("#mcpJournalRead"),
  mcpJournalWrite: document.querySelector("#mcpJournalWrite"),
  monthGrid: document.querySelector("#monthGrid"),
  monthLabel: document.querySelector("#monthLabel"),
  monthWeekdays: document.querySelector("#monthWeekdays"),
  navMore: document.querySelector(".nav-more"),
  navMoreSummary: document.querySelector(".nav-more-summary"),
  navTabs: document.querySelectorAll(".nav-tab[data-view]"),
  nextDay: document.querySelector("#nextDay"),
  nextMonth: document.querySelector("#nextMonth"),
  notificationSetting: document.querySelector("#notificationSetting"),
  notifyButton: document.querySelector("#notifyButton"),
  openGoalForm: document.querySelector("#openGoalForm"),
  openHabitForm: document.querySelector("#openHabitForm"),
  openBackupFolderButton: document.querySelector("#openBackupFolderButton"),
  openTaskForm: document.querySelector("#openTaskForm"),
  overdueCounter: document.querySelector("#overdueCounter"),
  overdueAcknowledgeAll: document.querySelector("#overdueAcknowledgeAll"),
  overdueList: document.querySelector("#overdueList"),
  overduePanel: document.querySelector("#overduePanel"),
  overdueToggle: document.querySelector("#overdueToggle"),
  overviewHeading: document.querySelector("#overviewHeading"),
  pageTitle: document.querySelector("#pageTitle"),
  prevDay: document.querySelector("#prevDay"),
  prevMonth: document.querySelector("#prevMonth"),
  customRepeatInterval: document.querySelector("#customRepeatInterval"),
  customRepeatMonthDay: document.querySelector("#customRepeatMonthDay"),
  customRepeatPanel: document.querySelector("#customRepeatPanel"),
  customRepeatSummary: document.querySelector("#customRepeatSummary"),
  quickTaskForm: document.querySelector("#quickTaskForm"),
  quickTaskInput: document.querySelector("#quickTaskInput"),
  quickInputHints: document.querySelector("#quickInputHints"),
  quickTaskPreview: document.querySelector("#quickTaskPreview"),
  remoteSyncAnonKey: document.querySelector("#remoteSyncAnonKey"),
  remoteAuthSignOutButton: document.querySelector("#remoteAuthSignOutButton"),
  remoteAuthStatus: document.querySelector("#remoteAuthStatus"),
  remoteSyncCheckButton: document.querySelector("#remoteSyncCheckButton"),
  remoteAccountDeleteButton: document.querySelector("#remoteAccountDeleteButton"),
  remoteSyncEnabled: document.querySelector("#remoteSyncEnabled"),
  remoteSyncHistory: document.querySelector("#remoteSyncHistory"),
  mcpActivityList: document.querySelector("#mcpActivityList"),
  remoteSyncPullButton: document.querySelector("#remoteSyncPullButton"),
  remoteSyncPushButton: document.querySelector("#remoteSyncPushButton"),
  remoteSnapshotRestoreButton: document.querySelector("#remoteSnapshotRestoreButton"),
  remoteSnapshotSelect: document.querySelector("#remoteSnapshotSelect"),
  remoteSnapshotPreview: document.querySelector("#remoteSnapshotPreview"),
  remoteSnapshotsLoadButton: document.querySelector("#remoteSnapshotsLoadButton"),
  remoteSnapshotsStatus: document.querySelector("#remoteSnapshotsStatus"),
  syncDiagnostics: document.querySelector("#syncDiagnostics"),
  syncTechnicalSettings: document.querySelector("#syncTechnicalSettings"),
  remoteSyncStatus: document.querySelector("#remoteSyncStatus"),
  remoteSyncUrl: document.querySelector("#remoteSyncUrl"),
  resetHabitForm: document.querySelector("#resetHabitForm"),
  resetGoalForm: document.querySelector("#resetGoalForm"),
  resetTaskForm: document.querySelector("#resetTaskForm"),
  restoreBackupButton: document.querySelector("#restoreBackupButton"),
  saveStatus: document.querySelector("#saveStatus"),
  settingsExportButton: document.querySelector("#settingsExportButton"),
  settingsExportSettingsButton: document.querySelector("#settingsExportSettingsButton"),
  settingsBackupStatus: document.querySelector("#settingsBackupStatus"),
  settingsImportFile: document.querySelector("#settingsImportFile"),
  settingsImportDataButton: document.querySelector("#settingsImportDataButton"),
  settingsImportSettingsButton: document.querySelector("#settingsImportSettingsButton"),
  settingsNotifyButton: document.querySelector("#settingsNotifyButton"),
  settingsOpenBackupFolderButton: document.querySelector("#settingsOpenBackupFolderButton"),
  settingsResetButton: document.querySelector("#settingsResetButton"),
  settingsRestoreBackupButton: document.querySelector("#settingsRestoreBackupButton"),
  sideProgressBar: document.querySelector("#sideProgressBar"),
  sideProgressSummary: document.querySelector("#sideProgressSummary"),
  sideProgressValue: document.querySelector("#sideProgressValue"),
  taskCategoryId: document.querySelector("#taskCategoryId"),
  taskCategoryFilter: document.querySelector("#taskCategoryFilter"),
  taskCounter: document.querySelector("#taskCounter"),
  taskDate: document.querySelector("#taskDate"),
  taskEmpty: document.querySelector("#taskEmpty"),
  taskForm: document.querySelector("#taskForm"),
  taskFormHeading: document.querySelector("#taskFormHeading"),
  taskFormPanel: document.querySelector("#taskFormPanel"),
  taskId: document.querySelector("#taskId"),
  taskBlockTimeFields: document.querySelector("#taskBlockTimeFields"),
  taskList: document.querySelector("#taskList"),
  taskPriority: document.querySelector("#taskPriority"),
  taskProgress: document.querySelector("#taskProgress"),
  taskProgressRing: document.querySelector("#taskProgressRing"),
  taskScheduleBlock: document.querySelector("#taskScheduleBlock"),
  taskScheduleDeadline: document.querySelector("#taskScheduleDeadline"),
  taskScheduleNone: document.querySelector("#taskScheduleNone"),
  taskReminder: document.querySelector("#taskReminder"),
  taskReminderField: document.querySelector("#taskReminderField"),
  taskRepeat: document.querySelector("#taskRepeat"),
  taskRepeatUntil: document.querySelector("#taskRepeatUntil"),
  taskRepeatUntilField: document.querySelector("#taskRepeatUntilField"),
  taskRepeatEditHint: document.querySelector("#taskRepeatEditHint"),
  taskRepeatEditScope: document.querySelector("#taskRepeatEditScope"),
  taskSearch: document.querySelector("#taskSearch"),
  taskStartTime: document.querySelector("#taskStartTime"),
  taskTemplate: document.querySelector("#taskTemplate"),
  taskTime: document.querySelector("#taskTime"),
  taskDeadlineTimeField: document.querySelector("#taskDeadlineTimeField"),
  taskEndTime: document.querySelector("#taskEndTime"),
  taskTitle: document.querySelector("#taskTitle"),
  themePreference: document.querySelector("#themePreference"),
  timeFormat: document.querySelector("#timeFormat"),
  timeZoneSetting: document.querySelector("#timeZoneSetting"),
  timelineEmpty: document.querySelector("#timelineEmpty"),
  timelineGrid: document.querySelector("#timelineGrid"),
  timelineSummary: document.querySelector("#timelineSummary"),
  timelineUnscheduledCount: document.querySelector("#timelineUnscheduledCount"),
  timelineScaleButtons: [...document.querySelectorAll("[data-timeline-scale]")],
  timelineUnscheduledList: document.querySelector("#timelineUnscheduledList"),
  todayButton: document.querySelector("#todayButton"),
  todayDoneMetric: document.querySelector("#todayDoneMetric"),
  todayLabel: document.querySelector("#todayLabel"),
  todayOpenMetric: document.querySelector("#todayOpenMetric"),
  toast: document.querySelector("#appToast"),
  updateBanner: document.querySelector("#updateBanner"),
  applyUpdateButton: document.querySelector("#applyUpdateButton"),
  views: {
    archive: document.querySelector("#archiveView"),
    board: document.querySelector("#boardView"),
    goals: document.querySelector("#goalsView"),
    habits: document.querySelector("#habitsView"),
    journal: document.querySelector("#journalView"),
    nutrition: document.querySelector("#nutritionView"),
    overview: document.querySelector("#overviewView"),
    settings: document.querySelector("#settingsView"),
    tasks: document.querySelector("#tasksView"),
    timeline: document.querySelector("#timelineView"),
  },
  weekBoardGrid: document.querySelector("#weekBoardGrid"),
  weekBoardLabel: document.querySelector("#weekBoardLabel"),
  weeklyHabitMetric: document.querySelector("#weeklyHabitMetric"),
  weeklyHabitText: document.querySelector("#weeklyHabitText"),
  weeklyTaskMetric: document.querySelector("#weeklyTaskMetric"),
  weeklyTaskText: document.querySelector("#weeklyTaskText"),
};

[
  "boardAddFrame", "boardAddImage", "boardAddText", "boardBold", "boardBringFront", "boardColorPresets", "boardDuplicate",
  "boardEmpty", "boardFocus", "boardFontSize", "boardGroup", "boardImageInput", "boardLock", "boardMarquee",
  "boardModePan", "boardModeSelect", "boardRedo", "boardSelectionToolbar", "boardSendBack", "boardStatus",
  "boardTextColor", "boardTextControls", "boardUndo", "boardViewport", "boardWorld", "boardZoomIn", "boardZoomLabel", "boardZoomOut",
  "nutritionAddMeal", "nutritionCaloriesMetric", "nutritionCarbsMetric", "nutritionCurrentWeek",
  "nutritionEmpty", "nutritionEmptyAction", "nutritionFatMetric", "nutritionFoodCalories", "nutritionFoodCarbs",
  "nutritionFoodCount", "nutritionFoodFat", "nutritionFoodForm", "nutritionFoodId",
  "nutritionFoodList", "nutritionFoodName", "nutritionFoodProtein", "nutritionFoodUnit",
  "nutritionMealCalories", "nutritionMealCancel", "nutritionMealCarbs", "nutritionMealClose",
  "nutritionMealDate", "nutritionMealDialog", "nutritionMealFat", "nutritionMealForm",
  "nutritionMealHeading", "nutritionMealId", "nutritionMealIngredients", "nutritionMealNotes",
  "nutritionMealProtein", "nutritionMealServings", "nutritionMealTime", "nutritionMealTitle",
  "nutritionMealType", "nutritionNextWeek", "nutritionPaused", "nutritionPrevWeek",
  "nutritionProteinMetric", "nutritionShoppingCount", "nutritionShoppingList",
  "nutritionTargetCalories", "nutritionTargetCarbs", "nutritionTargetFat", "nutritionTargetProtein",
  "nutritionTargetsForm", "nutritionView", "nutritionWeekBoard", "nutritionWeekLabel",
  "googleCalendarConnect", "googleCalendarDirection", "googleCalendarDisconnect", "googleCalendarStatus", "googleCalendarSync",
].forEach((id) => {
  els[id] = document.querySelector(`#${id}`);
});

let pendingUpdateRegistration = null;
const pwaController = window.RhythmPwaController.createPwaController({
  onUpdateAvailable: (registration) => {
    pendingUpdateRegistration = registration;
    if (els.updateBanner) els.updateBanner.hidden = false;
  },
});
els.applyUpdateButton?.addEventListener("click", () => {
  if (!pwaController.activateUpdate(pendingUpdateRegistration)) return;
  els.applyUpdateButton.disabled = true;
  els.applyUpdateButton.textContent = "Обновляем...";
});

const toastController = window.RhythmToast.createToastController({
  element: els.toast,
  restoreUndoSnapshot,
});
const saveStatusView = window.RhythmSaveStatus.createSaveStatus({
  element: els.saveStatus,
  formatTime,
  toTimeValue,
});

const confirmDialog = window.RhythmConfirmDialog.createConfirmDialog({ els });
window.RhythmFormDialog.createFormDialogManager({
  backdrop: els.formBackdrop,
  panels: [els.taskFormPanel, els.habitFormPanel, els.goalFormPanel],
});
const remoteSync = window.RhythmRemoteSync.createRemoteSync();
const remoteAuth = window.RhythmRemoteAuth.createRemoteAuth({
  getConfig: () => ({ anonKey: remoteSyncAnonKey, supabaseUrl: remoteSyncUrl }),
  onSessionChange: (session) => {
    if (session || window.RhythmAuthGate.isAutomationLocation()) return;
    queueMicrotask(() => window.RhythmAuthGate.redirectAfterSignOut());
  },
});
const googleCalendarApi = window.RhythmGoogleCalendarApi.createGoogleCalendarApi({
  getAccessToken: async () => (await remoteAuth.ensureFreshSession().catch(() => null))?.access_token || "",
});
const googleCalendarController = window.RhythmGoogleCalendarController.createGoogleCalendarController({
  api: googleCalendarApi,
  confirmAction,
  createId,
  deleteTask: (taskId) => taskState.deleteTask(taskId),
  els,
  formatDate: formatBackupDate,
  getAccessToken: () => remoteAuth.getSession()?.access_token || "",
  getState: () => state,
  getTimeZone: () => state.profile?.timeZone || "Europe/Moscow",
  render,
  saveState,
  showToast,
});
const syncHistory = window.RhythmSyncHistory.createSyncHistory();
let syncDiagnosticsController = null;
const taskScheduleController = window.RhythmTaskSchedule.createTaskSchedule({
  cleanTimeValue,
  els,
  minutesToTime,
  timeToMinutes,
});
const getTaskScheduleMode = taskScheduleController.getMode;
const setTaskScheduleMode = taskScheduleController.setMode;
const syncTaskScheduleMode = taskScheduleController.syncMode;
const syncTaskTimePresets = taskScheduleController.syncPresets;
const taskFormHome = {
  next: els.taskFormPanel?.nextSibling || null,
  parent: els.taskFormPanel?.parentNode || null,
};

const priorityLabels = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const repeatLabels = window.RhythmRecurrence.repeatLabels;
const calendarDragController = window.RhythmCalendarDragController.createCalendarDragController({
  addDays,
  getActiveDate: () => activeDate,
  moveTaskToDate,
  normalizeDateKey,
  openDateTasks,
});

const tasksView = window.RhythmTasksView.createTasksView({
  els,
  priorityLabels,
  addDays,
  acknowledgeOverdueTask,
  acknowledgeAllOverdueTasks,
  clearTaskDragState,
  createUndoSnapshot,
  confirmAction,
  deleteTask,
  deleteMovedReplacement,
  escapeHtml,
  excludeTaskDate,
  excludedTasksForDate,
  fillTaskForm,
  formatLongDate,
  formatTime,
  formatTaskRepeat,
  getActiveDate: () => activeDate,
  getCategory,
  getOrderedTasksForDate,
  getState: () => state,
  getTaskCategoryFilter: () => taskCategoryFilter,
  getTaskFilter: () => taskFilter,
  getTaskSearchQuery: () => taskSearchQuery,
  isTaskDone,
  isTaskExcluded,
  matchesCategoryFilter,
  openDate: async (dateKey) => {
    if (!(await confirmDiscardOpenForms())) return;
    activeDate = dateKey;
    saveUiState();
    resetTaskForm({ open: false });
    resetHabitForm({ open: false });
    render();
    scrollWorkspaceTop();
  },
  overdueTaskEntries,
  getOverdueHidden: () => overdueHidden,
  setOverdueHidden: (value) => {
    overdueHidden = value === true;
    saveUiState();
  },
  postponeTask,
  render: renderTaskSurfaces,
  reorderTask,
  restoreTaskDate,
  restoreOverdueTask,
  stopTaskSeries,
  saveState,
  setDraggedTask: (taskId, dateKey) => {
    calendarDragController.setDraggedTask(taskId, dateKey);
  },
  showToast,
  taskDetails,
  taskMatchesSearch,
  taskMetaItems,
  taskOccursOn,
  toDateKey,
});

const habitsView = window.RhythmHabitsView.createHabitsView({
  applyHabitAvailabilityChange: window.RhythmHabitConfigHistory.applyHabitAvailabilityChange,
  els,
  confirmAction,
  createUndoSnapshot,
  deleteHabit,
  escapeHtml,
  fillHabitForm,
  formatHabitRepeat,
  getActiveDate: () => activeDate,
  getState: () => state,
  isTaskDone,
  habitStreak,
  habitConfigOnDate,
  habitTitleOnDate: window.RhythmHabitTitleHistory.habitTitleOnDate,
  habitsForDate,
  render: renderHabitSurfaces,
  renderDailyPulse,
  renderOverviewIfActive: () => {
    if (activeView === "overview") renderOverview();
  },
  reorderHabit,
  saveState,
  showToast,
});

const goalCheckpointEditor = window.RhythmGoalCheckpointEditor.createGoalCheckpointEditor({
  createId,
  els,
});

const goalsView = window.RhythmGoalsView.createGoalsView({
  confirmDiscardOpenForms,
  checkpointEditor: goalCheckpointEditor,
  els,
  cleanText,
  confirmAction,
  createId,
  createUndoSnapshot,
  deleteGoal,
  getActiveDate: () => activeDate,
  getState: () => state,
  markFormPristine,
  normalizeDateKey,
  render: renderGoalSurfaces,
  saveState,
  showToast,
  toDateKey,
  upsertGoal: (goal) => {
    delete state.tombstones?.goals?.[goal.id];
    const existing = state.goals.find((item) => item.id === goal.id);
    if (existing) {
      Object.assign(existing, goal);
    } else {
      state.goals.push(goal);
    }
  },
});

const calendarView = window.RhythmCalendarView.createCalendarView({
  els,
  attachTaskChipDrag,
  attachTaskDropZone,
  escapeHtml,
  formatLongDate,
  formatMonthLabel,
  formatShortDate,
  formatWeekday,
  getActiveDate: () => activeDate,
  getCategory,
  getMonthCalendarDates,
  getOrderedTasksForDate,
  getWeekDates,
  habitsForDate,
  heatAlpha,
  isTaskDone,
  openDateTasks,
  parseDate,
  priorityLabels,
  statsForDate,
  toDateKey,
});

const timelineController = window.RhythmTimelineController.createTimelineController({
  cleanTimeValue,
  confirmAction,
  createId,
  createUndoSnapshot,
  deleteTask,
  deleteMovedReplacement,
  excludeTaskDate,
  els,
  findTask: (id) => state.tasks.find((task) => task.id === id),
  formatTaskWindow,
  formatLongDate,
  formatTime,
  getActiveDate: () => activeDate,
  getOrderedTasksForDate,
  getState: () => state,
  isTaskDone,
  isTimeBlock,
  isValidTimeBlock,
  messages: {
    active: "Задача снова активна",
    blockUpdated: "Блок обновлен",
    copySuffix: "копия",
    deleted: "Задача удалена",
    done: "Задача выполнена",
    duplicated: "Задача продублирована",
    movedTo: "Перенесено на",
    timeUpdated: "Время задачи обновлено",
  },
  minutesToTime,
  openFloatingTaskForm,
  render: renderTaskSurfaces,
  resetTaskForm,
  saveState,
  setTaskScheduleMode,
  showToast,
  stopTaskSeries,
  syncTaskScheduleMode,
  syncTaskTimePresets,
  taskSortTime,
  timeToMinutes,
});

const timelineView = window.RhythmTimelineView.createTimelineView({
  els,
  clearTaskTime: timelineController.clearTaskTime,
  createTaskAtTime: timelineController.createTaskAtTime,
  deleteTask: timelineController.deleteTask,
  duplicateTask: timelineController.duplicateTask,
  fillTaskForm,
  formatTime,
  getActiveDate: () => activeDate,
  getCategory,
  getOrderedTasksForDate,
  isTaskDone,
  moveTaskTime: timelineController.moveTaskTime,
  priorityLabels,
  resizeTaskBlockTime: timelineController.resizeTaskBlockTime,
  setTaskTime: timelineController.setTaskTime,
  shiftTaskTime: timelineController.shiftTaskTime,
  toggleTaskDone: timelineController.toggleTaskDone,
  toDateKey,
});

const archiveView = window.RhythmArchiveView.createArchiveView({
  addDays,
  initialPeriod: archivePeriod,
  els,
  archiveEntries,
  archiveEntryMatchesSearch,
  confirmAction,
  createUndoSnapshot,
  deleteTask,
  escapeHtml,
  formatLongDate,
  getArchiveCategoryFilter: () => archiveCategoryFilter,
  getArchiveSearchQuery: () => archiveSearchQuery,
  getCategory,
  matchesCategoryFilter,
  onPeriodChange: (value) => {
    archivePeriod = value;
    saveUiState();
  },
  postponeTask,
  priorityLabels,
  render: renderTaskSurfaces,
  saveState,
  showToast,
  toDateKey,
});

const journalView = window.RhythmJournalView.createJournalView({
  buildMonth: window.RhythmJournalModel.buildJournalMonth,
  confirmRestore: () => confirmAction({
    title: "Восстановить эту версию?",
    message: "Текущий текст останется в истории, поэтому его можно будет вернуть.",
    confirmLabel: "Восстановить",
  }),
  els,
  formatDateTime: (timestamp) => new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp)),
  formatLongDate,
  formatTime: (timestamp) => new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp)),
  getActiveDate: () => activeDate,
  getEntry: (dateKey) => window.RhythmJournalModel.journalEntryForDate(state.journalEntries, dateKey),
  getEntries: () => state.journalEntries,
  getFirstDayOfWeek: () => firstDayOfWeek,
  maxLength: window.RhythmJournalModel.MAX_JOURNAL_LENGTH,
  restoreRevision: (dateKey, savedAt) => {
    const result = window.RhythmJournalModel.restoreJournalRevision(
      state.journalEntries,
      dateKey,
      savedAt,
      { createId },
    );
    if (!result.changed) return result;
    state.journalEntries = result.entries;
    saveState();
    return result;
  },
  searchEntries: window.RhythmJournalModel.searchJournalEntries,
  saveEntry: (dateKey, text) => {
    const result = window.RhythmJournalModel.upsertJournalEntry(
      state.journalEntries,
      { date: dateKey, text },
      { createId },
    );
    if (!result.changed) return result;
    state.journalEntries = result.entries;
    if (result.entry) delete state.tombstones?.journalEntries?.[result.entry.id];
    saveState();
    return result;
  },
  setActiveDate: (dateKey) => {
    activeDate = dateKey;
    els.activeDate.value = activeDate;
    saveUiState();
    resetTaskForm({ open: false });
    resetHabitForm({ open: false });
    render();
  },
  showToast,
});

const boardAssets = window.RhythmBoardAssets.createBoardAssetStore({
  getRemoteConfig: async () => {
    const session = await remoteAuth.ensureFreshSession().catch(() => remoteAuth.getSession());
    return {
      accessToken: session?.access_token || "",
      anonKey: remoteSyncAnonKey,
      enabled: remoteSyncEnabled === "on",
      supabaseUrl: remoteSyncUrl,
      userId: session?.user?.id || "",
    };
  },
});
const boardView = window.RhythmBoardView.createBoardView({
  assets: boardAssets,
  commitItems: (items, options = {}) => {
    const normalized = window.RhythmBoardModel.normalizeItems(items, { createId });
    state.boardItems = normalized;
    state.tombstones.boardItems ||= {};
    (options.deletedIds || []).forEach((id) => {
      state.tombstones.boardItems[id] = new Date().toISOString();
    });
    normalized.forEach((item) => {
      delete state.tombstones.boardItems[item.id];
    });
    saveState();
  },
  createId,
  els,
  getItems: () => state.boardItems,
  model: window.RhythmBoardModel,
  showToast,
});

const globalSearch = window.RhythmGlobalSearch.createGlobalSearch({
  els,
  formatDate: formatLongDate,
  getState: () => state,
  openResult: async (result) => {
    if (!(await confirmDiscardOpenForms())) return;
    resetTaskForm({ open: false });
    resetHabitForm({ open: false });
    resetGoalForm({ open: false });
    if (result.view === "tasks") clearTaskFilters();
    if (result.view === "archive") {
      archiveCategoryFilter = "all";
      archiveSearchQuery = result.title;
      els.archiveSearch.value = archiveSearchQuery;
      archiveView.setPeriod("all");
    }
    if (result.date) {
      activeDate = result.date;
      els.activeDate.value = activeDate;
    }
    activeView = result.view;
    saveUiState();
    syncNavigationRoute();
    render();
    scrollWorkspaceTop();
    if (result.type === "task") {
      requestAnimationFrame(() => {
        const row = [...els.taskList.children].find((item) => item.dataset.taskId === result.id);
        if (!row) return;
        row.scrollIntoView({ block: "center" });
        row.querySelector(".check-button")?.focus({ preventScroll: true });
      });
    }
  },
  search: window.RhythmGlobalSearch.searchWorkspace,
});

const nutritionController = window.RhythmNutritionController.createNutritionController({
  confirmAction,
  createId,
  createUndoSnapshot,
  getState: () => state,
  model: window.RhythmNutritionModel,
  now: () => new Date().toISOString(),
  render,
  saveState,
  showToast,
});

const nutritionView = window.RhythmNutritionView.createNutritionView({
  ...nutritionController,
  createId,
  els,
  formatDate: (dateKey) => new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T00:00:00.000Z`)),
  formatDay: (dateKey) => new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T00:00:00.000Z`)),
  formatWeekday: (dateKey) => new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T00:00:00.000Z`)),
  getActiveDate: () => activeDate,
  getFirstDayOfWeek: () => firstDayOfWeek,
  getState: () => state,
  model: window.RhythmNutritionModel,
  setActiveDate: (dateKey) => {
    activeDate = dateKey;
    els.activeDate.value = activeDate;
    saveUiState();
    render();
  },
  showToast,
  today: () => toDateKey(new Date()),
});

const taskFormController = window.RhythmTaskForm.createTaskForm({
  els,
  getDefaultCategoryId: () => state.categories.some((category) => category.id === taskCategoryFilter)
    ? taskCategoryFilter : "",
  afterSave: (task) => {
    if (activeView === "tasks" && (
      (taskFilter === "done" && !isTaskDone(task, activeDate)) ||
      (taskFilter === "open" && isTaskDone(task, activeDate)) || !matchesCategoryFilter(task, taskCategoryFilter) ||
      !taskMatchesSearch(task, taskSearchQuery, activeDate)
    )) {
      clearTaskFilters();
      saveUiState();
      renderTasks();
    }
    if (activeView === "timeline") {
      els.taskFormPanel.classList.add("is-collapsed");
      closeFloatingTaskForm();
    }
  },
  cleanText,
  cleanTimeValue,
  createId,
  createUndoSnapshot,
  findTask: (id) => state.tasks.find((task) => task.id === id),
  getActiveDate: () => activeDate,
  getCustomRepeatFromForm,
  getTaskScheduleMode,
  isTimeBlock,
  isValidTimeBlock,
  markFormPristine,
  normalizeDateKey,
  render,
  saveState,
  setActiveDate: (dateKey) => {
    activeDate = dateKey;
  },
  setCustomRepeatForm,
  setTaskScheduleMode,
  showToast,
  syncCustomRepeatPanel,
  syncTaskScheduleMode,
  syncTaskTimePresets,
  updateRecurringTask: (task, editedTask, dateKey, scope) => window.RhythmTaskMoves.updateRecurringTaskDetails({
    state,
    task,
    editedTask,
    dateKey,
    scope,
    helpers: { createId },
  }),
  upsertTask: (task) => {
    delete state.tombstones?.tasks?.[task.id];
    const existing = state.tasks.find((item) => item.id === task.id);
    if (existing) {
      Object.assign(existing, task);
    } else {
      state.tasks.push(task);
    }
  },
});

const habitFormController = window.RhythmHabitForm.createHabitForm({
  applyHabitConfigChange: window.RhythmHabitConfigHistory.applyHabitConfigChange,
  applyHabitTitleChange: window.RhythmHabitTitleHistory.applyHabitTitleChange,
  els,
  cleanText,
  createId,
  createUndoSnapshot,
  findHabit: (id) => state.habits.find((habit) => habit.id === id),
  getActiveDate: () => activeDate,
  getHabitCustomRepeatFromForm,
  habitConfigOnDate,
  habitTitleOnDate: window.RhythmHabitTitleHistory.habitTitleOnDate,
  markFormPristine,
  normalizeHabitRepeat,
  normalizeCustomRepeat: window.RhythmRecurrence.normalizeCustomRepeat,
  render,
  saveState,
  setHabitCustomRepeatForm,
  showToast,
  syncHabitCustomRepeatPanel,
  syncHabitTypeFields,
  upsertHabit: (habit) => {
    delete state.tombstones?.habits?.[habit.id];
    const existing = state.habits.find((item) => item.id === habit.id);
    if (existing) {
      Object.assign(existing, habit);
    } else {
      state.habits.push(habit);
    }
  },
});

const categoriesController = window.RhythmCategories.createCategories({
  els,
  cleanText,
  confirmAction,
  createId,
  createUndoSnapshot,
  escapeHtml,
  getArchiveCategoryFilter: () => archiveCategoryFilter,
  getState: () => state,
  getTaskCategoryFilter: () => taskCategoryFilter,
  render,
  saveState,
  saveUiState,
  setArchiveCategoryFilter: (value) => {
    archiveCategoryFilter = value;
  },
  setTaskCategoryFilter: (value) => {
    taskCategoryFilter = value;
  },
  showToast,
});

const importExportController = window.RhythmImportExport.createImportExport({
  els,
  confirmAction,
  createUndoSnapshot,
  getState: () => state,
  normalizeState,
  render,
  replaceState,
  saveState,
  schemaVersion: SCHEMA_VERSION,
  showToast,
  storage,
  toDateKey,
});

const settingsTransfer = window.RhythmSettingsTransfer.createSettingsTransfer({
  applyImportedSettings,
  confirmAction,
  document,
  els,
  getSettings: getUiSettings,
  render,
  resetPreferences: resetInterfacePreferences,
  saveUiState,
  schemaVersion: SCHEMA_VERSION,
  showToast,
  toDateKey,
});

const settingsController = window.RhythmSettingsController.createSettingsController({
  els,
  exportData,
  exportSettings: settingsTransfer.exportSettings,
  getSettings: () => ({ ...getUiSettings(), journalAccess: state.profile.journalAccess, timeZone: state.profile.timeZone }),
  importSettings: settingsTransfer.importSettings,
  openBackupFolder,
  checkRemoteConnection,
  pullRemoteState,
  pushRemoteState,
  renderBackupStatus: renderSettingsBackupStatus,
  renderRemoteSyncStatus,
  requestNotifications,
  resetInterfaceSettings: settingsTransfer.resetInterfaceSettings,
  restoreBackup,
  updateSetting,
  updateJournalPermission,
  updateTimeZone,
});

const remoteSyncWorkflow = window.RhythmRemoteSyncController.createRemoteSyncWorkflow({
  confirmAction,
  createImportSafetyBackup,
  createUndoSnapshot,
  describeError: describeRemoteSyncError,
  els,
  formatDate: formatBackupDate,
  getLocalUpdatedAt: () => localStateUpdatedAt,
  getRemoteUiSettings,
  getSettings: () => ({
    accessToken: remoteAuth.getSession()?.access_token || "",
    anonKey: remoteSyncAnonKey,
    enabled: remoteSyncEnabled === "on",
    supabaseUrl: remoteSyncUrl,
    userId: remoteAuth.getSession()?.user?.id || "",
  }),
  getState: () => state,
  getSyncMeta: () => ({
    lastPulledAt: remoteSyncLastPulledAt,
    lastPushedAt: remoteSyncLastPushedAt,
    pending: remoteSyncPending,
  }),
  isRemoteVersionNewer: settingsState.isRemoteVersionNewer,
  latestIsoDate,
  mergeStates: window.RhythmStateMerge.mergeStates,
  remoteSync,
  recordSyncEvent: (type, detail) => {
    syncHistory.record(type, detail);
    syncHistory.render(els.remoteSyncHistory, formatBackupDate);
  },
  render,
  renderSaveStatus,
  replaceState,
  saveState,
  saveUiState,
  schemaVersion: SCHEMA_VERSION,
  setSyncMeta: ({ lastPulledAt, lastPushedAt, pending }) => {
    if (lastPulledAt) remoteSyncLastPulledAt = lastPulledAt;
    if (lastPushedAt) remoteSyncLastPushedAt = lastPushedAt;
    if (typeof pending === "boolean") remoteSyncPending = pending;
  },
  showToast,
  statusElement: els.remoteSyncStatus,
  syncControls: () => settingsController.syncControls(),
});

const remoteAuthController = window.RhythmRemoteAuthController.createRemoteAuthController({
  auth: remoteAuth,
  els,
  renderSyncStatus: () => remoteSyncWorkflow.renderStatus(),
  showToast,
  syncCloudControls: () => queueMicrotask(() => remoteDataController.syncControls()),
  syncLatest: async (options) => {
    const result = await remoteSyncWorkflow.syncLatest(options);
    await remoteSyncWorkflow.resumePending();
    return result;
  },
});
const remoteDataController = window.RhythmRemoteDataController.createRemoteDataController({
  afterAccountDeleted: async () => {
    remoteSyncEnabled = "off";
    remoteSyncPending = false;
    await remoteAuth.signOut();
    saveUiState();
    settingsController.syncControls();
    remoteAuthController.render();
    renderRemoteSyncStatus();
  },
  afterSnapshotRestored: (result) => {
    const restoredAt = result?.saved?.row?.updated_at || result?.saved?.clientUpdatedAt || new Date().toISOString();
    remoteSyncLastPulledAt = restoredAt;
    remoteSyncLastPushedAt = restoredAt;
    remoteSyncPending = false;
    saveUiState();
    renderRemoteSyncStatus();
  },
  confirmAction,
  createImportSafetyBackup,
  createUndoSnapshot,
  els,
  formatDate: formatBackupDate,
  getConfig: () => remoteSync.normalizeConfig({
    accessToken: remoteAuth.getSession()?.access_token || "",
    anonKey: remoteSyncAnonKey,
    enabled: true,
    supabaseUrl: remoteSyncUrl,
    userId: remoteAuth.getSession()?.user?.id || "",
  }),
  getState: () => state,
  getUserEmail: () => remoteAuth.getSession()?.user?.email || "",
  isReady: () => Boolean(remoteAuth.getSession()?.access_token && remoteSyncUrl && remoteSyncAnonKey),
  remoteSync,
  render,
  replaceState,
  saveState,
  showToast,
});
syncDiagnosticsController = window.RhythmSyncDiagnostics.createSyncDiagnostics({
  container: els.syncDiagnostics,
  describeError: describeRemoteSyncError,
  formatDate: formatBackupDate,
  getSnapshot: () => {
    const workflowStatus = remoteSyncWorkflow.getStatus();
    return {
      accountLabel: remoteAuth.getSession()?.user?.email || "",
      authenticated: Boolean(remoteAuth.getSession()?.access_token),
      enabled: remoteSyncEnabled === "on",
      inFlight: workflowStatus.inFlight,
      lastError: workflowStatus.lastError,
      lastPulledAt: remoteSyncLastPulledAt,
      lastPushedAt: remoteSyncLastPushedAt,
      online: navigator.onLine !== false,
      pending: workflowStatus.pending,
      projectConfigured: Boolean(remoteSyncUrl && remoteSyncAnonKey),
    };
  },
});
const deviceSyncController = window.RhythmDeviceSyncController.createDeviceSyncController({
  ensureFreshSession: () => remoteAuth.ensureFreshSession().catch(() => null),
  onOnline: () => {
    renderSaveStatus();
    scheduleRemotePush();
  },
  syncLatest: (options) => remoteSyncWorkflow.syncLatest(options),
});
syncHistory.render(els.remoteSyncHistory, formatBackupDate);
const mcpActivityController = window.RhythmMcpActivityController.createMcpActivityController({
  activityApi: window.RhythmMcpActivity,
  confirmAction,
  container: els.mcpActivityList,
  formatDate: formatBackupDate,
  getState: () => state,
  render,
  replaceState,
  saveState,
  showToast,
});

const notificationsController = window.RhythmNotifications.createNotifications({
  els,
  cleanTimeValue,
  getCategory,
  getNotificationsEnabled: () => notificationSetting === "on",
  getState: () => state,
  isTaskDone,
  parseDate,
  saveState,
  showToast,
  taskOccursOn,
  tasksForDate,
  toDateKey,
});

const dailyPulseController = window.RhythmDailyPulse.createDailyPulse({
  els,
  getHabits: habitsForDate,
  getTasks: getOrderedTasksForDate,
  isHabitComplete,
  isTaskDone,
  taskDetails,
});

const viewRenderer = window.RhythmViewRenderer.createViewRenderer({
  renderArchive,
  renderCategories,
  renderDailyPulse,
  renderGoals,
  renderHabits,
  renderJournal: journalView.render,
  renderNutrition: nutritionView.render,
  renderBoard: boardView.render,
  renderMcpActivity: mcpActivityController.render,
  renderOverview,
  renderRemoteSyncStatus,
  renderSettingsBackupStatus,
  renderTasks,
  renderTimeline,
  renderWeekdayLabels,
});

const appShellController = window.RhythmAppShellController.createAppShellController({
  els,
  formatLongDate,
  getActiveDate: () => activeDate,
  getActiveView: () => activeView,
  getOverviewMode: () => overviewMode,
  navigationState: window.RhythmNavigationState,
  renderSaveStatus,
  restoreTaskFormPanel,
  saveUiState,
  scrollActiveViewStart: (view) => view === "timeline" && timelineView.scrollToRelevantTime(),
  setActiveView: (value) => { activeView = value; },
  setOverviewMode: (value) => { overviewMode = value; },
  syncTaskTimePresets,
  viewRenderer,
});

const appEvents = window.RhythmAppEvents.createAppEvents({
  confirmDiscardOpenForms,
  hasUnsavedForms: () => [
    [els.taskForm, els.taskFormPanel],
    [els.habitForm, els.habitFormPanel],
    [els.goalForm, els.goalFormPanel],
  ].some(([form, panel]) => !panel.classList.contains("is-collapsed") && isFormDirty(form)),
  calendarDragController,
  changeOverviewMode: (mode, activeButton) => {
    overviewMode = ["week", "month", "year"].includes(mode) ? mode : "week";
    els.views.overview.dataset.mode = overviewMode;
    document.querySelectorAll("[data-overview-mode]").forEach((item) => {
      item.classList.toggle("is-active", item === activeButton);
    });
    saveUiState();
    syncNavigationRoute();
    renderOverview();
  },
  changeActiveDate: async (value) => {
    if (!(await confirmDiscardOpenForms())) {
      els.activeDate.value = activeDate;
      return;
    }
    activeDate = value || toDateKey(new Date());
    saveUiState();
    resetTaskForm({ open: false });
    resetHabitForm({ open: false });
    render();
  },
  changeArchiveCategoryFilter: (value) => {
    archiveCategoryFilter = value || "all";
    saveUiState();
    renderArchive();
  },
  changeArchiveSearch: (value) => {
    archiveSearchQuery = cleanSearchQuery(value);
    saveUiState();
    renderArchive();
  },
  changeTaskCategoryFilter: (value) => {
    taskCategoryFilter = value || "all";
    saveUiState();
    renderTasks();
  },
  changeTaskFilter: (value, activeButton) => {
    taskFilter = value;
    document.querySelectorAll("[data-task-filter]").forEach((item) => item.classList.toggle("is-active", item === activeButton));
    saveUiState();
    renderTasks();
  },
  changeTaskSearch: (value) => {
    taskSearchQuery = cleanSearchQuery(value);
    saveUiState();
    renderTasks();
  },
  changeView: (nextView) => {
    if (!nextView || !els.views[nextView]) return;
    activeView = nextView;
    saveUiState();
    syncNavigationRoute();
    els.navMore?.removeAttribute("open");
    render();
    scrollWorkspaceTop();
  },
  clearArchiveFilter: () => {
    archiveSearchQuery = "";
    archiveCategoryFilter = "all";
    els.archiveSearch.value = "";
    els.archiveCategoryFilter.value = "all";
    archiveView.setPeriod("all");
    saveUiState();
    renderArchive();
  },
  clearTaskSearch: () => {
    taskFilter = "all";
    taskCategoryFilter = "all";
    taskSearchQuery = "";
    els.taskSearch.value = "";
    els.taskCategoryFilter.value = "all";
    document.querySelectorAll("[data-task-filter]").forEach((item) => item.classList.toggle("is-active", item.dataset.taskFilter === "all"));
    saveUiState();
    renderTasks();
  },
  closeGoalForm: () => closeFormWithConfirmation(els.goalForm, els.goalFormPanel, els.openGoalForm),
  closeHabitForm: () => closeFormWithConfirmation(els.habitForm, els.habitFormPanel, els.openHabitForm),
  closeTaskForm: () => closeFormWithConfirmation(els.taskForm, els.taskFormPanel, els.openTaskForm, closeFloatingTaskForm),
  els,
  exportData,
  goToday,
  handleSystemThemeChange: () => {
    if (themePreference === "system") applyThemePreference();
  },
  handleNavigationChange,
  importData,
  openBackupFolder,
  openGoalForm: async () => {
    if (!(await confirmDiscardOpenForms())) return;
    resetGoalForm({ open: true });
    els.goalTitle.focus();
  },
  openHabitForm: async () => {
    if (!(await confirmDiscardOpenForms())) return;
    resetHabitForm({ open: true });
    els.habitTitle.focus();
  },
  openTaskForm: async () => {
    if (!(await confirmDiscardOpenForms())) return;
    restoreTaskFormPanel();
    resetTaskForm({ open: true });
    els.taskTitle.focus();
  },
  applyTimePreset: taskScheduleController.applyPreset,
  renderSaveStatus,
  requestNotifications,
  resetGoalForm,
  resetHabitForm,
  resetTaskForm,
  restoreBackup,
  saveCategoryFromForm,
  saveGoalFromForm,
  saveHabitFromForm,
  saveQuickTask,
  saveTaskFromForm,
  setCustomRepeatMode,
  setHabitCustomRepeatMode,
  settingsController,
  shiftDate,
  shiftMonth,
  syncCustomRepeatPanel,
  syncHabitCustomRepeatPanel,
  syncHabitTypeFields,
  syncTaskScheduleMode,
  syncTaskTimePresets,
  updateCustomRepeatSummary,
  updateHabitCustomRepeatSummary,
  updateQuickTaskPreview,
});

seedIfEmpty();
init();

async function init() {
  els.activeDate.value = activeDate;
  els.taskSearch.value = taskSearchQuery;
  els.archiveSearch.value = archiveSearchQuery;
  els.views.overview.dataset.mode = overviewMode;
  document.querySelectorAll("[data-overview-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.overviewMode === overviewMode);
  });
  document.querySelectorAll("[data-task-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.taskFilter === taskFilter);
  });
  applyThemePreference();
  applySettingsPreferences();
  settingsController.syncControls();
  confirmDialog.bindEvents();
  remoteDataController.bindEvents();
  journalView.bindEvents();
  nutritionView.bindEvents();
  boardView.bindEvents();
  googleCalendarController.bindEvents();
  globalSearch.bindEvents();
  appEvents.bind();
  syncNavigationRoute({ replace: true });
  resetTaskForm({ open: false });
  resetHabitForm({ open: false });
  resetGoalForm({ open: false });
  pwaController.register();
  updateNotificationButton();
  updateBackupStatus();
  renderSettingsBackupStatus();
  renderRemoteSyncStatus();
  updateFileBackupStatus();
  render();
  scrollWorkspaceTop();
  if (initialStateLoad.status === "recovered") showToast("Поврежденные локальные данные восстановлены из backup");
  if (initialStateLoad.status === "recovered-memory") showToast("Backup восстановлен только в памяти. Экспортируй данные");
  if (initialStateLoad.status === "corrupt") showToast("Локальные данные повреждены. Загрузи backup или данные из облака");
  await initializeHostedConfig();
  deviceSyncController.start().then(() => remoteSyncWorkflow.resumePending());
  syncDesktopReminders();
  setInterval(checkDueNotifications, 30000);
  setInterval(syncDesktopReminders, 60000);
  setInterval(handleDateRollover, 30000);
  scheduleAutoBackup();
}

async function initializeHostedConfig() {
  const result = await window.RhythmHostedConfig.loadHostedConfig();
  if (!result.managed) {
    await googleCalendarController.initialize();
    return;
  }
  managedRemoteConfig = true;
  remoteSyncUrl = result.supabaseUrl;
  remoteSyncAnonKey = result.anonKey;
  remoteSyncEnabled = "on";
  saveUiState();
  if (els.remoteSyncUrl) els.remoteSyncUrl.value = remoteSyncUrl;
  if (els.remoteSyncAnonKey) els.remoteSyncAnonKey.value = remoteSyncAnonKey;
  if (els.syncTechnicalSettings) els.syncTechnicalSettings.hidden = true;
  settingsController.syncControls();
  remoteAuthController.render();
  renderRemoteSyncStatus();
  if (remoteAuth.getSession()?.access_token) {
    await remoteAuth.validateSession().catch(() => null);
    if (remoteAuth.getSession()?.access_token) await synchronizeAuthenticatedAccount();
  }
  await googleCalendarController.initialize();
}

async function synchronizeAuthenticatedAccount() {
  const session = remoteAuth.getSession();
  const userId = cleanText(session?.user?.id || "");
  if (!userId) return;
  remoteSyncEnabled = "on";
  if (remoteSyncAccountId && remoteSyncAccountId !== userId) {
    remoteSyncWorkflow.resetQueue();
    const undo = createUndoSnapshot();
    const safetyBackup = createImportSafetyBackup(undo);
    if (safetyBackup?.ok === false) throw new Error("Не удалось создать safety backup перед сменой аккаунта");
    const pulled = await remoteSync.pullState(remoteSync.normalizeConfig({
      accessToken: session.access_token,
      anonKey: remoteSyncAnonKey,
      enabled: true,
      supabaseUrl: remoteSyncUrl,
      userId,
    }));
    replaceState(pulled.found && pulled.state ? pulled.state : null);
    remoteSyncLastPulledAt = pulled.updatedAt || pulled.clientUpdatedAt || "";
    remoteSyncLastPushedAt = "";
    remoteSyncPending = false;
    saveState({ skipBackup: true, skipChangeTracking: true, skipRemote: true });
    render();
    showToast("Загружены данные выбранного аккаунта");
  }
  remoteSyncAccountId = userId;
  saveUiState();
  settingsController.syncControls();
  renderRemoteSyncStatus();
  await remoteSyncWorkflow.syncLatest({ silent: true });
  await remoteSyncWorkflow.push({ silent: true });
  await remoteSyncWorkflow.resumePending();
}

function handleDateRollover() {
  const nextToday = toDateKey(new Date());
  const rollover = window.RhythmDateRollover.resolveDateRollover(activeDate, currentToday, nextToday);
  if (!rollover.changed) return;
  currentToday = rollover.today;
  if (rollover.activeDate !== activeDate) {
    activeDate = rollover.activeDate;
    resetTaskForm({ open: false });
    resetHabitForm({ open: false });
  }
  saveUiState();
  render();
}

function render() {
  appShellController.render();
}

function scrollWorkspaceTop() {
  appShellController.scrollTop();
}

function syncNavigationRoute({ replace = false } = {}) {
  appShellController.syncRoute({ replace });
}

function handleNavigationChange() {
  appShellController.handleNavigationChange();
}

function renderSaveStatus() {
  saveStatusView.render({
    localStorageError,
    localUpdatedAt: localStateUpdatedAt,
    online: navigator.onLine,
    remoteEnabled: remoteSyncEnabled === "on" && Boolean(remoteAuth.getSession()?.user?.id),
    remoteLastPushedAt: remoteSyncLastPushedAt,
    syncStatus: remoteSyncWorkflow.getStatus(),
  });
}

function renderTaskSurfaces() {
  viewRenderer.render(activeView);
}

function renderHabitSurfaces() {
  viewRenderer.render(activeView);
}

function renderGoalSurfaces() {
  renderGoals();
}

function renderDailyPulse() {
  dailyPulseController.render(activeDate);
}

function renderTasks() {
  tasksView.renderTasks();
}

function renderTimeline() {
  timelineView.renderTimeline();
}

function createTaskNode(task) {
  return tasksView.createTaskNode(task);
}

function renderOverdueTasks() {
  tasksView.renderOverdueTasks();
}

function renderExcludedTasks() {
  tasksView.renderExcludedTasks();
}

function excludeTaskDate(task, dateKey) {
  if (task.repeat === "none") return;
  const undo = createUndoSnapshot();
  task.excludedDates = task.excludedDates || {};
  task.excludedDates[dateKey] = true;
  task.updatedAt = new Date().toISOString();
  delete task.completed?.[dateKey];
  delete task.notified?.[dateKey];
  if (Array.isArray(state.taskOrder[dateKey])) {
    state.taskOrder[dateKey] = state.taskOrder[dateKey].filter((id) => id !== task.id);
  }
  saveState();
  render();
  showToast("Повтор исключен на выбранный день", { undo });
}

function acknowledgeOverdueTask(task, dateKey) {
  const undo = createUndoSnapshot();
  task.acknowledgedOverdue = task.acknowledgedOverdue || {};
  task.acknowledgedOverdue[dateKey] = true;
  task.updatedAt = new Date().toISOString();
  saveState();
  render();
  showToast("Задача убрана из просроченных", { undo });
}

function acknowledgeAllOverdueTasks(entries) {
  if (!entries.length) return;
  const undo = createUndoSnapshot();
  entries.forEach(({ task, dateKey }) => {
    task.acknowledgedOverdue = task.acknowledgedOverdue || {};
    task.acknowledgedOverdue[dateKey] = true;
    task.updatedAt = new Date().toISOString();
  });
  saveState();
  render();
  showToast(`Просмотрено задач: ${entries.length}`, { undo });
}

function restoreOverdueTask(task, dateKey) {
  if (!task.acknowledgedOverdue?.[dateKey]) return;
  const undo = createUndoSnapshot();
  delete task.acknowledgedOverdue[dateKey];
  task.updatedAt = new Date().toISOString();
  saveState();
  render();
  showToast("Задача снова появится в просроченных на следующем дне", { undo });
}

function restoreTaskDate(task, dateKey) {
  const undo = createUndoSnapshot();
  if (task.excludedDates) {
    delete task.excludedDates[dateKey];
  }
  task.updatedAt = new Date().toISOString();
  saveState();
  render();
  showToast(`Повтор возвращен на ${formatLongDate(dateKey)}`, { undo });
}

function stopTaskSeries(task, dateKey) {
  if (task.repeat === "none") return;
  const undo = createUndoSnapshot();
  const cutoff = addDays(dateKey, -1);
  task.repeatUntil = cutoff;
  task.updatedAt = new Date().toISOString();
  [task.completed, task.acknowledgedOverdue, task.excludedDates, task.notified].forEach((flags) => {
    Object.keys(flags || {}).forEach((key) => {
      if (key >= dateKey) delete flags[key];
    });
  });
  Object.keys(state.taskOrder).forEach((key) => {
    if (key >= dateKey) state.taskOrder[key] = state.taskOrder[key].filter((id) => id !== task.id);
  });
  saveState();
  render();
  showToast(`Повтор завершен с ${formatLongDate(dateKey)}`, { undo });
}

function deleteTask(taskId) {
  return taskState.deleteTask(taskId);
}

function deleteMovedReplacement(taskId, options) {
  return taskState.deleteMovedReplacement(taskId, options);
}

function deleteHabit(habitId) {
  taskState.deleteHabit(habitId);
}

function reorderHabit(sourceId, targetId) {
  taskState.reorderHabit(sourceId, targetId);
}

function deleteGoal(goalId) {
  taskState.deleteGoal(goalId);
}

async function openDateTasks(dateKey, taskId = "") {
  if (!(await confirmDiscardOpenForms())) return;
  if (taskId) clearTaskFilters();
  activeDate = dateKey;
  activeView = "tasks";
  saveUiState();
  syncNavigationRoute();
  resetTaskForm({ open: false });
  resetHabitForm({ open: false });
  render();
  scrollWorkspaceTop();
  if (taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (task) taskFormController.fillTaskForm(task);
  }
}

async function moveTaskToDate(taskId, sourceDateKey, targetDateKey) {
  const task = state.tasks.find((item) => item.id === taskId);
  const sourceDate = normalizeDateKey(sourceDateKey || activeDate, "");
  const targetDate = normalizeDateKey(targetDateKey, "");
  if (!task || !sourceDate || !targetDate || sourceDate === targetDate) return;
  if (task.repeat !== "none" && !task.sourceTaskId && targetDate > sourceDate) {
    const scope = await confirmAction({
      title: "Перенести повторяющуюся задачу?",
      message: `Перенести только ${formatLongDate(sourceDate)} или сдвинуть эту дату и все последующие повторения?`,
      secondaryLabel: "Только этот день",
      confirmLabel: "Этот и последующие",
    });
    if (!scope) return;
    if (scope === true) {
      const undo = createUndoSnapshot();
      const movedSeries = window.RhythmTaskMoves.moveRecurringSeriesFollowing({
        state,
        task,
        sourceDateKey: sourceDate,
        targetDateKey: targetDate,
        helpers: { createId },
      });
      if (!movedSeries) {
        showToast("Не удалось перенести серию");
        return;
      }
      saveState();
      render();
      showToast(`Серия перенесена на ${formatLongDate(targetDate)}`, {
        undo,
        action: { label: "Открыть день", onClick: () => openDateTasks(targetDate) },
      });
      return;
    }
  }
  postponeTask(task, sourceDate, targetDate);
}

function attachTaskDropZone(element, dateKey) {
  calendarDragController.attachTaskDropZone(element, dateKey);
}

function attachTaskChipDrag(chip) {
  calendarDragController.attachTaskChipDrag(chip);
}

function clearTaskDragState() {
  calendarDragController.clearTaskDragState();
}

function postponeTask(task, sourceDateKey, targetDateKey, options = {}) {
  const targetDate = normalizeDateKey(targetDateKey, "");
  if (!targetDate) {
    showToast("Не удалось перенести задачу");
    return;
  }
  const undo = options.undo || createUndoSnapshot();
  window.RhythmTaskMoves.postponeTask({
    state,
    task,
    sourceDateKey,
    targetDateKey: targetDate,
    options,
    helpers: {
      cleanTimeValue,
      createId,
      taskScheduledOn,
      toDateKey,
    },
  });

  saveState();
  render();
  showToast(`Задача перенесена на ${formatLongDate(targetDate)}`, {
    undo,
    action: { label: "Открыть день", onClick: () => openDateTasks(targetDate) },
  });
}

function renderHabits() {
  habitsView.renderHabits();
}

function renderGoals() {
  goalsView.renderGoals();
}

function createHabitNode(habit) {
  return habitsView.createHabitNode(habit);
}

function habitSubtitle(habit) {
  return habitsView.habitSubtitle(habit);
}

function renderOverview() {
  return calendarView.renderOverview();
}

function renderWeekBoard(week) {
  return calendarView.renderWeekBoard(week);
}

function renderMonthCalendar() {
  return calendarView.renderMonthCalendar();
}

function renderHeatmap() {
  return calendarView.renderHeatmap();
}

function renderArchive() {
  return archiveView.renderArchive();
}

function createArchiveNode(entry) {
  return archiveView.createArchiveNode(entry);
}

function renderCategories() {
  categoriesController.renderCategories();
}

function saveTaskFromForm(event) {
  taskFormController.saveTaskFromForm(event);
}

function saveGoalFromForm(event) {
  goalsView.saveGoalFromForm(event);
}

function resetGoalForm(options) {
  goalsView.resetGoalForm(options);
}

async function saveQuickTask(event) {
  event.preventDefault();
  if (!(await confirmDiscardOpenForms())) return;
  const parsed = parseQuickTaskPreview(els.quickTaskInput.value);
  if (!parsed.title) {
    showToast("Напиши название задачи");
    els.quickTaskInput.focus();
    return;
  }
  if (parsed.warnings?.length) {
    showToast(parsed.warnings[0]);
    return;
  }
  const undo = createUndoSnapshot();
  if (!parsed.categoryId && parsed.categoryName) parsed.categoryId = getOrCreateCategory(parsed.categoryName);

  const task = {
    id: createId(),
    title: parsed.title,
    date: parsed.date,
    time: parsed.time,
    scheduleMode: parsed.scheduleMode || (parsed.time ? "deadline" : "none"),
    startTime: parsed.startTime || "",
    endTime: parsed.endTime || "",
    categoryId: parsed.categoryId,
    priority: parsed.priority,
    repeat: "none",
    customRepeat: {},
    reminderOffset: parsed.time ? "15" : "none",
    completed: {},
    excludedDates: {},
    notified: {},
    createdAt: new Date().toISOString(),
  };

  state.tasks.push(task);
  activeDate = task.date;
  activeView = "tasks";
  if (taskFilter === "done" || !matchesCategoryFilter(task, taskCategoryFilter) ||
    !taskMatchesSearch(task, taskSearchQuery, activeDate)) clearTaskFilters();
  saveUiState();
  syncNavigationRoute();
  els.quickTaskInput.value = "";
  updateQuickTaskPreview();
  saveState();
  resetTaskForm({ open: false });
  render();
  showToast(`Добавлено: ${task.title}`, { undo });
}

function updateQuickTaskPreview() {
  const rawValue = cleanText(els.quickTaskInput.value);
  if (!rawValue) {
    els.quickTaskPreview.hidden = true;
    els.quickTaskPreview.replaceChildren();
    return;
  }

  const parsed = parseQuickTaskPreview(rawValue);
  const category = parsed.categoryId
    ? getCategory(parsed.categoryId)?.name
    : parsed.categoryName
      ? `новая категория: ${parsed.categoryName}`
      : "";
  const details = [
    formatLongDate(parsed.date),
    parsed.scheduleMode === "block" ? formatTaskWindow(parsed) : parsed.time ? formatTaskTime(parsed.time) : "без времени",
    category || "без категории",
    priorityLabels[parsed.priority],
  ];

  els.quickTaskPreview.hidden = false;
  const children = [createQuickPreviewSummary(parsed), createQuickPreviewChips(details)];
  if (parsed.warnings?.length) {
    const warning = document.createElement("p");
    warning.className = "quick-preview-warning";
    warning.textContent = parsed.warnings.join(". ");
    children.push(warning);
  }
  els.quickTaskPreview.replaceChildren(...children);
}

function createQuickPreviewSummary(parsed) {
  const summary = document.createElement("div");
  const label = document.createElement("span");
  const title = document.createElement("strong");
  label.textContent = "Будет создано";
  title.textContent = parsed.title || "Задача без названия";
  summary.append(label, title);
  return summary;
}

function createQuickPreviewChips(details) {
  const chips = document.createElement("div");
  chips.className = "quick-preview-chips";
  details.forEach((detail) => {
    const chip = document.createElement("span");
    chip.textContent = detail;
    chips.appendChild(chip);
  });
  return chips;
}

function parseQuickTaskPreview(value) {
  return window.RhythmQuickInput.parseQuickTaskInput(value, {
    activeDate,
    cleanText,
    getOrCreateCategory: (categoryValue) => {
      const name = normalizeQuickCategoryName(categoryValue);
      return state.categories.find((category) => category.name.toLowerCase() === name.toLowerCase())?.id || "";
    },
    normalizeCategoryName: normalizeQuickCategoryName,
    normalizeDateKey,
    toDateKey,
    toTimeValue,
  });
}

function getCustomRepeatFromForm() {
  const activeMode = document.querySelector("[data-repeat-mode].is-active")?.dataset.repeatMode || "weekdays";
  if (activeMode === "monthDay") {
    return window.RhythmRecurrence.normalizeCustomRepeat({
      type: "monthDay",
      day: Number(els.customRepeatMonthDay.value || 15),
    });
  }
  if (activeMode === "interval") {
    return window.RhythmRecurrence.normalizeCustomRepeat({
      type: "interval",
      every: Number(els.customRepeatInterval.value || 5),
    });
  }

  return window.RhythmRecurrence.normalizeCustomRepeat({
    type: "weekdays",
    weekdays: [...document.querySelectorAll("[data-weekday].is-active")].map((button) => Number(button.dataset.weekday)),
  });
}

function setCustomRepeatForm(value = {}) {
  const custom = window.RhythmRecurrence.normalizeCustomRepeat(value);
  setCustomRepeatMode(custom.type);
  const activeWeekdays = custom.weekdays || [1, 3, 5];
  document.querySelectorAll("[data-weekday]").forEach((button) => {
    button.classList.toggle("is-active", activeWeekdays.includes(Number(button.dataset.weekday)));
  });
  els.customRepeatMonthDay.value = custom.type === "monthDay" ? custom.day : 15;
  els.customRepeatInterval.value = custom.type === "interval" ? custom.every : 5;
  updateCustomRepeatSummary();
}

function syncCustomRepeatPanel() {
  const hasRepeat = els.taskRepeat.value !== "none";
  const isCustom = els.taskRepeat.value === "custom";
  els.taskRepeatUntilField.hidden = !hasRepeat;
  if (hasRepeat) els.taskRepeatUntil.min = els.taskDate.value || activeDate;
  els.customRepeatPanel.hidden = !isCustom;
  if (isCustom) updateCustomRepeatSummary();
}

function setCustomRepeatMode(mode = "weekdays") {
  document.querySelectorAll("[data-repeat-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.repeatMode === mode);
  });
  document.querySelectorAll("[data-repeat-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.repeatPanel !== mode;
  });
  updateCustomRepeatSummary();
}

function updateCustomRepeatSummary() {
  els.customRepeatSummary.textContent = window.RhythmRecurrence.customRepeatLabel(getCustomRepeatFromForm());
}

function getHabitCustomRepeatFromForm() {
  const activeMode = document.querySelector("[data-habit-repeat-mode].is-active")?.dataset.habitRepeatMode || "weekdays";
  if (activeMode === "monthDay") {
    return window.RhythmRecurrence.normalizeCustomRepeat({
      type: "monthDay",
      day: Number(els.habitCustomRepeatMonthDay.value || 15),
    });
  }
  if (activeMode === "interval") {
    return window.RhythmRecurrence.normalizeCustomRepeat({
      type: "interval",
      every: Number(els.habitCustomRepeatInterval.value || 5),
    });
  }

  return window.RhythmRecurrence.normalizeCustomRepeat({
    type: "weekdays",
    weekdays: [...document.querySelectorAll("[data-habit-weekday].is-active")].map((button) =>
      Number(button.dataset.habitWeekday),
    ),
  });
}

function setHabitCustomRepeatForm(value = {}) {
  const custom = window.RhythmRecurrence.normalizeCustomRepeat(value);
  setHabitCustomRepeatMode(custom.type);
  const activeWeekdays = custom.weekdays || [1, 3, 5];
  document.querySelectorAll("[data-habit-weekday]").forEach((button) => {
    button.classList.toggle("is-active", activeWeekdays.includes(Number(button.dataset.habitWeekday)));
  });
  els.habitCustomRepeatMonthDay.value = custom.type === "monthDay" ? custom.day : 15;
  els.habitCustomRepeatInterval.value = custom.type === "interval" ? custom.every : 5;
  updateHabitCustomRepeatSummary();
}

function syncHabitCustomRepeatPanel() {
  const isCustom = els.habitRepeat.value === "custom";
  els.habitCustomRepeatPanel.hidden = !isCustom;
  if (isCustom) updateHabitCustomRepeatSummary();
}

function syncHabitTypeFields() {
  const isNumber = els.habitType.value === "number";
  if (els.habitNumericFields) els.habitNumericFields.hidden = !isNumber;
  els.habitUnit.disabled = !isNumber;
  els.habitGoal.disabled = !isNumber;
}

function setHabitCustomRepeatMode(mode = "weekdays") {
  document.querySelectorAll("[data-habit-repeat-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.habitRepeatMode === mode);
  });
  document.querySelectorAll("[data-habit-repeat-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.habitRepeatPanel !== mode;
  });
  updateHabitCustomRepeatSummary();
}

function updateHabitCustomRepeatSummary() {
  els.habitCustomRepeatSummary.textContent = window.RhythmRecurrence.customRepeatLabel(getHabitCustomRepeatFromForm());
}

async function fillTaskForm(task) {
  if (!(await confirmDiscardOpenForms())) return;
  if (activeView === "timeline") openFloatingTaskForm();
  taskFormController.fillTaskForm(task);
}

function resetTaskForm(options) {
  taskFormController.resetTaskForm(options);
}

function saveHabitFromForm(event) {
  habitFormController.saveHabitFromForm(event);
}

async function fillHabitForm(habit) {
  if (!(await confirmDiscardOpenForms())) return;
  habitFormController.fillHabitForm(habit);
}

function resetHabitForm(options) {
  habitFormController.resetHabitForm(options);
}

function markFormPristine(form) {
  if (form) formSnapshots.set(form, serializeForm(form));
}

function isFormDirty(form) {
  return Boolean(form && formSnapshots.has(form) && formSnapshots.get(form) !== serializeForm(form));
}

function serializeForm(form) {
  const values = [...form.querySelectorAll("input, select, textarea")].map((control) => [
    control.id || control.name || "",
    control.type === "checkbox" || control.type === "radio" ? control.checked : control.value,
  ]);
  const choices = [...form.querySelectorAll("[data-weekday], [data-habit-weekday], [data-repeat-mode], [data-habit-repeat-mode]")]
    .map((button) => [Object.entries(button.dataset), button.classList.contains("is-active")]);
  return JSON.stringify({ values, choices });
}

function clearTaskFilters() {
  taskFilter = "all";
  taskCategoryFilter = "all";
  taskSearchQuery = "";
  els.taskSearch.value = "";
  els.taskCategoryFilter.value = "all";
  document.querySelectorAll("[data-task-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.taskFilter === "all");
  });
}

async function closeFormWithConfirmation(form, panel, focusTarget, afterClose) {
  if (isFormDirty(form)) {
    const confirmed = await confirmAction({
      title: "Закрыть без сохранения?",
      message: "Внесённые в форму изменения будут потеряны.",
      confirmLabel: "Закрыть",
      secondaryLabel: "Продолжить редактирование",
      tone: "danger",
    });
    if (confirmed !== true) return false;
  }
  panel?.classList.add("is-collapsed");
  afterClose?.();
  focusTarget?.focus();
  return true;
}

async function confirmDiscardOpenForms() {
  const forms = [
    [els.taskForm, els.taskFormPanel],
    [els.habitForm, els.habitFormPanel],
    [els.goalForm, els.goalFormPanel],
  ];
  const hasDirtyOpenForm = forms.some(([form, panel]) => panel && !panel.classList.contains("is-collapsed") && isFormDirty(form));
  if (!hasDirtyOpenForm) return true;
  const confirmed = await confirmAction({
    title: "Перейти без сохранения?",
    message: "Открытая форма содержит несохранённые изменения.",
    confirmLabel: "Перейти",
    secondaryLabel: "Остаться",
    tone: "danger",
  });
  return confirmed === true;
}

function saveCategoryFromForm(event) {
  categoriesController.saveCategoryFromForm(event);
}

function deleteCategory(categoryId) {
  categoriesController.deleteCategory(categoryId);
}function openFloatingTaskForm() {
  if (!els.taskFormPanel || !taskFormHome.parent) return;
  if (!els.taskFormPanel.classList.contains("is-floating-panel")) {
    document.body.appendChild(els.taskFormPanel);
    els.taskFormPanel.classList.add("is-floating-panel");
  }
  document.body.classList.add("has-floating-task-form");
  els.taskFormPanel.classList.remove("is-collapsed");
}

function closeFloatingTaskForm() {
  document.body.classList.remove("has-floating-task-form");
}

function restoreTaskFormPanel() {
  if (!els.taskFormPanel || !taskFormHome.parent || !els.taskFormPanel.classList.contains("is-floating-panel")) return;
  taskFormHome.parent.insertBefore(els.taskFormPanel, taskFormHome.next);
  els.taskFormPanel.classList.remove("is-floating-panel");
  document.body.classList.remove("has-floating-task-form");
}

function exportData() {
  importExportController.exportData();
}

async function importData() {
  return importExportController.importData();
}

function tasksForDate(dateKey) {
  return state.tasks.filter((task) => taskOccursOn(task, dateKey));
}

function getOrderedTasksForDate(dateKey) {
  const tasks = tasksForDate(dateKey);
  const taskIds = new Set(tasks.map((task) => task.id));
  const order = Array.isArray(state.taskOrder[dateKey])
    ? state.taskOrder[dateKey].filter((id) => taskIds.has(id))
    : [];
  const orderMap = new Map(order.map((id, index) => [id, index]));

  return tasks.sort((a, b) => {
    return sortTasks(a, b, orderMap);
  });
}

function reorderTask(dateKey, sourceId, targetId) {
  const order = getOrderedTasksForDate(dateKey).map((task) => task.id);
  const from = order.indexOf(sourceId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return;
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  state.taskOrder[dateKey] = order;
}

function taskOccursOn(task, dateKey) {
  return taskScheduledOn(task, dateKey) && !isTaskExcluded(task, dateKey);
}

function taskScheduledOn(task, dateKey) {
  return window.RhythmRecurrence.taskScheduledOn(task, dateKey);
}

function isTaskExcluded(task, dateKey) {
  return task.excludedDates?.[dateKey] === true;
}

function excludedTasksForDate(dateKey) {
  const replacementSourceIds = new Set(
    state.tasks
      .filter((task) => task.repeat === "none" && task.date === dateKey && task.sourceTaskId)
      .map((task) => task.sourceTaskId),
  );
  return state.tasks
    .filter(
      (task) =>
        task.repeat !== "none" &&
        taskScheduledOn(task, dateKey) &&
        isTaskExcluded(task, dateKey) &&
        !replacementSourceIds.has(task.id),
    )
    .sort(sortTasks);
}

function overdueTaskEntries(referenceDateKey = activeDate) {
  const referenceDate = parseDate(normalizeDateKey(referenceDateKey, activeDate));
  referenceDate.setHours(12, 0, 0, 0);
  return overdueController.list(referenceDate);
}

function habitsForDate(dateKey) {
  return state.habits.filter((habit) => {
    const hiddenByArchive = window.RhythmHabitConfigHistory.habitIsArchivedOnDate(habit, dateKey);
    return !hiddenByArchive && habitOccursOn(habit, dateKey);
  });
}

function habitOccursOn(habit, dateKey) {
  const effective = habitConfigOnDate(habit, dateKey);
  const repeat = normalizeHabitRepeat(effective.repeat);
  return window.RhythmRecurrence.taskScheduledOn(
    {
      date: habit.startDate || activeDate,
      repeat: repeat === "weekly" ? "weekly" : repeat,
      customRepeat: effective.customRepeat,
    },
    dateKey,
  );
}

function isTaskDone(task, dateKey) {
  return task.completed?.[dateKey] === true;
}

function isHabitComplete(habit, dateKey) {
  const effective = habitConfigOnDate(habit, dateKey);
  const value = habit.logs?.[dateKey];
  if (effective.type === "number") return Number(value || 0) >= Number(effective.goal || 1);
  return value === true;
}

function habitConfigOnDate(habit, dateKey) {
  return window.RhythmHabitConfigHistory.habitConfigOnDate(habit, dateKey, {
    normalizeCustomRepeat: window.RhythmRecurrence.normalizeCustomRepeat,
    normalizeRepeat: normalizeHabitRepeat,
  });
}

function habitStreak(habit, dateKey = toDateKey(new Date())) {
  let count = 0;
  let guard = 0;
  let cursor = parseDate(dateKey);

  while (guard < 3660) {
    const cursorKey = toDateKey(cursor);
    if (!window.RhythmHabitConfigHistory.habitIsArchivedOnDate(habit, cursorKey) && habitOccursOn(habit, cursorKey)) {
      if (!isHabitComplete(habit, cursorKey)) break;
      count += 1;
    }
    cursor.setDate(cursor.getDate() - 1);
    guard += 1;
  }

  return count;
}

function sortTasks(a, b, orderMap = new Map()) {
  const manualRankA = orderMap.get(a.id);
  const manualRankB = orderMap.get(b.id);
  const hasManualOrder = manualRankA !== undefined || manualRankB !== undefined;
  const priorityWeight = { high: 0, medium: 1, low: 2 };
  const priorityDiff = (priorityWeight[a.priority] ?? 1) - (priorityWeight[b.priority] ?? 1);
  const timeDiff = timeValue(taskSortTime(a)).localeCompare(timeValue(taskSortTime(b)));
  const categoryDiff = categoryLabel(a).localeCompare(categoryLabel(b), "ru");

  if (hasManualOrder) {
    const manualDiff = (manualRankA ?? Number.MAX_SAFE_INTEGER) - (manualRankB ?? Number.MAX_SAFE_INTEGER);
    if (manualDiff !== 0) return manualDiff;
  }
  if (priorityDiff !== 0) return priorityDiff;
  if (timeDiff !== 0) return timeDiff;
  return categoryDiff;
}

function taskDetails(task) {
  const details = [];
  const category = getCategory(task.categoryId);
  if (taskHasSchedule(task)) details.push(formatTaskScheduleLabel(task));
  if (category) details.push(category.name);
  if (task.repeat !== "none") details.push(formatTaskRepeat(task));
  if (taskHasSchedule(task) && task.reminderOffset !== "none") details.push(reminderLabel(task.reminderOffset));
  return details;
}

function matchesCategoryFilter(task, filter) {
  return filter === "all" ? true : (task.categoryId || "none") === filter;
}

function taskMatchesSearch(task, query, dateKey = "") {
  const search = cleanSearchQuery(query);
  if (!search) return true;

  const category = getCategory(task.categoryId);
  const haystack = [
    task.title,
    category?.name,
    priorityLabels[task.priority],
    formatTaskRepeat(task),
    task.time,
    task.startTime,
    task.endTime,
    formatTime(task.time),
    formatTaskScheduleLabel(task),
    dateKey,
    dateKey ? formatLongDate(dateKey) : "",
    task.reminderOffset !== "none" ? reminderLabel(task.reminderOffset) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return search.split(" ").every((token) => haystack.includes(token));
}

function archiveEntryMatchesSearch(entry, query) {
  const search = cleanSearchQuery(query);
  if (!search) return true;

  return taskMatchesSearch(entry.task, search, entry.dateKey);
}

function taskMetaItems(task) {
  const category = getCategory(task.categoryId);
  const items = [];

  if (category) {
    items.push({
      categoryColor: category.color,
      label: category.name,
      type: "category",
    });
  }

  if (taskHasSchedule(task)) items.push({ label: formatTaskScheduleLabel(task), type: "schedule" });
  if (task.repeat !== "none") items.push({ label: formatTaskRepeat(task), type: "repeat" });
  if (taskHasSchedule(task) && task.reminderOffset !== "none") {
    items.push({ label: reminderLabel(task.reminderOffset), type: "reminder" });
  }

  return items.length ? items : [{ label: "Без категории", type: "empty" }];
}

function categoryLabel(task) {
  return getCategory(task.categoryId)?.name || "\uffff";
}

function timeValue(value) {
  return cleanTimeValue(value) || "99:99";
}

function formatTaskRepeat(task) {
  const label = window.RhythmRecurrence.repeatLabel(task);
  return task.repeatUntil ? `${label} · до ${formatShortDate(task.repeatUntil)}` : label;
}

function normalizeHabitRepeat(value) {
  return VALID_HABIT_REPEATS.includes(value) ? value : "daily";
}

function formatHabitRepeat(habit) {
  return window.RhythmRecurrence.repeatLabel({
    repeat: normalizeHabitRepeat(habit.repeat),
    customRepeat: habit.customRepeat,
  });
}

function reminderLabel(value) {
  const labels = {
    0: "напомнить в срок",
    5: "за 5 минут",
    15: "за 15 минут",
    30: "за 30 минут",
    60: "за 1 час",
    1440: "за день",
  };
  return labels[value] || "без напоминания";
}

function statsForDate(dateKey) {
  const tasks = tasksForDate(dateKey);
  const habits = habitsForDate(dateKey);
  const taskDone = tasks.filter((task) => isTaskDone(task, dateKey)).length;
  const habitDone = habits.filter((habit) => isHabitComplete(habit, dateKey)).length;
  const taskTotal = tasks.length;
  const habitTotal = habits.length;
  return {
    habitDone,
    habitPercent: habitTotal ? Math.round((habitDone / habitTotal) * 100) : 0,
    habitTotal,
    taskDone,
    taskPercent: taskTotal ? Math.round((taskDone / taskTotal) * 100) : 0,
    taskTotal,
  };
}

function archiveEntries() {
  return state.tasks
    .flatMap((task) =>
      Object.entries(task.completed || {})
        .filter(([, done]) => done === true)
        .map(([dateKey]) => ({ dateKey, task })),
    )
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.task.createdAt.localeCompare(a.task.createdAt));
}

function getCategory(categoryId) {
  return state.categories.find((category) => category.id === categoryId);
}

function checkDueNotifications() {
  notificationsController.checkDueNotifications();
}

async function requestNotifications() {
  notificationSetting = "on";
  applySettingsPreferences();
  saveUiState();
  return notificationsController.requestNotifications();
}

function updateNotificationButton(permission = "Notification" in window ? Notification.permission : "default") {
  notificationsController.updateNotificationButton(permission);
}

function syncDesktopReminders() {
  notificationsController.syncDesktopReminders();
}

function syncDesktopBackup() {
  return importExportController.syncDesktopBackup();
}

async function updateFileBackupStatus() {
  return importExportController.updateFileBackupStatus();
}

async function openBackupFolder() {
  return importExportController.openBackupFolder();
}

function candidateReminderDates(task, now) {
  return notificationsController.candidateReminderDates(task, now);
}

function getDueDate(task, dateKey) {
  return notificationsController.getDueDate(task, dateKey);
}

function getTaskDeadlineDate(task, dateKey) {
  return notificationsController.getTaskDeadlineDate(task, dateKey);
}

function getReminderDate(task, dateKey) {
  return notificationsController.getReminderDate(task, dateKey);
}

async function shiftDate(days) {
  if (!(await confirmDiscardOpenForms())) return;
  const date = parseDate(activeDate);
  date.setDate(date.getDate() + days);
  activeDate = toDateKey(date);
  saveUiState();
  resetTaskForm({ open: false });
  resetHabitForm({ open: false });
  render();
}

async function goToday() {
  if (!(await confirmDiscardOpenForms())) return;
  activeDate = toDateKey(new Date());
  saveUiState();
  resetTaskForm({ open: false });
  resetHabitForm({ open: false });
  render();
}

async function shiftMonth(months) {
  if (!(await confirmDiscardOpenForms())) return;
  const date = parseDate(activeDate);
  const targetDay = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(targetDay, lastDay));
  activeDate = toDateKey(target);
  saveUiState();
  resetTaskForm({ open: false });
  resetHabitForm({ open: false });
  render();
}

function saveUiState() {
  try {
    storage.saveUiState({
      activeDate,
      activeView,
      accentPreference,
      archiveCategoryFilter,
      archivePeriod,
      archiveSearchQuery,
      backupSchedule,
      currentToday,
      densityPreference,
      firstDayOfWeek,
      lastAutoBackupAt,
      localStateUpdatedAt,
      notificationSetting,
      overviewMode,
      overdueHidden,
      remoteSyncAnonKey,
      remoteSyncAccountId,
      remoteSyncEnabled,
      remoteSyncLastPulledAt,
      remoteSyncLastPushedAt,
      remoteSyncPending,
      remoteSyncUrl,
      taskCategoryFilter,
      taskFilter,
      taskSearchQuery,
      themePreference,
      timeFormat,
    });
    if (localStorageError === "Не удалось сохранить настройки локально") localStorageError = "";
    return true;
  } catch {
    localStorageError = "Не удалось сохранить настройки локально";
    renderSaveStatus();
    return false;
  }
}

function normalizeThemePreference(value) {
  return settingsState.normalizeThemePreference(value);
}

function normalizeAccentPreference(value) {
  return settingsState.normalizeAccentPreference(value);
}

function normalizeNotificationSetting(value) {
  return settingsState.normalizeNotificationSetting(value);
}

function normalizeBackupSchedule(value) {
  return settingsState.normalizeBackupSchedule(value);
}

function normalizeFirstDayOfWeek(value) {
  return settingsState.normalizeFirstDayOfWeek(value);
}

function normalizeDensityPreference(value) {
  return settingsState.normalizeDensityPreference(value);
}

function normalizeTimeFormat(value) {
  return settingsState.normalizeTimeFormat(value);
}

function normalizeRemoteSyncEnabled(value) {
  return settingsState.normalizeRemoteSyncEnabled(value);
}

function updateTimeZone(value) {
  const fallback = profileSettings.detectTimeZone();
  const normalized = profileSettings.normalizeTimeZone(value, fallback);
  if (normalized !== String(value || "").trim()) {
    settingsController.syncControls();
    showToast("Укажи часовой пояс в формате Europe/Moscow");
    return;
  }
  state.profile = { ...state.profile, timeZone: normalized, updatedAt: new Date().toISOString() };
  saveState();
  settingsController.syncControls();
  render();
  showToast(`Часовой пояс: ${normalized}`);
}

function updateJournalPermission(permission, value) {
  if (!["read", "write"].includes(permission)) return;
  const enabled = value !== "off";
  state.profile = {
    ...state.profile,
    journalAccess: {
      read: state.profile?.journalAccess?.read !== false,
      write: state.profile?.journalAccess?.write !== false,
      [permission]: enabled,
    },
    updatedAt: new Date().toISOString(),
  };
  saveState();
  settingsController.syncControls();
  showToast(enabled ? "Доступ ChatGPT разрешён" : "Доступ ChatGPT отключён");
}

function applyThemePreference() {
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)")?.matches;
  const resolvedTheme = themePreference === "system" ? (prefersLight ? "light" : "dark") : themePreference;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = themePreference;
  if (els.themePreference) els.themePreference.value = themePreference;
}

function applySettingsPreferences() {
  document.documentElement.dataset.accent = accentPreference;
  document.documentElement.dataset.density = densityPreference;
  if (els.notificationSetting) els.notificationSetting.value = notificationSetting;
  if (els.backupSchedule) els.backupSchedule.value = backupSchedule;
  if (els.firstDayOfWeek) els.firstDayOfWeek.value = firstDayOfWeek;
  if (els.densityPreference) els.densityPreference.value = densityPreference;
  if (els.timeFormat) els.timeFormat.value = timeFormat;
  if (els.remoteSyncEnabled) els.remoteSyncEnabled.value = remoteSyncEnabled;
  if (els.remoteSyncUrl) els.remoteSyncUrl.value = remoteSyncUrl;
  if (els.remoteSyncAnonKey) els.remoteSyncAnonKey.value = remoteSyncAnonKey;
  syncCustomRepeatPanel();
  syncHabitCustomRepeatPanel();
}

function getUiSettings() {
  return {
    accentPreference,
    backupSchedule,
    densityPreference,
    firstDayOfWeek,
    localStateUpdatedAt,
    notificationSetting,
    remoteSyncAnonKey,
    remoteSyncAccountId,
    remoteSyncEnabled,
    remoteSyncLastPulledAt,
    remoteSyncLastPushedAt,
    remoteSyncPending,
    remoteSyncUrl,
    themePreference,
    timeFormat,
  };
}

function getRemoteUiSettings(overrides = {}) {
  return settingsState.createRemoteUiSettings(getUiSettings(), overrides);
}

function updateSetting(name, value) {
  switch (name) {
    case "accentPreference":
      accentPreference = normalizeAccentPreference(value);
      applySettingsPreferences();
      saveUiState();
      settingsController.syncControls();
      showToast("Цвет интерфейса обновлён");
      break;
    case "themePreference":
      themePreference = normalizeThemePreference(value);
      applyThemePreference();
      saveUiState();
      settingsController.syncControls();
      showToast("Тема обновлена");
      break;
    case "notificationSetting":
      notificationSetting = normalizeNotificationSetting(value);
      saveUiState();
      settingsController.syncControls();
      updateNotificationButton();
      syncDesktopReminders();
      showToast(notificationSetting === "on" ? "Напоминания включены" : "Напоминания на паузе");
      break;
    case "backupSchedule":
      backupSchedule = normalizeBackupSchedule(value);
      saveUiState();
      scheduleAutoBackup();
      settingsController.syncControls();
      showToast(backupSchedule === "0" ? "Плановый бэкап выключен" : "Расписание бэкапа обновлено");
      break;
    case "firstDayOfWeek":
      firstDayOfWeek = normalizeFirstDayOfWeek(value);
      saveUiState();
      settingsController.syncControls();
      renderWeekdayLabels();
      renderOverview();
      render();
      showToast("Календарь обновлен");
      break;
    case "densityPreference":
      densityPreference = normalizeDensityPreference(value);
      applySettingsPreferences();
      saveUiState();
      settingsController.syncControls();
      showToast("Плотность интерфейса обновлена");
      break;
    case "timeFormat":
      timeFormat = normalizeTimeFormat(value);
      applySettingsPreferences();
      saveUiState();
      settingsController.syncControls();
      render();
      showToast("Формат времени обновлен");
      break;
    case "remoteSyncEnabled":
      remoteSyncEnabled = normalizeRemoteSyncEnabled(value);
      remoteSyncWorkflow.clearError();
      applySettingsPreferences();
      saveUiState();
      settingsController.syncControls();
      renderRemoteSyncStatus();
      if (isRemoteSyncReady()) scheduleRemotePush();
      showToast(remoteSyncEnabled === "on" ? "Синхронизация с БД включена" : "Синхронизация с БД выключена");
      break;
    case "remoteSyncUrl":
      if (managedRemoteConfig) {
        settingsController.syncControls();
        return;
      }
      remoteSyncUrl = cleanText(value);
      remoteSyncWorkflow.clearError();
      applySettingsPreferences();
      saveUiState();
      settingsController.syncControls();
      renderRemoteSyncStatus();
      remoteAuthController.render();
      break;
    case "remoteSyncAnonKey":
      if (managedRemoteConfig) {
        settingsController.syncControls();
        return;
      }
      remoteSyncAnonKey = cleanText(value);
      remoteSyncWorkflow.clearError();
      applySettingsPreferences();
      saveUiState();
      settingsController.syncControls();
      renderRemoteSyncStatus();
      remoteAuthController.render();
      break;
  }
}

function resetInterfacePreferences() {
  themePreference = "dark";
  accentPreference = "emerald";
  densityPreference = "comfortable";
  timeFormat = "24";
  firstDayOfWeek = "monday";
  applyThemePreference();
  applySettingsPreferences();
  saveUiState();
  settingsController.syncControls();
  render();
  showToast("Настройки интерфейса сброшены");
}

function applyImportedSettings(settings = {}) {
  const normalized = settingsState.normalizeImportedSettings(settings);
  themePreference = normalized.themePreference;
  accentPreference = normalized.accentPreference;
  notificationSetting = normalized.notificationSetting;
  backupSchedule = normalized.backupSchedule;
  firstDayOfWeek = normalized.firstDayOfWeek;
  densityPreference = normalized.densityPreference;
  timeFormat = normalized.timeFormat;
  remoteSyncWorkflow.clearError();
  applyThemePreference();
  applySettingsPreferences();
  scheduleAutoBackup();
  settingsController.syncControls();
  renderRemoteSyncStatus();
  updateNotificationButton();
  syncDesktopReminders();
}

function renderSettingsBackupStatus() {
  if (!els.settingsBackupStatus) return;
  if (backupSchedule === "0") {
    els.settingsBackupStatus.textContent = "Авто-бэкап выключен";
    return;
  }
  const last = lastAutoBackupAt ? formatBackupDate(lastAutoBackupAt) : "еще не запускался";
  const next = nextAutoBackupAt ? formatBackupDate(nextAutoBackupAt) : "ожидает расписание";
  els.settingsBackupStatus.textContent = `Последний авто-бэкап: ${last} · следующий: ${next}`;
}

function isRemoteSyncReady() {
  return remoteSyncWorkflow.isReady();
}

function renderRemoteSyncStatus() {
  remoteSyncWorkflow.renderStatus();
  syncDiagnosticsController?.render();
}

function scheduleRemotePush() {
  remoteSyncWorkflow.schedulePush();
}

async function pushRemoteState(options = {}) {
  return remoteSyncWorkflow.push(options);
}

async function checkRemoteConnection(options = {}) {
  const result = await remoteSyncWorkflow.check(options);
  syncDiagnosticsController?.setConnectionResult(result);
  return result;
}

async function pullRemoteState(options = {}) {
  return remoteSyncWorkflow.pull(options);
}

function latestIsoDate(...values) {
  return values.filter(Boolean).sort().at(-1) || "";
}

function describeRemoteSyncError(error) {
  return saveStatusView.describeRemoteError(error);
}

function scheduleAutoBackup() {
  if (autoBackupTimerId) {
    clearInterval(autoBackupTimerId);
    autoBackupTimerId = null;
  }

  const minutes = Number(backupSchedule);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    nextAutoBackupAt = "";
    renderSettingsBackupStatus();
    return;
  }

  const intervalMs = minutes * 60 * 1000;
  nextAutoBackupAt = new Date(Date.now() + intervalMs).toISOString();
  renderSettingsBackupStatus();

  autoBackupTimerId = setInterval(async () => {
    const localResult = createBackup({ silent: true });
    const fileResult = await syncDesktopBackup();
    if (localResult?.ok || fileResult?.ok) {
      lastAutoBackupAt = new Date().toISOString();
      saveUiState();
    }
    nextAutoBackupAt = new Date(Date.now() + intervalMs).toISOString();
    renderSettingsBackupStatus();
  }, intervalMs);
}

function cleanSearchQuery(value) {
  return cleanText(value).toLowerCase();
}

function formatTaskTime(value) {
  const formatted = formatTime(value);
  return formatted ? `до ${formatted}` : "";
}

function isTimeBlock(task) {
  return task?.scheduleMode === "block" && isValidTimeBlock(task.startTime, task.endTime);
}

function isValidTimeBlock(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

function taskHasSchedule(task) {
  return isTimeBlock(task) || Boolean(cleanTimeValue(task?.time));
}

function taskSortTime(task) {
  return isTimeBlock(task) ? task.startTime : task?.time || "";
}

function formatTaskWindow(task) {
  if (!isValidTimeBlock(task?.startTime, task?.endTime)) return "";
  return `${formatTime(task.startTime)}-${formatTime(task.endTime)}`;
}

function formatTaskScheduleLabel(task) {
  return isTimeBlock(task) ? formatTaskWindow(task) : formatTaskTime(task.time);
}

function parseQuickTaskInput(value) {
  const parsed = parseQuickTaskPreview(value);
  if (parsed.title && !parsed.categoryId && parsed.categoryName) {
    parsed.categoryId = getOrCreateCategory(parsed.categoryName);
  }
  return parsed;
}

function getOrCreateCategory(value) {
  const name = normalizeQuickCategoryName(value);
  if (!name) return "";
  const existing = state.categories.find((category) => category.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;

  const category = {
    id: createId(),
    name,
    color: randomCategoryColor(),
    createdAt: new Date().toISOString(),
  };
  state.categories.push(category);
  return category.id;
}

function normalizeQuickCategoryName(value) {
  const name = cleanText(String(value || "").replaceAll("_", " "));
  if (!name) return "";
  return name.charAt(0).toLocaleUpperCase("ru-RU") + name.slice(1);
}

function normalizeReminderOffset(value, hasTime = true) {
  const offset = String(value ?? (hasTime ? "15" : "none"));
  if (VALID_REMINDER_OFFSETS.includes(offset)) return offset;
  return hasTime ? "15" : "none";
}

function normalizeState(raw) {
  return stateNormalizer.normalizeState(raw);
}

function replaceState(nextState) {
  state = stateController.replaceState(nextState);
}

function saveState(options = {}) {
  try {
    state = stateController.saveState(state, options);
    localStorageError = "";
  } catch {
    localStateUpdatedAt = options.localUpdatedAt || new Date().toISOString();
    if (!options.skipRemote) scheduleRemotePush();
    syncDesktopReminders();
    localStorageError = "Локальное хранилище заполнено · экспортируй данные";
    renderSaveStatus();
    showToast("Не удалось сохранить данные. Экспортируй JSON, чтобы не потерять изменения");
    return false;
  }
  localStateUpdatedAt = options.localUpdatedAt || new Date().toISOString();
  saveUiState();
  renderSaveStatus();
  if (!options.skipBackup) updateBackupStatus();
  syncDesktopReminders();
  if (!options.skipBackup && !options.skipRemote) scheduleRemotePush();
  if (!options.skipGoogleCalendar) googleCalendarController.schedule();
  return true;
}

function createBackup(options = {}) {
  return importExportController.createBackup(options);
}

function createImportSafetyBackup(snapshot) {
  return importExportController.createImportSafetyBackup(snapshot);
}

function restoreBackup() {
  return importExportController.restoreBackup();
}

function loadBackup() {
  return importExportController.loadBackup();
}

function updateBackupStatus() {
  importExportController.updateBackupStatus();
}

function formatBackupDate(value) {
  return importExportController.formatBackupDate(value);
}

function seedIfEmpty() {
  if (initialStateLoad.status === "corrupt") return;
  if (state.defaultsSeeded) return;
  state.defaultsSeeded = true;
  if (state.categories.length) {
    saveState();
    return;
  }
  state.categories.push(
    { id: createId(), name: "Работа", color: "#5967d8", createdAt: new Date().toISOString() },
    { id: createId(), name: "Фокус", color: "#00a78e", createdAt: new Date().toISOString() },
    { id: createId(), name: "Здоровье", color: "#ef6a4b", createdAt: new Date().toISOString() },
    { id: createId(), name: "Дом", color: "#e7b84a", createdAt: new Date().toISOString() },
  );
  saveState();
}

function renderWeekdayLabels() {
  if (!els.monthWeekdays) return;
  const mondayFirst = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const sundayFirst = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  els.monthWeekdays.replaceChildren(
    ...(firstDayOfWeek === "sunday" ? sundayFirst : mondayFirst).map((label) => {
      const node = document.createElement("span");
      node.textContent = label;
      return node;
    }),
  );
}

function icon(name) {
  return `<svg class="ui-icon"><use href="#icon-${name}"></use></svg>`;
}

function createUndoSnapshot() {
  return {
    activeDate,
    activeView,
    state: JSON.stringify(state),
  };
}

function restoreUndoSnapshot(snapshot) {
  if (!snapshot?.state) return;
  try {
    replaceState(JSON.parse(snapshot.state));
    activeDate = normalizeDateKey(snapshot.activeDate, toDateKey(new Date()));
    activeView = snapshot.activeView || "tasks";
    saveState();
    resetTaskForm({ open: false });
    render();
    showToast("Действие отменено");
  } catch {
    showToast("Не удалось отменить действие");
  }
}

function showToast(message, options = {}) {
  toastController.showToast(message, options);
}

function confirmAction(options = {}) {
  return confirmDialog.confirm(options);
}
