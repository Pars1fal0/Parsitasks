// Startup, rendering and date navigation.

import * as syncMetadata from "../sync/sync-metadata.js";
import * as goalActivity from "../goals/goal-activity.js";
import * as hostedConfig from "../auth/hosted-config.js";
import * as dateRollover from "../core/date-rollover.js";
import { app } from "./store.js";
import { els } from "./dom.js";
import { boardView, globalSearch, nutritionView } from "./editors.js";
import { confirmDiscardOpenForms, resetHabitForm, resetTaskForm } from "./forms.js";
import { createImportSafetyBackup, createUndoSnapshot, normalizeState, replaceState, saveState, scheduleAutoBackup, showToast, updateBackupStatus } from "./persistence.js";
import { checkDueNotifications, syncDesktopReminders, updateFileBackupStatus, updateNotificationButton } from "./platform.js";
import { habitStatusOnDate } from "./queries.js";
import { confirmDialog, googleCalendarController, pwaController, remoteAuth, remoteSync, saveStatusView } from "./services.js";
import { applyAccountPreferences, applySettingsPreferences, applyThemePreference, latestIsoDate, migrateAccountPreferences, renderRemoteSyncStatus, renderSettingsBackupStatus, saveUiState, scheduleRemotePush } from "./settings.js";
import { appEvents, appShellController, dailyPulseController, notificationsController, studyController, viewRenderer, workspaceGuide } from "./shell.js";
import { cleanText, initialStateLoad, parseDate, stateController, storage, todayKey, toDateKey } from "./state.js";
import { deviceSyncController, remoteAuthController, remoteDataController, remoteSyncWorkflow, settingsController } from "./sync.js";
import { renderGoals, resetGoalForm } from "./task-actions.js";
import { goalsView, journalView, notesView, tasksView, timelineView } from "./views.js";

