// Device and account preferences.

import * as profileSettings from "../settings/profile-settings.js";
import * as navigationPreferencesModule from "../settings/navigation-preferences.js";
import * as reminderPolicy from "../platform/reminder-policy.js";
import * as accentColors from "../settings/accent-colors.js";
import { app } from "./store.js";
import { els } from "./dom.js";
import { syncCustomRepeatPanel, syncHabitCustomRepeatPanel } from "./forms.js";
import { handleDateRollover, render, renderSaveStatus } from "./lifecycle.js";
import { createUndoSnapshot, formatBackupDate, renderWeekdayLabels, restoreFailedSave, saveState, scheduleAutoBackup, showToast } from "./persistence.js";
import { syncDesktopReminders, updateNotificationButton } from "./platform.js";
import { saveStatusView } from "./services.js";
import { navigationController, notificationsController } from "./shell.js";
import { cleanText, settingsState, storage } from "./state.js";
import { remoteAuthController, remoteSyncWorkflow, settingsController } from "./sync.js";
import { renderOverview } from "./task-actions.js";

export function saveUiState() {
  try {
    storage.saveUiState({
      activeDate: app.activeDate,
      activeView: app.activeView,
      accentPreference: app.accentPreference,
      archiveCategoryFilter: app.archiveCategoryFilter,
      archivePeriod: app.archivePeriod,
      archiveSearchQuery: app.archiveSearchQuery,
      backupSchedule: app.backupSchedule,
      currentToday: app.currentToday,
      densityPreference: app.densityPreference,
      firstDayOfWeek: app.firstDayOfWeek,
      lastAutoBackupAt: app.lastAutoBackupAt,
      localStateUpdatedAt: app.localStateUpdatedAt,
      notificationSetting: app.notificationSetting,
      navigationPreferences: app.navigationPreferences,
      quietHours: app.quietHours,
      overviewMode: app.overviewMode,
      overdueHidden: app.overdueHidden,
      remoteSyncAnonKey: app.remoteSyncAnonKey,
      remoteSyncAccountId: app.remoteSyncAccountId,
      remoteSyncEnabled: app.remoteSyncEnabled,
      remoteSyncLastPulledAt: app.remoteSyncLastPulledAt,
      remoteSyncLastPushedAt: app.remoteSyncLastPushedAt,
      remoteSyncPending: app.remoteSyncPending,
      remoteSyncUrl: app.remoteSyncUrl,
      taskCategoryFilter: app.taskCategoryFilter,
      taskFilter: app.taskFilter,
      taskPane: app.taskPane,
      showStudyEvents: app.showStudyEvents,
      taskSearchQuery: app.taskSearchQuery,
      themePreference: app.themePreference,
      timeFormat: app.timeFormat,
    });
    if (app.localStorageError === "Не удалось сохранить настройки локально") app.localStorageError = "";
    return true;
  } catch {
    app.localStorageError = "Не удалось сохранить настройки локально";
    renderSaveStatus();
    return false;
  }
}

export function normalizeThemePreference(value) {
  return settingsState.normalizeThemePreference(value);
}

export function normalizeAccentPreference(value) {
  return settingsState.normalizeAccentPreference(value);
}

export function normalizeNotificationSetting(value) {
  return settingsState.normalizeNotificationSetting(value);
}

export function normalizeBackupSchedule(value) {
  return settingsState.normalizeBackupSchedule(value);
}

export function normalizeFirstDayOfWeek(value) {
  return settingsState.normalizeFirstDayOfWeek(value);
}

export function normalizeDensityPreference(value) {
  return settingsState.normalizeDensityPreference(value);
}

export function normalizeTimeFormat(value) {
  return settingsState.normalizeTimeFormat(value);
}

export function normalizeRemoteSyncEnabled(value) {
  return settingsState.normalizeRemoteSyncEnabled(value);
}

