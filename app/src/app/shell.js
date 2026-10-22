// Notifications, study, view rendering, navigation and DOM event wiring.

import * as navigationStateModule from "../core/navigation-state.js";
import * as navigationPreferencesModule from "../settings/navigation-preferences.js";
import * as habitTitleHistory from "../habits/habit-title-history.js";
import * as notifications from "../platform/notifications.js";
import * as dailyPulse from "../core/daily-pulse.js";
import * as studyControllerModule from "../study/study-controller.js";
import * as viewRendererModule from "../core/view-renderer.js";
import * as appShellControllerModule from "../core/app-shell-controller.js";
import * as workspaceGuideModule from "../settings/workspace-guide.js";
import { shellVersion } from "../platform/shell-version.js";
import * as appEventsModule from "../core/app-events.js";
import { app } from "./store.js";
import { els } from "./dom.js";
import { boardView, nutritionView } from "./editors.js";
import { closeFloatingTaskForm, closeFormWithConfirmation, confirmDiscardOpenForms, exportData, importData, isFormDirty, markFormPristine, resetHabitForm, resetTaskForm, restoreTaskFormPanel, saveCategoryFromForm, saveHabitFromForm, saveQuickTask, setCustomRepeatMode, setHabitCustomRepeatMode, syncCustomRepeatPanel, syncHabitCustomRepeatPanel, syncHabitTypeFields, updateCustomRepeatSummary, updateHabitCustomRepeatSummary, updateQuickTaskPreview } from "./forms.js";
import { goToday, handleNavigationChange, render, renderDailyPulse, renderSaveStatus, renderTasks, renderTimeline, scrollWorkspaceTop, shiftDate, shiftMonth, syncNavigationRoute } from "./lifecycle.js";
import { confirmAction, renderWeekdayLabels, restoreBackup, saveState, showToast } from "./persistence.js";
import { openBackupFolder, requestNotifications } from "./platform.js";
import { cleanSearchQuery, getCategory, getOrderedTasksForDate, habitStatusOnDate, habitsForDate, isHabitComplete, isTaskDone, taskDetails, taskOccursOn, tasksForDate } from "./queries.js";
import { calendarDragController, remoteAuth, syncTaskScheduleMode, syncTaskTimePresets, taskScheduleController } from "./services.js";
import { applyThemePreference, renderRemoteSyncStatus, renderSettingsBackupStatus, saveUiState, updateSetting } from "./settings.js";
import { SCHEMA_VERSION, cleanTimeValue, createId, formatLongDate, parseDate, storage, taskState, toDateKey } from "./state.js";
import { mcpActivityController, remoteSyncWorkflow, settingsController } from "./sync.js";
import { openLinkedNote, openNotesForSubject, openNotesForTask, renderArchive, renderCategories, renderGoals, renderHabits, renderOverview, resetGoalForm, saveGoalFromForm, saveTaskFromForm } from "./task-actions.js";
import { archiveView, notesView, timelineView } from "./views.js";

export let notificationsController, dailyPulseController, studyController, viewRenderer, appShellController, navigationController, workspaceGuide, appEvents;