export async function init() {
  window.addEventListener("storage", (event) => {
    if (event.key !== storage.keys.state || !event.newValue) return;
    try {
      const incoming = JSON.parse(event.newValue);
      const owner = incoming._localOwner ?? storage.getOwner();
      if (owner !== (remoteAuth.getSession()?.user?.id || app.remoteSyncAccountId || "")) {
        app.localStorageError = "В другой вкладке сменился аккаунт · обнови эту страницу";
        renderSaveStatus();
        return;
      }
      delete incoming._localOwner;
      app.state = stateController.receiveExternal(incoming);
      // Repair a simultaneous write without starting a storage-event loop.
      if (!syncMetadata.sameValue(app.state, normalizeState(storage.loadState()))) {
        if (saveState({ skipChangeTracking: true, skipBackup: true })) scheduleRemotePush();
      }
      applyAccountPreferences();
      render();
      syncDesktopReminders();
    } catch (error) {
      console.warn("Could not reconcile another tab", error);
    }
  });
  document.querySelectorAll("[data-study-layer]").forEach((input) => {
    input.checked = app.showStudyEvents;
    input.addEventListener("change", () => {
      app.showStudyEvents = input.checked;
      document.querySelectorAll("[data-study-layer]").forEach((item) => { item.checked = app.showStudyEvents; });
      saveUiState(); render();
    });
  });
  els.activeDate.value = app.activeDate;
  els.taskSearch.value = app.taskSearchQuery;
  els.archiveSearch.value = app.archiveSearchQuery;
  els.views.overview.dataset.mode = app.overviewMode;
  document.querySelectorAll("[data-overview-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.overviewMode === app.overviewMode);
  });
  document.querySelectorAll("[data-task-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.taskFilter === app.taskFilter);
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
  if (goalActivity.reconcileGoalStatuses(app.state, { todayKey: todayKey(), habitStatusOnDate })) {
    saveState({ skipBackup: true });
  }
  render();
  scrollWorkspaceTop();
  if (initialStateLoad.status === "recovered") showToast("Повреждённые локальные данные восстановлены из резервной копии");
  if (initialStateLoad.status === "newer" || initialStateLoad.reason === "newer-backup") showToast("Обнови приложение: данные созданы более новой версией. Исходные данные сохранены, экспорт доступен");
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

export async function initializeHostedConfig() {
  const result = await hostedConfig.loadHostedConfig();
  if (!result.managed) {
    await googleCalendarController.initialize();
    await studyController.initialize();
    return;
  }
  app.managedRemoteConfig = true;
  app.remoteSyncUrl = result.supabaseUrl;
  app.remoteSyncAnonKey = result.anonKey;
  app.remoteSyncEnabled = "on";
  saveUiState();
  if (els.remoteSyncUrl) els.remoteSyncUrl.value = app.remoteSyncUrl;
  if (els.remoteSyncAnonKey) els.remoteSyncAnonKey.value = app.remoteSyncAnonKey;
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

export async function synchronizeAuthenticatedAccount() {
  const session = remoteAuth.getSession();
  const userId = cleanText(session?.user?.id || "");
  if (!userId) return;
  const generation = ++app.authenticatedSyncGeneration;
  const isCurrent = () => generation === app.authenticatedSyncGeneration && remoteAuth.getSession()?.user?.id === userId;
  app.remoteSyncEnabled = "on";
  if (app.remoteSyncAccountId && app.remoteSyncAccountId !== userId) {
    remoteSyncWorkflow.resetQueue();
    const undo = createUndoSnapshot();
    const safetyBackup = createImportSafetyBackup(undo);
    if (safetyBackup?.ok === false) throw new Error("Не удалось создать safety backup перед сменой аккаунта");
    const pulled = await remoteSync.pullState(remoteSync.normalizeConfig({
      accessToken: session.access_token,
      anonKey: app.remoteSyncAnonKey,
      enabled: true,
      supabaseUrl: app.remoteSyncUrl,
      userId,
    }));
    if (!isCurrent()) return;
    const previous = app.state;
    replaceState(pulled.found && pulled.state ? pulled.state : null);
    if (saveState({ skipBackup: true, skipChangeTracking: true, skipRemote: true }) === false) {
      replaceState(previous);
      render();
      throw new Error("Не удалось сохранить данные выбранного аккаунта");
    }
    notesView.resetForState();
    applyAccountPreferences(true);
    app.remoteSyncLastPulledAt = pulled.updatedAt || pulled.clientUpdatedAt || "";
    app.remoteSyncLastPushedAt = "";
    app.remoteSyncPending = false;
    render();
    showToast("Загружены данные выбранного аккаунта");
  }
  app.remoteSyncAccountId = userId;
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

export function handleDateRollover() {
  const nextToday = todayKey();
  const rollover = dateRollover.resolveDateRollover(app.activeDate, app.currentToday, nextToday);
  if (!rollover.changed) return;
  app.currentToday = rollover.today;
  if (rollover.activeDate !== app.activeDate) {
    app.activeDate = rollover.activeDate;
    resetTaskForm({ open: false });
    resetHabitForm({ open: false });
  }
  saveUiState();
  render();
}

export function render() {
  const rollover = dateRollover.resolveDateRollover(app.activeDate, app.currentToday, todayKey());
  if (rollover.changed) {
    app.currentToday = rollover.today;
    app.activeDate = rollover.activeDate;
    saveUiState();
  }
  applyAccountPreferences();
  appShellController.render();
  workspaceGuide.render();
}

export function scrollWorkspaceTop() {
  appShellController.scrollTop();
}

export function syncNavigationRoute({ replace = false } = {}) {
  appShellController.syncRoute({ replace });
}

export function handleNavigationChange() {
  appShellController.handleNavigationChange();
}

export function renderSaveStatus() {
  saveStatusView.render({
    localStorageError: app.localStorageError,
    localUpdatedAt: app.localStateUpdatedAt,
    online: navigator.onLine,
    remoteEnabled: app.remoteSyncEnabled === "on" && Boolean(remoteAuth.getSession()?.user?.id),
    remoteLastPushedAt: latestIsoDate(app.remoteSyncLastPushedAt, app.remoteSyncLastPulledAt),
    syncStatus: remoteSyncWorkflow.getStatus(),
    stateBytes: storage.getDiagnostics().bytes,
  });
}

export function renderTaskSurfaces() {
  viewRenderer.render(app.activeView);
  workspaceGuide.render();
}

export function renderHabitSurfaces() {
  viewRenderer.render(app.activeView);
}

export function renderGoalSurfaces() {
  renderGoals();
}

export function renderDailyPulse() {
  dailyPulseController.render(app.activeDate);
}

export function renderTasks() {
  tasksView.renderTasks();
}

export function renderTimeline() {
  timelineView.renderTimeline();
}

export async function shiftDate(days) {
  if (!(await confirmDiscardOpenForms())) return;
  if (app.activeView === "overview" && app.overviewMode === "month") return shiftMonth(days);
  if (app.activeView === "overview" && app.overviewMode === "week") days *= 7;
  const date = parseDate(app.activeDate);
  date.setDate(date.getDate() + days);
  app.activeDate = toDateKey(date);
  saveUiState();
  resetTaskForm({ open: false });
  resetHabitForm({ open: false });
  render();
}

export async function goToday() {
  if (!(await confirmDiscardOpenForms())) return;
  app.activeDate = todayKey();
  saveUiState();
  resetTaskForm({ open: false });
  resetHabitForm({ open: false });
  render();
}

export async function shiftMonth(months) {
  if (!(await confirmDiscardOpenForms())) return;
  const date = parseDate(app.activeDate);
  const targetDay = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(targetDay, lastDay));
  app.activeDate = toDateKey(target);
  saveUiState();
  resetTaskForm({ open: false });
  resetHabitForm({ open: false });
  render();
}