export function updateTimeZone(value) {
  const fallback = profileSettings.detectTimeZone();
  const normalized = profileSettings.normalizeTimeZone(value, fallback);
  if (normalized !== String(value || "").trim()) {
    settingsController.syncControls();
    showToast("Укажи часовой пояс в формате Europe/Moscow");
    return;
  }
  const previous = createUndoSnapshot();
  app.state.profile = { ...app.state.profile, timeZone: normalized, updatedAt: new Date().toISOString() };
  if (saveState() === false) {
    restoreFailedSave(previous);
    settingsController.syncControls();
    render();
    return;
  }
  settingsController.syncControls();
  handleDateRollover();
  render();
  showToast(`Часовой пояс: ${normalized}`);
}

export function updateJournalPermission(permission, value) {
  if (!["read", "write"].includes(permission)) return;
  const enabled = value !== "off";
  const previous = createUndoSnapshot();
  app.state.profile = {
    ...app.state.profile,
    journalAccess: {
      read: app.state.profile?.journalAccess?.read !== false,
      write: app.state.profile?.journalAccess?.write !== false,
      [permission]: enabled,
    },
    updatedAt: new Date().toISOString(),
  };
  if (saveState() === false) {
    restoreFailedSave(previous);
    settingsController.syncControls();
    return;
  }
  settingsController.syncControls();
  showToast(enabled ? "Доступ ChatGPT разрешён" : "Доступ ChatGPT отключён");
}

export function applyThemePreference() {
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)")?.matches;
  const resolvedTheme = app.themePreference === "system" ? (prefersLight ? "light" : "dark") : app.themePreference;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = app.themePreference;
  accentColors.apply(document.documentElement, app.accentPreference, resolvedTheme);
  if (els.themePreference) els.themePreference.value = app.themePreference;
}

export function applySettingsPreferences() {
  document.documentElement.dataset.accent = app.accentPreference;
  accentColors.apply(document.documentElement, app.accentPreference, document.documentElement.dataset.theme);
  document.documentElement.dataset.density = app.densityPreference;
  navigationController.apply();
  navigationController.renderControls();
  if (els.notificationSetting) els.notificationSetting.value = app.notificationSetting;
  if (els.backupSchedule) els.backupSchedule.value = app.backupSchedule;
  if (els.firstDayOfWeek) els.firstDayOfWeek.value = app.firstDayOfWeek;
  if (els.densityPreference) els.densityPreference.value = app.densityPreference;
  if (els.timeFormat) els.timeFormat.value = app.timeFormat;
  if (els.remoteSyncEnabled) els.remoteSyncEnabled.value = app.remoteSyncEnabled;
  if (els.remoteSyncUrl) els.remoteSyncUrl.value = app.remoteSyncUrl;
  if (els.remoteSyncAnonKey) els.remoteSyncAnonKey.value = app.remoteSyncAnonKey;
  syncCustomRepeatPanel();
  syncHabitCustomRepeatPanel();
}

export function getUiSettings() {
  return {
    accentPreference: app.accentPreference,
    backupSchedule: app.backupSchedule,
    densityPreference: app.densityPreference,
    firstDayOfWeek: app.firstDayOfWeek,
    localStateUpdatedAt: app.localStateUpdatedAt,
    notificationSetting: app.notificationSetting,
    navigationPreferences: app.navigationPreferences,
    quietHours: app.quietHours,
    remoteSyncAnonKey: app.remoteSyncAnonKey,
    remoteSyncAccountId: app.remoteSyncAccountId,
    remoteSyncEnabled: app.remoteSyncEnabled,
    remoteSyncLastPulledAt: app.remoteSyncLastPulledAt,
    remoteSyncLastPushedAt: app.remoteSyncLastPushedAt,
    remoteSyncPending: app.remoteSyncPending,
    remoteSyncUrl: app.remoteSyncUrl,
    themePreference: app.themePreference,
    timeFormat: app.timeFormat,
  };
}