export function wireShell() {
  notificationsController = notifications.createNotifications({
    els,
    enableNotifications: requestNotifications,
    cleanTimeValue,
    getCategory,
    getNotificationsEnabled: () => app.notificationSetting === "on",
    getQuietHours: () => app.quietHours,
    getUserId: () => remoteAuth.getSession()?.user?.id || "",
    getState: () => app.state,
    habitTitleOnDate: habitTitleHistory.habitTitleOnDate,
    isTaskDone,
    parseDate,
    saveState,
    showToast,
    taskOccursOn,
    tasksForDate,
    toDateKey,
  });

  dailyPulseController = dailyPulse.createDailyPulse({
    els,
    getHabits: habitsForDate,
    getTasks: getOrderedTasksForDate,
    isHabitComplete,
    habitStatusOnDate,
    isTaskDone,
    taskDetails,
  });

  studyController = studyControllerModule.createStudyController({
    confirmAction,
    createId,
    deleteTask: (id) => taskState.deleteTask(id),
    getAccessToken: async () => (await remoteAuth.ensureFreshSession().catch(() => null))?.access_token || "",
    getState: () => app.state,
    getActiveDate: () => app.activeDate,
    setActiveDate: (dateKey) => {
      app.activeDate = dateKey;
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

  viewRenderer = viewRendererModule.createViewRenderer({
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

  appShellController = appShellControllerModule.createAppShellController({
    scrollActiveViewStart: (view) => view === "timeline" ? timelineView.scrollToRelevantTime({ keepUnscheduledVisible: false }) : false,
    els,
    formatLongDate,
    getActiveDate: () => app.activeDate,
    getActiveView: () => app.activeView,
    getOverviewMode: () => app.overviewMode,
    isMobilePinned: (view) => navigationController.isPinned(view),
    navigationState: navigationStateModule,
    renderSaveStatus,
    restoreTaskFormPanel,
    saveUiState,
    setActiveView: (value) => { app.activeView = value; },
    setOverviewMode: (value) => { app.overviewMode = value; },
    syncTaskTimePresets,
    viewRenderer,
  });

  navigationController = navigationPreferencesModule.createNavigationPreferences({
    els,
    getPreferences: () => app.navigationPreferences,
    updatePreferences: (value) => updateSetting("navigationPreferences", value),
  });

  workspaceGuide = workspaceGuideModule.createWorkspaceGuide({
    applyPreferences: (value) => updateSetting("navigationPreferences", value),
    getPreferences: () => app.navigationPreferences,
    getState: () => app.state,
    getUserId: () => remoteAuth.getSession()?.user?.id || "",
    getSupportSnapshot: () => ({
      version: shellVersion,
      schemaVersion: SCHEMA_VERSION,
      desktop: Boolean(window.rhythmDesktop),
      online: navigator.onLine !== false,
      localSaveError: Boolean(app.localStorageError),
      storage: storage.getDiagnostics(),
      sync: {
        ...remoteSyncWorkflow.getStatus(),
        enabled: app.remoteSyncEnabled === "on",
        authenticated: Boolean(remoteAuth.getSession()?.access_token),
        projectConfigured: Boolean(app.remoteSyncUrl && app.remoteSyncAnonKey),
        lastPulledAt: app.remoteSyncLastPulledAt,
        lastPushedAt: app.remoteSyncLastPushedAt,
      },
    }),
    showToast,
  });

  appEvents = appEventsModule.createAppEvents({
    confirmDiscardOpenForms,
    hasUnsavedForms: () => [
      [els.taskForm, els.taskFormPanel],
      [els.habitForm, els.habitFormPanel],
      [els.goalForm, els.goalFormPanel],
    ].some(([form, panel]) => !panel.classList.contains("is-collapsed") && isFormDirty(form)) || (app.activeView === "journal" && notesView.hasUnpersistedChanges()),
    calendarDragController,
    changeOverviewMode: (mode, activeButton) => {
      app.overviewMode = ["day", "week", "month", "year"].includes(mode) ? mode : "week";
      els.views.overview.dataset.mode = app.overviewMode;
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
        els.activeDate.value = app.activeDate;
        return;
      }
      app.activeDate = value || toDateKey(new Date());
      saveUiState();
      resetTaskForm({ open: false });
      resetHabitForm({ open: false });
      render();
    },
    changeArchiveCategoryFilter: (value) => {
      app.archiveCategoryFilter = value || "all";
      saveUiState();
      renderArchive();
    },
    changeArchiveSearch: (value) => {
      app.archiveSearchQuery = cleanSearchQuery(value);
      saveUiState();
      renderArchive();
    },
    changeTaskCategoryFilter: (value) => {
      app.taskCategoryFilter = value || "all";
      saveUiState();
      renderTasks();
    },
    changeTaskFilter: (value, activeButton) => {
      app.taskFilter = value;
      document.querySelectorAll("[data-task-filter]").forEach((item) => item.classList.toggle("is-active", item === activeButton));
      saveUiState();
      renderTasks();
    },
    changeTaskSearch: (value) => {
      app.taskSearchQuery = cleanSearchQuery(value);
      saveUiState();
      renderTasks();
    },
    changeView: (nextView) => {
      if (!nextView || !els.views[nextView]) return;
      app.activeView = nextView;
      saveUiState();
      syncNavigationRoute();
      els.navMore?.removeAttribute("open");
      render();
      scrollWorkspaceTop();
    },
    clearArchiveFilter: () => {
      app.archiveSearchQuery = "";
      app.archiveCategoryFilter = "all";
      els.archiveSearch.value = "";
      els.archiveCategoryFilter.value = "all";
      archiveView.setPeriod("all");
      saveUiState();
      renderArchive();
    },
    clearTaskSearch: () => {
      app.taskFilter = "all";
      app.taskCategoryFilter = "all";
      app.taskSearchQuery = "";
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
      if (app.themePreference === "system") applyThemePreference();
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
      if (app.taskPane === "later") {
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
}
