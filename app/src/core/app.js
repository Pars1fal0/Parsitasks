const documentState = window.RhythmDocumentState;
const SCHEMA_VERSION = documentState.SCHEMA_VERSION;
const VALID_BACKUP_SCHEDULES = ["0", "5", "15", "30", "60"];
const VALID_VIEWS = ["tasks", "timeline", "habits", "goals", "overview", "study", "nutrition", "journal", "board", "archive", "settings"];

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
let taskPane = ["day", "later", "backlog"].includes(initialUiState.taskPane) ? initialUiState.taskPane : "day";
let showStudyEvents = initialUiState.showStudyEvents !== false;
let overviewMode = initialRoute?.overviewMode || (["day", "week", "month", "year"].includes(initialUiState.overviewMode)
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
let navigationPreferences = window.RhythmNavigationPreferences.normalize(initialUiState.navigationPreferences);
let quietHours = window.RhythmReminderPolicy.normalizeQuietHours(initialUiState.quietHours);
let backupSchedule = normalizeBackupSchedule(initialUiState.backupSchedule);
let firstDayOfWeek = normalizeFirstDayOfWeek(initialUiState.firstDayOfWeek);
let densityPreference = normalizeDensityPreference(initialUiState.densityPreference);
let timeFormat = normalizeTimeFormat(initialUiState.timeFormat);
let appliedAccountPreferences = "";
let remoteSyncEnabled = normalizeRemoteSyncEnabled(initialUiState.remoteSyncEnabled);
let remoteSyncUrl = cleanText(initialUiState.remoteSyncUrl || "");
let remoteSyncAnonKey = cleanText(initialUiState.remoteSyncAnonKey || "");
let remoteSyncAccountId = cleanText(initialUiState.remoteSyncAccountId || "");
let authenticatedSyncGeneration = 0;
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
  goalLinkedTaskIds: document.querySelector("#goalLinkedTaskIds"),
  goalHabitTargets: document.querySelector("#goalHabitTargets"),
  goalList: document.querySelector("#goalList"),
  goalTaskSearch: document.querySelector("#goalTaskSearch"),
  goalTaskOptions: document.querySelector("#goalTaskOptions"),
  goalTaskLinkCount: document.querySelector("#goalTaskLinkCount"),
  goalHabitSearch: document.querySelector("#goalHabitSearch"),
  goalHabitOptions: document.querySelector("#goalHabitOptions"),
  goalHabitLinkCount: document.querySelector("#goalHabitLinkCount"),
  goalOverdueMetric: document.querySelector("#goalOverdueMetric"),
  goalTitle: document.querySelector("#goalTitle"),
  globalSearchButton: document.querySelector("#globalSearchButton"),
  globalSearchClose: document.querySelector("#globalSearchClose"),
  globalSearchDialog: document.querySelector("#globalSearchDialog"),
  globalSearchInput: document.querySelector("#globalSearchInput"),
  globalSearchResults: document.querySelector("#globalSearchResults"),
  habitDoneMetric: document.querySelector("#habitDoneMetric"),
  habitFrozenMetric: document.querySelector("#habitFrozenMetric"),
  habitFreezeDialog: document.querySelector("#habitFreezeDialog"),
  habitFreezeForm: document.querySelector("#habitFreezeForm"),
  habitFreezeHeading: document.querySelector("#habitFreezeHeading"),
  habitFreezeList: document.querySelector("#habitFreezeList"),
  habitFreezeStart: document.querySelector("#habitFreezeStart"),
  habitFreezeStartLabel: document.querySelector("#habitFreezeStartLabel"),
  habitFreezeEnd: document.querySelector("#habitFreezeEnd"),
  habitFreezeEndField: document.querySelector("#habitFreezeEndField"),
  habitFreezeReason: document.querySelector("#habitFreezeReason"),
  habitFreezeReasonField: document.querySelector("#habitFreezeReasonField"),
  habitFreezeCurrentReason: document.querySelector("#habitFreezeCurrentReason"),
  habitFreezeCustomReason: document.querySelector("#habitFreezeCustomReason"),
  habitFreezeCustomReasonField: document.querySelector("#habitFreezeCustomReasonField"),
  habitFreezeMessage: document.querySelector("#habitFreezeMessage"),
  habitFreezeSubmit: document.querySelector("#habitFreezeSubmit"),
  habitFreezeCancel: document.querySelector("#habitFreezeCancel"),
  openHabitFreeze: document.querySelector("#openHabitFreeze"),
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
  journalPane: document.querySelector("#journalPane"),
  notesPane: document.querySelector("#notesPane"),
  notesTabs: [...document.querySelectorAll("[data-notes-tab]")],
  notesWorkspace: document.querySelector("#notesWorkspace"),
  notesEmpty: document.querySelector("#notesEmpty"),
  noteNew: document.querySelector("#noteNew"),
  noteSearch: document.querySelector("#noteSearch"),
  noteSubjectFilter: document.querySelector("#noteSubjectFilter"),
  notePinnedOnly: document.querySelector("#notePinnedOnly"),
  noteCount: document.querySelector("#noteCount"),
  noteList: document.querySelector("#noteList"),
  notePlaceholder: document.querySelector("#notePlaceholder"),
  noteForm: document.querySelector("#noteForm"),
  noteId: document.querySelector("#noteId"),
  noteTitle: document.querySelector("#noteTitle"),
  noteBody: document.querySelector("#noteBody"),
  notePinned: document.querySelector("#notePinned"),
  noteSubjectId: document.querySelector("#noteSubjectId"),
  noteTaskSearch: document.querySelector("#noteTaskSearch"),
  noteTaskId: document.querySelector("#noteTaskId"),
  noteDelete: document.querySelector("#noteDelete"),
  noteOpenTask: document.querySelector("#noteOpenTask"),
  noteBack: document.querySelector("#noteBack"),
  noteUpdatedAt: document.querySelector("#noteUpdatedAt"),
  noteStatus: document.querySelector("#noteStatus"),
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
  dayProgressValue: document.querySelector("#dayProgressValue"),
  dayProgressBar: document.querySelector("#dayProgressBar"),
  dayProgressSummary: document.querySelector("#dayProgressSummary"),
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
  timelineJumpToTask: document.querySelector("#timelineJumpToTask"),
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
    study: document.querySelector("#studyView"),
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
  "boardAddFrame", "boardAddImage", "boardAddText", "boardAddLink", "boardAddMenu", "boardBold", "boardBringFront", "boardColorPresets", "boardDuplicate", "boardDelete",
  "boardEmpty", "boardFocus", "boardFontSize", "boardGroup", "boardImageInput", "boardLock", "boardMarquee",
  "boardModePan", "boardModeSelect", "boardRedo", "boardSelectionToolbar", "boardSendBack", "boardStatus",
  "boardTextColor", "boardTextControls", "boardUndo", "boardViewport", "boardWorld", "boardZoomIn", "boardZoomLabel", "boardZoomOut",
  "boardSourcePicker", "boardSourceSearch", "boardSourceType", "boardSourceResults", "boardPickerClose", "boardStartBlank", "boardAreaNav", "boardAreaSelect", "boardLinkControls",
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

function saveSubtaskChange(task, dateKey, scope, changes) {
  const undo = createUndoSnapshot();
  const removing = Object.hasOwn(changes, "itemId");
  let saved;
  try {
    const mutate = removing ? window.RhythmTaskSubtasks.removeSubtask : window.RhythmTaskSubtasks.appendSubtask;
    saved = mutate({ state, task, dateKey, scope, createId, ...changes });
  } catch (error) { return { error: error.message }; }
  if (saveState() === false) {
    // Keep the draft mounted while restoring the original task references.
    const previous = JSON.parse(undo.state);
    const original = previous.tasks.find((item) => item.id === task.id);
    Object.keys(task).forEach((key) => delete task[key]); Object.assign(task, original);
    state.tasks = previous.tasks.map((item) => item.id === task.id ? task : state.tasks.find((current) => current.id === item.id) || item);
    state.taskOrder = previous.taskOrder;
    return { error: "Не удалось сохранить. Попробуйте снова." };
  }
  showToast(removing ? "Подзадача удалена" : "Подзадача добавлена", { undo });
  return { id: saved.id };
}

const tasksView = window.RhythmTasksView.createTasksView({
  getPane: () => taskPane,
  onPaneChange: (value) => { taskPane = value; saveUiState(); updateQuickTaskPreview(); },
  deferTasks: deferSelectedTasks,
  dismissTasks: dismissSelectedTasks,
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
  duplicateTask: (taskId) => timelineController.duplicateTask(taskId),
  escapeHtml,
  excludeTaskDate,
  excludedTasksForDate,
  fillTaskForm,
  openSubtaskDialog: async (task, dateKey) => {
    const previousState = state;
    if (!(await confirmDiscardOpenForms()) || state !== previousState) return;
    subtaskController.open(task, dateKey);
  },
  addSubtask: (task, dateKey, title, scope) => saveSubtaskChange(task, dateKey, scope, { title }),
  removeSubtask: (task, dateKey, itemId, scope) => saveSubtaskChange(task, dateKey, scope, { itemId }),
  formatLongDate,
  formatTime,
  formatTaskRepeat,
  getActiveDate: () => activeDate,
  getCategory,
  getOrderedTasksForDate,
  getState: () => state,
  getNotesForTask: notesForTask,
  openNotesForTask,
  getTaskCategoryFilter: () => taskCategoryFilter,
  getTaskFilter: () => taskFilter,
  getTaskSearchQuery: () => taskSearchQuery,
  openNote: openLinkedNote,
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
  moveTasks: moveSelectedTasks,
  openLaterTaskForm: async () => {
    if (!(await confirmDiscardOpenForms())) return;
    resetTaskForm({ open: true });
    taskFormController.setDeferred(true);
    markFormPristine(els.taskForm);
    els.taskTitle.focus();
  },
  render: renderTaskSurfaces,
  reorderTask,
  restoreTaskDate,
  restoreOverdueTask,
  stopTaskSeries,
  restoreState: restoreFailedSave,
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
  todayKey: () => toDateKey(new Date()),
  applyHabitAvailabilityChange: window.RhythmHabitConfigHistory.applyHabitAvailabilityChange,
  els,
  confirmAction,
  createUndoSnapshot,
  restoreState: restoreFailedSave,
  deleteHabit,
  escapeHtml,
  fillHabitForm,
  formatHabitRepeat,
  getActiveDate: () => activeDate,
  getState: () => state,
  isTaskDone,
  habitStreak,
  habitStatusOnDate,
  openFreezeDialog: (habitId, operation) => habitFreezeDialog.open(habitId, operation),
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

const habitFreezeDialog = window.RhythmHabitFreezeDialog.createHabitFreezeDialog({
  els,
  createUndoSnapshot,
  restoreState: restoreFailedSave,
  getActiveDate: () => activeDate,
  getState: () => state,
  habitStatusOnDate,
  habitTitleOnDate: window.RhythmHabitTitleHistory.habitTitleOnDate,
  render,
  saveState,
  showToast,
});
els.openHabitFreeze.addEventListener("click", () => habitFreezeDialog.open());

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
  restoreState: (snapshot) => replaceState(JSON.parse(snapshot.state)),
  deleteGoal,
  getActiveDate: () => activeDate,
  getState: () => state,
  habitStatusOnDate,
  markFormPristine,
  normalizeDateKey,
  openTask: (task) => openDateTasks(task.date, task.id),
  openHabit: openLinkedHabit,
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
  toggleTaskDone: toggleCalendarTaskDone,
  renderSchedule: (mode) => calendarSchedule.render(mode),
  selectCalendarDate: (dateKey) => { activeDate = dateKey; saveUiState(); render(); },
  getStudyEvents,
  openStudyLesson,
  els,
  attachTaskChipDrag,
  attachTaskDropZone,
  escapeHtml,
  formatLongDate,
  formatMonthLabel,
  formatShortDate,
  formatWeekday,
  getActiveDate: () => activeDate,
  getState: () => state,
  getCategory,
  getMonthCalendarDates,
  getOrderedTasksForDate,
  getWeekDates,
  habitsForDate,
  habitStatusOnDate,
  heatAlpha,
  isTaskDone,
  openDateTasks,
  parseDate,
  priorityLabels,
  statsForDate,
  toDateKey,
});

const timelineController = window.RhythmTimelineController.createTimelineController({
  markFormPristine,
  cleanTimeValue,
  confirmAction,
  createId,
  createUndoSnapshot,
  restoreState: restoreFailedSave,
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

const calendarSchedule = window.RhythmCalendarSchedule.createCalendarSchedule({
  toggleTaskDone: toggleCalendarTaskDone,
  getActiveDate: () => activeDate,
  getState: () => state,
  getTasks: getOrderedTasksForDate,
  getStudyEvents,
  getWeekDates,
  getCategory,
  isTaskDone,
  todayKey: () => toDateKey(new Date()),
  formatLongDate,
  formatShortDate,
  openLesson: (lesson, date) => openStudyLesson(lesson.id, date),
  selectDate: async (date) => {
    if (!(await confirmDiscardOpenForms())) return false;
    activeDate = date;
    resetTaskForm({ open: false });
    saveUiState();
    render();
    return true;
  },
  createTask: async (date, start, end) => {
    if (!(await confirmDiscardOpenForms())) return;
    activeDate = date;
    saveUiState();
    render();
    if (start && end) timelineController.createTaskAtTime(start, end);
    else { resetTaskForm(); openFloatingTaskForm(); els.taskTitle.focus(); }
  },
  editTask: async (task, date) => {
    const owner = state;
    if (!(await confirmDiscardOpenForms()) || state !== owner || !state.tasks.includes(task)) return;
    activeDate = date;
    saveUiState();
    render();
    openFloatingTaskForm();
    taskFormController.fillTaskForm(task);
  },
  scheduleTask: calendarScheduleTask,
  resizeTask: async (id, date, start, end) => {
    const owner = state;
    if (!(await confirmDiscardOpenForms()) || state !== owner) { render(); return false; }
    const task = state.tasks.find((item) => item.id === id);
    if (!task || !taskOccursOn(task, date)) return false;
    activeDate = date;
    saveUiState();
    const result = await timelineController.resizeTaskBlockTime(id, start, end);
    if (!result) render();
    return result;
  },
});

async function toggleCalendarTaskDone(taskId, date) {
  const owner = state;
  if (!(await confirmDiscardOpenForms()) || state !== owner) { render(); return false; }
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || (!taskOccursOn(task, date) && !(task.date === null && task.repeat === "none" && task.dueDate === date))) { render(); return false; }
  const undo = createUndoSnapshot();
  const done = isTaskDone(task, date);
  task.completed ||= {};
  task.completed[date] = !done;
  task.updatedAt = new Date().toISOString();
  if (saveState() === false) { restoreFailedSave(undo); render(); return false; }
  render();
  showToast(done ? "Задача снова активна" : "Задача выполнена", { undo });
  return true;
}

async function calendarScheduleTask(taskId, sourceDate, targetDate, startTime) {
  const owner = state;
  if (!(await confirmDiscardOpenForms()) || state !== owner) return false;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || !taskOccursOn(task, sourceDate)) return false;
  if (sourceDate === targetDate) {
    activeDate = sourceDate;
    saveUiState();
    const result = await timelineController.setTaskTime(taskId, startTime);
    if (!result) render();
    return result;
  }
  if (task.repeat !== "none") {
    const choice = await confirmAction({ title: "Перенести этот повтор?",
      message: "На другой день будет перенесено только выбранное выполнение. Остальное расписание останется прежним.",
      confirmLabel: "Перенести", secondaryLabel: "Отмена" });
    if (choice !== true || state !== owner) return false;
  }
  const undo = createUndoSnapshot();
  let moved = task;
  window.RhythmTaskMoves.postponeTask({ state, task, sourceDateKey: sourceDate, targetDateKey: targetDate,
    options: { separateOccurrence: true }, helpers: { createId, taskScheduledOn } });
  if (task.repeat !== "none") moved = state.tasks.at(-1);
  const duration = isTimeBlock(task) ? timeToMinutes(task.endTime) - timeToMinutes(task.startTime) : 60;
  const end = Math.min(23 * 60 + 59, timeToMinutes(startTime) + duration);
  Object.assign(moved, { scheduleMode: "block", startTime: minutesToTime(Math.max(0, end - duration)),
    endTime: minutesToTime(end), time: minutesToTime(end), updatedAt: new Date().toISOString() });
  delete moved.notified?.[targetDate];
  if (saveState() === false) { restoreFailedSave(undo); render(); return false; }
  activeDate = targetDate;
  saveUiState();
  render();
  showToast(`Запланировано на ${formatLongDate(targetDate)}`, { undo });
  return true;
}

const timelineView = window.RhythmTimelineView.createTimelineView({
  getStudyEvents,
  openStudyLesson,
  addDays,
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
  postponeTask,
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
  getState: () => state,
  restoreState: restoreFailedSave,
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

const notesView = window.RhythmNotesView.createNotesView({
  createTaskFromNote: (note, text) => {
    const undo = createUndoSnapshot();
    const now = new Date().toISOString();
    const task = normalizeState({ ...state, tasks: [{ id: createId(), title: cleanText(text).slice(0, 240), date: null, repeat: "none", sourceNoteId: note.id, priority: "medium", createdAt: now, updatedAt: now }] }).tasks[0];
    if (!task) return;
    state.tasks.push(task);
    if (saveState() === false) { state.tasks = state.tasks.filter((item) => item.id !== task.id); return; }
    showToast("Задача создана в «Позже»", { undo });
  },
  restoreState: (snapshot) => replaceState(normalizeState(JSON.parse(snapshot.state))),
  getUserId: () => remoteAuth.getSession()?.user?.id || "",
  confirmAction,
  createId,
  createUndoSnapshot,
  els,
  getState: () => state,
  openTask: (task) => openDateTasks(task.date, task.id),
  renderJournal: journalView.render,
  saveState,
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
  getUserId: () => remoteAuth.getSession()?.user?.id || "",
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
  getState: () => state,
  getItems: () => state.boardItems,
  links: window.RhythmBoardLinks,
  model: window.RhythmBoardModel,
  openSource: openBoardSource,
  showToast,
  todayKey: () => toDateKey(new Date()),
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
    if (result.type === "material") studyController.openMaterial(result.id);
    if (result.type === "subject") studyController.openSubject(result.id);
    if (result.type === "goal") goalsView.revealGoal(result.id);
    if (result.view === "tasks") tasksView.setPane(result.date === null ? "later" : "day");
    if (result.type === "note") await notesView.openNote(result.id);
    if (result.type === "journal") await notesView.setMode("journal");
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
    if (result.type === "board") requestAnimationFrame(() => boardView.focusItem(result.id));
    if (result.type === "subject") requestAnimationFrame(() => {
      const row = [...document.querySelectorAll("[data-study-subject-edit]")].find((button) => button.dataset.studySubjectEdit === result.id);
      for (let parent = row?.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
      row?.scrollIntoView({ block: "center" }); row?.focus({ preventScroll: true });
    });
    if (result.type === "task") {
      tasksView.setPane(result.date === null ? "later" : "day");
      requestAnimationFrame(() => {
        if (state.tasks.find((task) => task.id === result.id)?.date === null) {
          const panel = document.querySelector("#laterTaskPanel");
          panel.open = true;
          const row = [...document.querySelector("#laterTaskList").children].find((item) => item.dataset.taskId === result.id);
          row?.scrollIntoView({ block: "center" });
          row?.querySelector("button")?.focus({ preventScroll: true });
          return;
        }
        const row = [...els.taskList.children].find((item) => item.dataset.taskId === result.id);
        if (!row) return;
        if (result.checklistMatch) row.querySelector(".task-checklist")?.setAttribute("open", "");
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
  onRollback: syncDesktopReminders,
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
  getUserId: () => remoteAuth.getSession()?.user?.id || "",
  confirmAction,
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
  afterClose: closeFloatingTaskForm,
  restoreState: (snapshot) => { replaceState(JSON.parse(snapshot.state)); render(); },
  getDefaultCategoryId: () => state.categories.some((category) => category.id === taskCategoryFilter)
    ? taskCategoryFilter : "",
  afterSave: (task) => {
    if (activeView === "tasks") tasksView.setPane(task.date === null ? "later" : "day");
    if (activeView === "tasks" && (
      (taskFilter === "done" && !isTaskDone(task, activeDate)) ||
      (taskFilter === "open" && isTaskDone(task, activeDate)) || !matchesCategoryFilter(task, taskCategoryFilter) ||
      !taskMatchesSearch(task, taskSearchQuery, activeDate)
    )) {
      clearTaskFilters();
      saveUiState();
      renderTasks();
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

const subtaskController = window.RhythmTaskSubtasks.createSubtaskDialog({
  getState: () => state, createId, createUndoSnapshot, saveState, showToast, formatLongDate,
  restoreState: restoreFailedSave,
  render: renderTaskSurfaces,
  today: () => toDateKey(new Date()),
  expandChecklist: (taskId, dateKey) => tasksView.expandChecklist(taskId, dateKey),
});

const habitFormController = window.RhythmHabitForm.createHabitForm({
  applyHabitConfigChange: window.RhythmHabitConfigHistory.applyHabitConfigChange,
  applyHabitTitleChange: window.RhythmHabitTitleHistory.applyHabitTitleChange,
  els,
  cleanText,
  cleanTimeValue,
  createId,
  createUndoSnapshot,
  restoreState: restoreFailedSave,
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
  getUserId: () => remoteAuth.getSession()?.user?.id || "",
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
  applyImportedSettings: (settings) => {
    const previousSettings = getUiSettings();
    applyImportedSettings(settings);
    if (!saveAccountPreferences(profileSettings.preferenceKeys)) {
      applyImportedSettings(previousSettings);
      saveUiState();
      throw new Error("Не удалось сохранить настройки аккаунта");
    }
  },
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
  showToast,
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
  isWorkspaceReady: () => !remoteSyncAccountId || remoteSyncAccountId === remoteAuth.getSession()?.user?.id,
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
  enableNotifications: requestNotifications,
  cleanTimeValue,
  getCategory,
  getNotificationsEnabled: () => notificationSetting === "on",
  getQuietHours: () => quietHours,
  getUserId: () => remoteAuth.getSession()?.user?.id || "",
  getState: () => state,
  habitTitleOnDate: window.RhythmHabitTitleHistory.habitTitleOnDate,
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
  habitStatusOnDate,
  isTaskDone,
  taskDetails,
});

const studyController = window.RhythmStudyController.createStudyController({
  confirmAction,
  createId,
  deleteTask: (id) => taskState.deleteTask(id),
  getAccessToken: async () => (await remoteAuth.ensureFreshSession().catch(() => null))?.access_token || "",
  getState: () => state,
  getActiveDate: () => activeDate,
  setActiveDate: (dateKey) => {
    activeDate = dateKey;
    saveUiState();
    render();
  },
  getUserId: () => remoteAuth.getSession()?.user?.id || "",
  openNote: openLinkedNote,
  openNotesForTask,
  openNotesForSubject,
  render,
  saveState,
  showToast,
});

const viewRenderer = window.RhythmViewRenderer.createViewRenderer({
  renderArchive,
  renderCategories,
  renderDailyPulse,
  renderGoals,
  renderHabits,
  renderJournal: notesView.render,
  renderNutrition: nutritionView.render,
  renderBoard: boardView.render,
  renderMcpActivity: mcpActivityController.render,
  renderOverview,
  renderRemoteSyncStatus,
  renderSettingsBackupStatus,
  renderTasks,
  renderTimeline,
  renderStudy: studyController.render,
  renderWeekdayLabels,
});

const appShellController = window.RhythmAppShellController.createAppShellController({
  scrollActiveViewStart: (view) => view === "timeline" ? timelineView.scrollToRelevantTime({ keepUnscheduledVisible: false }) : false,
  els,
  formatLongDate,
  getActiveDate: () => activeDate,
  getActiveView: () => activeView,
  getOverviewMode: () => overviewMode,
  isMobilePinned: (view) => navigationController.isPinned(view),
  navigationState: window.RhythmNavigationState,
  renderSaveStatus,
  restoreTaskFormPanel,
  saveUiState,
  setActiveView: (value) => { activeView = value; },
  setOverviewMode: (value) => { overviewMode = value; },
  syncTaskTimePresets,
  viewRenderer,
});

const navigationController = window.RhythmNavigationPreferences.createNavigationPreferences({
  els,
  getPreferences: () => navigationPreferences,
  updatePreferences: (value) => updateSetting("navigationPreferences", value),
});

const workspaceGuide = window.RhythmWorkspaceGuide.createWorkspaceGuide({
  applyPreferences: (value) => updateSetting("navigationPreferences", value),
  getPreferences: () => navigationPreferences,
  getState: () => state,
  getUserId: () => remoteAuth.getSession()?.user?.id || "",
  getSupportSnapshot: () => ({
    version: window.RhythmShellVersion,
    schemaVersion: SCHEMA_VERSION,
    desktop: Boolean(window.rhythmDesktop),
    online: navigator.onLine !== false,
    localSaveError: Boolean(localStorageError),
    sync: {
      ...remoteSyncWorkflow.getStatus(),
      enabled: remoteSyncEnabled === "on",
      authenticated: Boolean(remoteAuth.getSession()?.access_token),
      projectConfigured: Boolean(remoteSyncUrl && remoteSyncAnonKey),
      lastPulledAt: remoteSyncLastPulledAt,
      lastPushedAt: remoteSyncLastPushedAt,
    },
  }),
  showToast,
});

const appEvents = window.RhythmAppEvents.createAppEvents({
  confirmDiscardOpenForms,
  hasUnsavedForms: () => [
    [els.taskForm, els.taskFormPanel],
    [els.habitForm, els.habitFormPanel],
    [els.goalForm, els.goalFormPanel],
  ].some(([form, panel]) => !panel.classList.contains("is-collapsed") && isFormDirty(form)) || (activeView === "journal" && notesView.hasUnpersistedChanges()),
  calendarDragController,
  changeOverviewMode: (mode, activeButton) => {
    overviewMode = ["day", "week", "month", "year"].includes(mode) ? mode : "week";
    els.views.overview.dataset.mode = overviewMode;
    document.querySelectorAll("[data-overview-mode]").forEach((item) => {
      item.classList.toggle("is-active", item === activeButton);
    });
    appShellController.syncOverviewMode();
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
    if (taskPane === "later") {
      els.taskForm.querySelector("#taskDeferred").checked = true;
      els.taskForm.querySelector("#taskDeferred").dispatchEvent(new Event("change"));
      markFormPristine(els.taskForm);
    }
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
  document.querySelectorAll("[data-study-layer]").forEach((input) => {
    input.checked = showStudyEvents;
    input.addEventListener("change", () => {
      showStudyEvents = input.checked;
      document.querySelectorAll("[data-study-layer]").forEach((item) => { item.checked = showStudyEvents; });
      saveUiState(); render();
    });
  });
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
  notesView.bindEvents();
  goalsView.bindEvents();
  nutritionView.bindEvents();
  boardView.bindEvents();
  googleCalendarController.bindEvents();
  studyController.bindEvents();
  globalSearch.bindEvents();
  notificationsController.bindEvents();
  appEvents.bind();
  workspaceGuide.bindEvents();
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
  if (window.RhythmGoalActivity.reconcileGoalStatuses(state, { todayKey: toDateKey(new Date()), habitStatusOnDate })) {
    saveState({ skipBackup: true });
  }
  render();
  scrollWorkspaceTop();
  if (initialStateLoad.status === "recovered") showToast("Повреждённые локальные данные восстановлены из резервной копии");
  if (initialStateLoad.status === "recovered-memory") showToast("Копия восстановлена только в памяти. Экспортируй данные");
  if (initialStateLoad.status === "corrupt") showToast("Локальные данные повреждены. Восстанови копию или загрузи данные из облака");
  try {
    await initializeHostedConfig();
  } catch {
    showToast("Не удалось подключить облако. Локальные данные доступны; проверь подключение в настройках");
  }
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
    await studyController.initialize();
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
  await studyController.initialize();
}

async function synchronizeAuthenticatedAccount() {
  const session = remoteAuth.getSession();
  const userId = cleanText(session?.user?.id || "");
  if (!userId) return;
  const generation = ++authenticatedSyncGeneration;
  const isCurrent = () => generation === authenticatedSyncGeneration && remoteAuth.getSession()?.user?.id === userId;
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
    if (!isCurrent()) return;
    const previous = state;
    replaceState(pulled.found && pulled.state ? pulled.state : null);
    if (saveState({ skipBackup: true, skipChangeTracking: true, skipRemote: true }) === false) {
      replaceState(previous);
      render();
      throw new Error("Не удалось сохранить данные выбранного аккаунта");
    }
    notesView.resetForState();
    applyAccountPreferences(true);
    remoteSyncLastPulledAt = pulled.updatedAt || pulled.clientUpdatedAt || "";
    remoteSyncLastPushedAt = "";
    remoteSyncPending = false;
    render();
    showToast("Загружены данные выбранного аккаунта");
  }
  remoteSyncAccountId = userId;
  saveUiState();
  settingsController.syncControls();
  renderRemoteSyncStatus();
  await remoteSyncWorkflow.syncLatest({ silent: true });
  if (!isCurrent()) return;
  migrateAccountPreferences();
  await remoteSyncWorkflow.push({ silent: true });
  if (!isCurrent()) return;
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
  applyAccountPreferences();
  appShellController.render();
  workspaceGuide.render();
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
    remoteLastPushedAt: latestIsoDate(remoteSyncLastPushedAt, remoteSyncLastPulledAt),
    syncStatus: remoteSyncWorkflow.getStatus(),
  });
}

function renderTaskSurfaces() {
  viewRenderer.render(activeView);
  workspaceGuide.render();
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
  return commitTaskChange("Повтор исключен на выбранный день", undo);
}

function acknowledgeOverdueTask(task, dateKey) {
  const undo = createUndoSnapshot();
  task.acknowledgedOverdue = task.acknowledgedOverdue || {};
  task.acknowledgedOverdue[dateKey] = true;
  task.updatedAt = new Date().toISOString();
  return commitTaskChange("Скрыта из просроченных · задача остаётся невыполненной", undo);
}

function acknowledgeAllOverdueTasks(entries) {
  if (!entries.length) return;
  const undo = createUndoSnapshot();
  entries.forEach(({ task, dateKey }) => {
    task.acknowledgedOverdue = task.acknowledgedOverdue || {};
    task.acknowledgedOverdue[dateKey] = true;
    task.updatedAt = new Date().toISOString();
  });
  return commitTaskChange(`Скрыто из просроченных: ${entries.length} · отметки выполнения не изменены`, undo);
}

function restoreOverdueTask(task, dateKey) {
  if (!task.acknowledgedOverdue?.[dateKey]) return;
  const undo = createUndoSnapshot();
  delete task.acknowledgedOverdue[dateKey];
  task.updatedAt = new Date().toISOString();
  return commitTaskChange("Задача снова появится в просроченных на следующем дне", undo);
}

function restoreTaskDate(task, dateKey) {
  const undo = createUndoSnapshot();
  if (task.excludedDates) {
    delete task.excludedDates[dateKey];
  }
  task.updatedAt = new Date().toISOString();
  return commitTaskChange(`Повтор возвращен на ${formatLongDate(dateKey)}`, undo);
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
  return commitTaskChange(`Повтор завершен с ${formatLongDate(dateKey)}`, undo);
}

function commitTaskChange(message, undo, toastOptions = {}) {
  if (saveState() === false) {
    restoreFailedSave(undo);
    render();
    return false;
  }
  render();
  showToast(message, { ...toastOptions, undo });
  return true;
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
  tasksView.setPane(dateKey === null ? "later" : "day");
  if (taskId) clearTaskFilters();
  activeDate = normalizeDateKey(dateKey, activeDate);
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

async function openLinkedHabit(habit) {
  if (!(await confirmDiscardOpenForms())) return;
  activeView = "habits";
  saveUiState();
  syncNavigationRoute();
  render();
  scrollWorkspaceTop();
  requestAnimationFrame(() => {
    const row = [...els.habitList.children].find((item) => item.dataset.habitId === habit.id);
    row?.scrollIntoView({ block: "center" });
    row?.querySelector("button, input")?.focus({ preventScroll: true });
  });
}

function getStudyEvents(dateKey) {
  return showStudyEvents ? window.RhythmStudyModel.eventsForDate(state, dateKey) : [];
}

async function openStudyLesson(lessonId, dateKey) {
  if (!(await confirmDiscardOpenForms())) return;
  activeDate = dateKey;
  activeView = "study";
  studyController.setTab("schedule");
  saveUiState(); syncNavigationRoute(); render();
  requestAnimationFrame(() => {
    const button = [...document.querySelectorAll("[data-study-lesson-edit]")].find((item) => item.dataset.studyLessonEdit === lessonId);
    button?.scrollIntoView({ block: "center" }); button?.focus({ preventScroll: true });
  });
}

async function openLinkedNote(noteId) {
  if (!(await confirmDiscardOpenForms())) return;
  if (!(await notesView.openNote(noteId))) return;
  activeView = "journal";
  saveUiState();
  syncNavigationRoute();
  render();
  scrollWorkspaceTop();
}

function notesForTask(taskId) {
  const sourceId = state.tasks.find((task) => task.id === taskId)?.sourceNoteId;
  return (state.notes || []).filter((note) => note.taskId === taskId || note.id === sourceId);
}

async function openNotesForTask(taskId) {
  const notes = notesForTask(taskId);
  if (notes.length === 1) return openLinkedNote(notes[0].id);
  if (!notes.length) return;
  const dialog = document.createElement("dialog"); dialog.className = "workspace-edit-dialog";
  const heading = document.createElement("h3"); heading.textContent = "Связанные заметки"; dialog.append(heading);
  notes.forEach((note) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "notes-list-item"; button.textContent = note.title;
    button.onclick = () => { dialog.close(); openLinkedNote(note.id); }; dialog.append(button);
  });
  const close = document.createElement("button"); close.type = "button"; close.className = "ghost-button"; close.textContent = "Закрыть"; close.onclick = () => dialog.close(); dialog.append(close);
  dialog.addEventListener("close", () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
}

async function openBoardSource(type, id) {
  if (type === "task") {
    const task = state.tasks.find((item) => item.id === id);
    if (task) await openDateTasks(task.date, task.id);
    return;
  }
  if (type === "note") {
    await openLinkedNote(id);
    return;
  }
  if (!(await confirmDiscardOpenForms())) return;
  if (type === "material") {
    if (!state.studyFiles.some((item) => item.id === id)) return;
    studyController.openMaterial(id);
    activeView = "study";
  } else if (type === "subject") {
    if (!state.studySubjects.some((item) => item.id === id)) return;
    studyController.openSubject(id);
    activeView = "study";
  } else if (type === "goal") {
    if (!state.goals.some((item) => item.id === id)) return;
    goalsView.revealGoal(id);
    activeView = "goals";
  } else return;
  saveUiState();
  syncNavigationRoute();
  render();
  scrollWorkspaceTop();
  if (type === "goal") requestAnimationFrame(() => {
    const row = [...els.goalList.children].find((item) => item.dataset.goalId === id);
    row?.scrollIntoView({ block: "center" });
  });
  if (type === "subject" || type === "material") requestAnimationFrame(() => {
    const list = document.querySelector(type === "subject" ? "#studySubjectList" : "#studyMaterialList");
    const field = type === "subject" ? "studySubjectId" : "studyFileId";
    const row = [...(list?.children || [])].find((item) => item.dataset[field] === id);
    for (let parent = row?.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS") parent.open = true;
    }
    row?.scrollIntoView({ block: "center" });
    row?.querySelector("a, button")?.focus({ preventScroll: true });
  });
}

async function openNotesForSubject(subjectId = "all") {
  if (!(await confirmDiscardOpenForms())) return;
  notesView.setSubjectFilter(subjectId);
  activeView = "journal";
  saveUiState();
  syncNavigationRoute();
  render();
  scrollWorkspaceTop();
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
      secondaryLabel: "Перенести только этот день",
      confirmLabel: "Перенести этот и последующие",
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

  return commitTaskChange(`Задача перенесена на ${formatLongDate(targetDate)}`, undo, {
    action: { label: "Открыть день", onClick: () => openDateTasks(targetDate) },
  });
}

function renderHabits() {
  habitsView.renderHabits();
}

async function chooseRepeatMoveStrategy(entries, targetDateKey) {
  const groups = window.RhythmTaskMoves.recurringBacklogGroups({ state, entries, targetDateKey, helpers: { taskScheduledOn, toDateKey } });
  if (!groups.size) return "each";
  const userId = remoteAuth.getSession()?.user?.id || "";
  const snapshot = state;
  const count = [...groups.values()].reduce((total, group) => total + group.length, 0);
  const choice = await confirmAction({ title: "Как перенести пропущенные повторы?",
    message: `Выбрано пропусков повторяющихся задач: ${count}. «Каждый отдельно» перенесёт каждое выполнение отдельной карточкой ${targetDateKey ? `на ${formatLongDate(targetDateKey)}` : "в Позже"}. «Одно на задачу» оставит одно актуальное действие для каждой серии; остальные выбранные пропуски сохранятся в истории как невыполненные. Обычные задачи будут перенесены без объединения.`,
    secondaryLabel: "Одно на задачу", confirmLabel: "Каждый отдельно" });
  if (!choice || state !== snapshot || (remoteAuth.getSession()?.user?.id || "") !== userId) return null;
  return choice === "secondary" ? "single" : "each";
}

async function moveSelectedTasks(entries, targetDateKey) {
  const targetDate = normalizeDateKey(targetDateKey, "");
  if (!targetDate) return false;
  const recurringMode = await chooseRepeatMoveStrategy(entries, targetDate);
  if (!recurringMode) return false;
  const undo = createUndoSnapshot();
  const result = window.RhythmTaskMoves.moveTasksToDate({
    state, entries, targetDateKey: targetDate, recurringMode,
    helpers: { cleanTimeValue, createId, taskScheduledOn, toDateKey },
  });
  if (!result.moved) {
    showToast("Выбранные задачи уже на этой дате");
    return true;
  }
  if (saveState() === false) {
    replaceState(JSON.parse(undo.state));
    render();
    return false;
  }
  render();
  showToast(result.consolidated ? `Повторы разобраны: ${result.moved} · по одному действию на серию` : `Перенесено задач: ${result.moved}${result.skipped ? ` · без изменений: ${result.skipped}` : ""}`, {
    undo, action: { label: "Открыть день", onClick: () => openDateTasks(targetDate) },
  });
  return true;
}

async function deferSelectedTasks(entries) {
  const recurringMode = await chooseRepeatMoveStrategy(entries, null);
  if (!recurringMode) return false;
  const undo = createUndoSnapshot();
  const result = window.RhythmTaskMoves.moveTasksToLater({ state, entries, recurringMode, helpers: { createId, taskScheduledOn, toDateKey } });
  if (!result.moved) { showToast("Выполненные и уже отложенные задачи не изменены"); return false; }
  if (saveState() === false) { replaceState(JSON.parse(undo.state)); render(); return false; }
  render(); showToast(result.consolidated ? "В Позже: по одному действию на серию" : `В Позже: ${result.moved}`, { undo });
  return true;
}

async function dismissSelectedTasks(entries) {
  const dated = entries.filter((entry) => entry.dateKey);
  if (!dated.length) { showToast("У отложенных задач ещё нет даты выполнения"); return false; }
  if (!await confirmAction({ title: "Убрать из незавершённых?",
    message: "Выбранные дни больше не появятся в этом списке. Задачи останутся в своей дате без отметки выполнения; будущие повторы не изменятся.", confirmLabel: "Не выполнять" })) return false;
  const undo = createUndoSnapshot();
  dated.forEach(({ taskId, dateKey }) => {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    task.acknowledgedOverdue ||= {}; task.acknowledgedOverdue[dateKey] = true; task.updatedAt = new Date().toISOString();
  });
  if (saveState() === false) { replaceState(JSON.parse(undo.state)); render(); return false; }
  render(); showToast(`Убрано из незавершённых: ${dated.length}`, { undo });
  return true;
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
  activeView = "tasks";
  if (taskPane === "later") Object.assign(task, { date: null, time: "", scheduleMode: "none", startTime: "", endTime: "", reminderOffset: "none" });
  if (taskPane === "backlog") tasksView.setPane("day");
  if (taskFilter === "done" || !matchesCategoryFilter(task, taskCategoryFilter) ||
    !taskMatchesSearch(task, taskSearchQuery, activeDate)) clearTaskFilters();
  saveUiState();
  syncNavigationRoute();
  if (saveState() === false) {
    restoreFailedSave(undo);
    render();
    return;
  }
  els.quickTaskInput.value = "";
  updateQuickTaskPreview();
  resetTaskForm({ open: false });
  render();
  showToast(task.date ? `Добавлено на ${formatLongDate(task.date)}: ${task.title}` : `Добавлено в Позже: ${task.title}`, {
    undo,
    ...(task.date && task.date !== activeDate ? { action: { label: "Открыть день", onClick: () => openDateTasks(task.date) } } : {}),
  });
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
    taskPane === "later" ? "Позже · без даты" : formatLongDate(parsed.date),
    taskPane === "later" ? "" : parsed.scheduleMode === "block" ? formatTaskWindow(parsed) : parsed.time ? formatTaskTime(parsed.time) : "",
    category,
    parsed.priority !== "medium" ? priorityLabels[parsed.priority] : "",
  ].filter(Boolean);

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
  document.querySelector("#habitWeeklyTargetField").hidden = els.habitRepeat.value !== "weeklyGoal";
  document.querySelector("#habitGoalLabel").textContent = els.habitRepeat.value === "weeklyGoal" ? "Цель за выполнение" : "Цель в день";
  if (isCustom) updateHabitCustomRepeatSummary();
}

function syncHabitTypeFields() {
  const isNumber = els.habitType.value === "number";
  if (els.habitNumericFields) els.habitNumericFields.hidden = !isNumber;
  els.habitUnit.disabled = !isNumber;
  els.habitGoal.disabled = !isNumber;
  els.habitForm.querySelector("#habitNumberStep").disabled = !isNumber;
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
  if (["timeline", "overview"].includes(activeView)) openFloatingTaskForm();
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
  const values = [...form.querySelectorAll("input, select, textarea")].filter((control) => !control.classList.contains("goal-link-control") && !control.classList.contains("goal-link-search")).map((control) => [
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
  const hasDirtyNote = activeView === "journal" && notesView.isDirty();
  if (hasDirtyNote && !(await notesView.confirmDiscard())) return false;
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
  return window.RhythmHabitSchedule.occursOn(habit, dateKey);
}

function isTaskDone(task, dateKey) {
  return task.completed?.[dateKey] === true;
}

function isHabitComplete(habit, dateKey) {
  const effective = habitConfigOnDate(habit, dateKey);
  return window.RhythmHabitFreeze.isComplete(habit, dateKey, effective);
}

function habitStatusOnDate(habit, dateKey) {
  return window.RhythmHabitSchedule.statusOnDate(habit, dateKey);
}

function habitConfigOnDate(habit, dateKey) {
  return window.RhythmHabitConfigHistory.habitConfigOnDate(habit, dateKey, {
    normalizeCustomRepeat: window.RhythmRecurrence.normalizeCustomRepeat,
    normalizeRepeat: normalizeHabitRepeat,
  });
}

function habitStreak(habit, dateKey = toDateKey(new Date())) {
  return window.RhythmHabitSchedule.streak(habit, dateKey, toDateKey(new Date()));
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
  const subject = state.studySubjects.find((item) => item.id === task.studySubjectId);
  if (taskHasSchedule(task)) details.push(formatTaskScheduleLabel(task));
  if (subject) details.push(subject.name);
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
  const subject = state.studySubjects.find((item) => item.id === task.studySubjectId);
  const haystack = [
    task.title,
    category?.name,
    subject?.name,
    task.studyDetails,
    ...(task.checklist || []).map((item) => item.title),
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
  const subject = state.studySubjects.find((item) => item.id === task.studySubjectId);
  const items = [];

  if (subject) items.push({ categoryColor: subject.color, label: subject.name, type: "study" });

  if (category) {
    items.push({
      categoryColor: category.color,
      label: category.name,
      type: "category",
    });
  }

  if (taskHasSchedule(task)) items.push({ label: formatTaskScheduleLabel(task), type: "schedule" });
  if (task.dueDate) items.push({ label: `Сдать ${formatShortDate(task.dueDate)}${task.dueTime ? `, ${formatTime(task.dueTime)}` : ""}`, type: "due" });
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
  return documentState.normalizeHabitRepeat(value);
}

function formatHabitRepeat(habit) {
  if (habit.repeat === "weeklyGoal") {
    const count = habit.weeklyTarget || 3;
    return `${count} ${count === 1 ? "раз" : count < 5 ? "раза" : "раз"} в неделю`;
  }
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
  const habitDone = habits.filter((habit) => habitStatusOnDate(habit, dateKey) === "complete").length;
  const habitFrozen = habits.filter((habit) => habitStatusOnDate(habit, dateKey) === "frozen").length;
  const taskTotal = tasks.length;
  const habitTotal = habits.filter((habit) => ["complete", "missed"].includes(habitStatusOnDate(habit, dateKey))).length;
  const habitFlexibleDone = habits.filter((habit) => habitConfigOnDate(habit, dateKey).repeat === "weeklyGoal" && isHabitComplete(habit, dateKey)).length;
  return {
    habitDone,
    habitFrozen,
    habitPercent: habitTotal ? Math.round((habitDone / habitTotal) * 100) : 0,
    habitTotal,
    habitFlexibleDone,
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
  if (activeView === "overview" && overviewMode === "month") return shiftMonth(days);
  if (activeView === "overview" && overviewMode === "week") days *= 7;
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
      navigationPreferences,
      quietHours,
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
      taskPane,
      showStudyEvents,
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
  window.RhythmAccentColors.apply(document.documentElement, accentPreference, resolvedTheme);
  if (els.themePreference) els.themePreference.value = themePreference;
}

function applySettingsPreferences() {
  document.documentElement.dataset.accent = accentPreference;
  window.RhythmAccentColors.apply(document.documentElement, accentPreference, document.documentElement.dataset.theme);
  document.documentElement.dataset.density = densityPreference;
  navigationController.apply();
  navigationController.renderControls();
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
    navigationPreferences,
    quietHours,
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
  const previousSettings = getUiSettings();
  const result = updateDeviceSetting(name, value);
  if (result === false || !profileSettings.preferenceKeys.includes(name)) return result;
  if (!saveAccountPreferences([name])) {
    applyImportedSettings(previousSettings);
    saveUiState();
    return false;
  }
  return result;
}

function saveAccountPreferences(keys, stamp = new Date().toISOString()) {
  const previous = state.profile;
  const preferences = profileSettings.normalizePreferences(state.profile?.preferences);
  const settings = getUiSettings();
  for (const key of keys) preferences[key] = { value: settings[key], updatedAt: stamp };
  state.profile = { ...state.profile, preferences };
  if (saveState() === false) { state.profile = previous; return false; }
  appliedAccountPreferences = JSON.stringify(preferences);
  return true;
}

function migrateAccountPreferences() {
  const preferences = profileSettings.normalizePreferences(state.profile?.preferences);
  const missing = profileSettings.preferenceKeys.filter((key) => !preferences[key]);
  // Legacy device settings are a baseline, never newer than an explicit account edit.
  if (missing.length) saveAccountPreferences(missing, "1970-01-01T00:00:00.000Z");
}

function applyAccountPreferences(reset = false) {
  const preferences = profileSettings.normalizePreferences(state.profile?.preferences);
  const signature = JSON.stringify(preferences);
  if (!reset && signature === appliedAccountPreferences) return;
  appliedAccountPreferences = signature;
  const values = Object.fromEntries(Object.entries(preferences).map(([key, entry]) => [key, entry.value]));
  const defaults = reset ? settingsState.normalizeImportedSettings() : {};
  const accountDefaults = Object.fromEntries(profileSettings.preferenceKeys.filter((key) => key in defaults).map((key) => [key, defaults[key]]));
  applyImportedSettings({ ...getUiSettings(), ...accountDefaults, ...values });
  saveUiState();
}

function updateDeviceSetting(name, value) {
  switch (name) {
    case "navigationPreferences": {
      const previous = navigationPreferences;
      navigationPreferences = window.RhythmNavigationPreferences.normalize(value);
      if (!saveUiState()) {
        navigationPreferences = previous;
        navigationController.renderControls();
        showToast("Не удалось сохранить настройки навигации");
        return false;
      }
      navigationController.apply();
      navigationController.renderControls();
      render();
      return true;
    }
    case "quietHours":
      quietHours = window.RhythmReminderPolicy.normalizeQuietHours(value);
      saveUiState();
      settingsController.syncControls();
      syncDesktopReminders();
      notificationsController.renderCenter();
      break;
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
      showToast(backupSchedule === "0" ? "Резервное копирование по расписанию выключено" : "Расписание резервного копирования обновлено");
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
  const previousSettings = getUiSettings();
  themePreference = "dark";
  accentPreference = "emerald";
  densityPreference = "comfortable";
  timeFormat = "24";
  firstDayOfWeek = "monday";
  navigationPreferences = window.RhythmNavigationPreferences.normalize();
  if (!saveAccountPreferences(["themePreference", "accentPreference", "densityPreference", "timeFormat", "firstDayOfWeek", "navigationPreferences"])) {
    applyImportedSettings(previousSettings);
    saveUiState();
    return;
  }
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
  navigationPreferences = normalized.navigationPreferences;
  quietHours = normalized.quietHours;
  backupSchedule = normalized.backupSchedule;
  firstDayOfWeek = normalized.firstDayOfWeek;
  densityPreference = normalized.densityPreference;
  timeFormat = normalized.timeFormat;
  remoteSyncWorkflow.clearError();
  applyThemePreference();
  applySettingsPreferences();
  renderWeekdayLabels();
  scheduleAutoBackup();
  settingsController.syncControls();
  renderRemoteSyncStatus();
  updateNotificationButton();
  syncDesktopReminders();
}

function renderSettingsBackupStatus() {
  if (!els.settingsBackupStatus) return;
  if (backupSchedule === "0") {
    els.settingsBackupStatus.textContent = "Резервное копирование по расписанию выключено";
    return;
  }
  const last = lastAutoBackupAt ? formatBackupDate(lastAutoBackupAt) : "еще не запускался";
  const next = nextAutoBackupAt ? formatBackupDate(nextAutoBackupAt) : "ожидает расписание";
  els.settingsBackupStatus.textContent = `Последняя резервная копия: ${last} · следующая: ${next}`;
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

function normalizeState(raw) {
  return documentState.normalizeState(raw);
}

function replaceState(nextState) {
  state = stateController.replaceState(nextState);
  window.RhythmGoalActivity.reconcileGoalStatuses(state, { todayKey: toDateKey(new Date()), habitStatusOnDate });
}

function saveState(options = {}) {
  window.RhythmGoalActivity.reconcileGoalStatuses(state, { todayKey: toDateKey(new Date()), habitStatusOnDate });
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

function restoreFailedSave(snapshot) {
  replaceState(JSON.parse(snapshot.state));
  syncDesktopReminders();
}

function restoreUndoSnapshot(snapshot) {
  if (!snapshot?.state) return;
  const previous = createUndoSnapshot();
  let saved = false;
  const rollback = () => {
    restoreFailedSave(previous);
    activeDate = previous.activeDate;
    activeView = previous.activeView;
    render();
  };
  try {
    replaceState(JSON.parse(snapshot.state));
    activeDate = normalizeDateKey(snapshot.activeDate, toDateKey(new Date()));
    activeView = snapshot.activeView || "tasks";
    if (saveState() === false) {
      rollback();
      return;
    }
    saved = true;
    resetTaskForm({ open: false });
    render();
    showToast("Действие отменено");
  } catch {
    if (!saved) rollback();
    showToast("Не удалось отменить действие");
  }
}

function showToast(message, options = {}) {
  toastController.showToast(message, options);
}

function confirmAction(options = {}) {
  return confirmDialog.confirm(options);
}