export function getRemoteUiSettings(overrides = {}) {
  return settingsState.createRemoteUiSettings(getUiSettings(), overrides);
}

export function updateSetting(name, value) {
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

export function saveAccountPreferences(keys, stamp = new Date().toISOString()) {
  const previous = app.state.profile;
  const preferences = profileSettings.normalizePreferences(app.state.profile?.preferences);
  const settings = getUiSettings();
  for (const key of keys) preferences[key] = { value: settings[key], updatedAt: stamp };
  app.state.profile = { ...app.state.profile, preferences };
  if (saveState() === false) { app.state.profile = previous; return false; }
  app.appliedAccountPreferences = JSON.stringify(preferences);
  return true;
}

export function migrateAccountPreferences() {
  const preferences = profileSettings.normalizePreferences(app.state.profile?.preferences);
  const missing = profileSettings.preferenceKeys.filter((key) => !preferences[key]);
  // Legacy device settings are a baseline, never newer than an explicit account edit.
  if (missing.length) saveAccountPreferences(missing, "1970-01-01T00:00:00.000Z");
}

export function applyAccountPreferences(reset = false) {
  const preferences = profileSettings.normalizePreferences(app.state.profile?.preferences);
  const signature = JSON.stringify(preferences);
  if (!reset && signature === app.appliedAccountPreferences) return;
  app.appliedAccountPreferences = signature;
  const values = Object.fromEntries(Object.entries(preferences).map(([key, entry]) => [key, entry.value]));
  const defaults = reset ? settingsState.normalizeImportedSettings() : {};
  const accountDefaults = Object.fromEntries(profileSettings.preferenceKeys.filter((key) => key in defaults).map((key) => [key, defaults[key]]));
  applyImportedSettings({ ...getUiSettings(), ...accountDefaults, ...values });
  saveUiState();
}

export function updateDeviceSetting(name, value) {
  switch (name) {
    case "navigationPreferences": {
      const previous = app.navigationPreferences;
      app.navigationPreferences = navigationPreferencesModule.normalize(value);
      if (!saveUiState()) {
        app.navigationPreferences = previous;
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
      app.quietHours = reminderPolicy.normalizeQuietHours(value);
      saveUiState();
      settingsController.syncControls();
      syncDesktopReminders();
      notificationsController.renderCenter();
      break;
    case "accentPreference":
      app.accentPreference = normalizeAccentPreference(value);
      applySettingsPreferences();
      saveUiState();
      settingsController.syncControls();
      showToast("Цвет интерфейса обновлён");
      break;
    case "themePreference":
      app.themePreference = normalizeThemePreference(value);
      applyThemePreference();
      saveUiState();
      settingsController.syncControls();
      showToast("Тема обновлена");
      break;
    case "notificationSetting":
      app.notificationSetting = normalizeNotificationSetting(value);
      saveUiState();
      settingsController.syncControls();
      updateNotificationButton();
      syncDesktopReminders();
      showToast(app.notificationSetting === "on" ? "Напоминания включены" : "Напоминания на паузе");
      break;
    case "backupSchedule":
      app.backupSchedule = normalizeBackupSchedule(value);
      saveUiState();
      scheduleAutoBackup();
      settingsController.syncControls();
      showToast(app.backupSchedule === "0" ? "Резервное копирование по расписанию выключено" : "Расписание резервного копирования обновлено");
      break;
    case "firstDayOfWeek":
      app.firstDayOfWeek = normalizeFirstDayOfWeek(value);
      saveUiState();
      settingsController.syncControls();
      renderWeekdayLabels();
      renderOverview();
      render();
      showToast("Календарь обновлен");
      break;
    case "densityPreference":
      app.densityPreference = normalizeDensityPreference(value);
      applySettingsPreferences();
      saveUiState();
      settingsController.syncControls();
      showToast("Плотность интерфейса обновлена");
      break;
    case "timeFormat":
      app.timeFormat = normalizeTimeFormat(value);
      applySettingsPreferences();
      saveUiState();
      settingsController.syncControls();
      render();
      showToast("Формат времени обновлен");
      break;
    case "remoteSyncEnabled":
      app.remoteSyncEnabled = normalizeRemoteSyncEnabled(value);
      remoteSyncWorkflow.clearError();
      applySettingsPreferences();
      saveUiState();
      settingsController.syncControls();
      renderRemoteSyncStatus();
      if (isRemoteSyncReady()) scheduleRemotePush();
      showToast(app.remoteSyncEnabled === "on" ? "Синхронизация с БД включена" : "Синхронизация с БД выключена");
      break;
    case "remoteSyncUrl":
      if (app.managedRemoteConfig) {
        settingsController.syncControls();
        return;
      }
      app.remoteSyncUrl = cleanText(value);
      remoteSyncWorkflow.clearError();
      applySettingsPreferences();
      saveUiState();
      settingsController.syncControls();
      renderRemoteSyncStatus();
      remoteAuthController.render();
      break;
    case "remoteSyncAnonKey":
      if (app.managedRemoteConfig) {
        settingsController.syncControls();
        return;
      }
      app.remoteSyncAnonKey = cleanText(value);
      remoteSyncWorkflow.clearError();
      applySettingsPreferences();
      saveUiState();
      settingsController.syncControls();
      renderRemoteSyncStatus();
      remoteAuthController.render();
      break;
  }
}

export function resetInterfacePreferences() {
  const previousSettings = getUiSettings();
  app.themePreference = "dark";
  app.accentPreference = "emerald";
  app.densityPreference = "comfortable";
  app.timeFormat = "24";
  app.firstDayOfWeek = "monday";
  app.navigationPreferences = navigationPreferencesModule.normalize();
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

export function applyImportedSettings(settings = {}) {
  const normalized = settingsState.normalizeImportedSettings(settings);
  app.themePreference = normalized.themePreference;
  app.accentPreference = normalized.accentPreference;
  app.notificationSetting = normalized.notificationSetting;
  app.navigationPreferences = normalized.navigationPreferences;
  app.quietHours = normalized.quietHours;
  app.backupSchedule = normalized.backupSchedule;
  app.firstDayOfWeek = normalized.firstDayOfWeek;
  app.densityPreference = normalized.densityPreference;
  app.timeFormat = normalized.timeFormat;
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

export function renderSettingsBackupStatus() {
  if (!els.settingsBackupStatus) return;
  if (app.backupSchedule === "0") {
    els.settingsBackupStatus.textContent = "Резервное копирование по расписанию выключено";
    return;
  }
  const last = app.lastAutoBackupAt ? formatBackupDate(app.lastAutoBackupAt) : "еще не запускался";
  const next = app.nextAutoBackupAt ? formatBackupDate(app.nextAutoBackupAt) : "ожидает расписание";
  els.settingsBackupStatus.textContent = `Последняя резервная копия: ${last} · следующая: ${next}`;
}

export function isRemoteSyncReady() {
  return remoteSyncWorkflow.isReady();
}

export function renderRemoteSyncStatus() {
  remoteSyncWorkflow.renderStatus();
  app.syncDiagnosticsController?.render();
}

export function scheduleRemotePush() {
  remoteSyncWorkflow.schedulePush();
}

export async function pushRemoteState(options = {}) {
  return remoteSyncWorkflow.push(options);
}

export async function checkRemoteConnection(options = {}) {
  const result = await remoteSyncWorkflow.check(options);
  app.syncDiagnosticsController?.setConnectionResult(result);
  return result;
}

export async function pullRemoteState(options = {}) {
  return remoteSyncWorkflow.pull(options);
}

export function latestIsoDate(...values) {
  return values.filter(Boolean).sort().at(-1) || "";
}

export function describeRemoteSyncError(error) {
  return saveStatusView.describeRemoteError(error);
}
