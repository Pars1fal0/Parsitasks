// Saving, backups and undo.

import * as documentState from "../core/document-state.js";
import * as stateMerge from "../core/state-merge.js";
import * as goalActivity from "../goals/goal-activity.js";
import { app } from "./store.js";
import { els } from "./dom.js";
import { resetTaskForm } from "./forms.js";
import { render, renderSaveStatus } from "./lifecycle.js";
import { syncDesktopBackup, syncDesktopReminders } from "./platform.js";
import { habitStatusOnDate } from "./queries.js";
import { confirmDialog, googleCalendarController, remoteAuth, toastController } from "./services.js";
import { renderSettingsBackupStatus, saveUiState, scheduleRemotePush } from "./settings.js";
import { createId, initialStateLoad, normalizeDateKey, stateController, todayKey } from "./state.js";
import { importExportController } from "./sync.js";

export function scheduleAutoBackup() {
  if (app.autoBackupTimerId) {
    clearInterval(app.autoBackupTimerId);
    app.autoBackupTimerId = null;
  }

  const minutes = Number(app.backupSchedule);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    app.nextAutoBackupAt = "";
    renderSettingsBackupStatus();
    return;
  }

  const intervalMs = minutes * 60 * 1000;
  app.nextAutoBackupAt = new Date(Date.now() + intervalMs).toISOString();
  renderSettingsBackupStatus();

  app.autoBackupTimerId = setInterval(async () => {
    const localResult = createBackup({ silent: true });
    const fileResult = await syncDesktopBackup();
    if (localResult?.ok || fileResult?.ok) {
      app.lastAutoBackupAt = new Date().toISOString();
      saveUiState();
    }
    app.nextAutoBackupAt = new Date(Date.now() + intervalMs).toISOString();
    renderSettingsBackupStatus();
  }, intervalMs);
}

export function normalizeState(raw) {
  return documentState.normalizeState(raw);
}

export function replaceState(nextState) {
  app.state = stateController.replaceState(nextState);
  goalActivity.reconcileGoalStatuses(app.state, { todayKey: todayKey(), habitStatusOnDate });
}

export function saveState(options = {}) {
  goalActivity.reconcileGoalStatuses(app.state, { todayKey: todayKey(), habitStatusOnDate });
  try {
    app.state = stateController.saveState(app.state, options);
    app.localStorageError = "";
  } catch (error) {
    if (error.code === "client-outdated") {
      app.localStorageError = "Данные созданы более новой версией · обнови приложение, исходные данные сохранены";
      renderSaveStatus(); showToast(app.localStorageError); return false;
    }
    if (error.message === "Workspace changed in another tab") {
      app.localStorageError = "В другой вкладке сменился аккаунт · обнови эту страницу";
      renderSaveStatus(); showToast(app.localStorageError); return false;
    }
    app.localStorageError = "Локальное хранилище заполнено · экспортируй данные";
    renderSaveStatus();
    showToast("Не удалось сохранить данные. Экспортируй JSON, чтобы не потерять изменения");
    return false;
  }
  app.localStateUpdatedAt = options.localUpdatedAt || new Date().toISOString();
  saveUiState();
  renderSaveStatus();
  if (!options.skipBackup) updateBackupStatus();
  syncDesktopReminders();
  if (!options.skipBackup && !options.skipRemote) scheduleRemotePush();
  if (!options.skipGoogleCalendar) googleCalendarController.schedule();
  return true;
}

export function createBackup(options = {}) {
  return importExportController.createBackup(options);
}

export function createImportSafetyBackup(snapshot) {
  return importExportController.createImportSafetyBackup(snapshot);
}

export function restoreBackup() {
  return importExportController.restoreBackup();
}

export function updateBackupStatus() {
  importExportController.updateBackupStatus();
}

export function formatBackupDate(value) {
  return importExportController.formatBackupDate(value);
}

export function seedIfEmpty() {
  if (initialStateLoad.status === "corrupt") return;
  if (app.state.defaultsSeeded) return;
  app.state.defaultsSeeded = true;
  if (app.state.categories.length) {
    saveState();
    return;
  }
  app.state.categories.push(
    { id: createId(), name: "Работа", color: "#5967d8", createdAt: new Date().toISOString() },
    { id: createId(), name: "Фокус", color: "#00a78e", createdAt: new Date().toISOString() },
    { id: createId(), name: "Здоровье", color: "#ef6a4b", createdAt: new Date().toISOString() },
    { id: createId(), name: "Дом", color: "#e7b84a", createdAt: new Date().toISOString() },
  );
  saveState();
}

export function renderWeekdayLabels() {
  if (!els.monthWeekdays) return;
  const mondayFirst = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const sundayFirst = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  els.monthWeekdays.replaceChildren(
    ...(app.firstDayOfWeek === "sunday" ? sundayFirst : mondayFirst).map((label) => {
      const node = document.createElement("span");
      node.textContent = label;
      return node;
    }),
  );
}

export function createUndoSnapshot() {
  return {
    userId: remoteAuth.getSession()?.user?.id || "",
    activeDate: app.activeDate,
    activeView: app.activeView,
    state: JSON.stringify(app.state),
  };
}

export function restoreFailedSave(snapshot) {
  if (Object.hasOwn(snapshot, "userId") && snapshot.userId !== (remoteAuth.getSession()?.user?.id || "")) return false;
  replaceState(JSON.parse(snapshot.state));
  syncDesktopReminders();
}

export function restoreUndoSnapshot(snapshot) {
  if (!snapshot?.state) return;
  if (Object.hasOwn(snapshot, "userId") && snapshot.userId !== (remoteAuth.getSession()?.user?.id || "")) {
    showToast("Аккаунт изменился. Отмена действия другого аккаунта недоступна."); return false;
  }
  const previous = createUndoSnapshot();
  let saved = false;
  const rollback = () => {
    restoreFailedSave(previous);
    app.activeDate = previous.activeDate;
    app.activeView = previous.activeView;
    render();
  };
  try {
    const before = JSON.parse(snapshot.state);
    replaceState(snapshot.afterState ? stateMerge.undoChanges(before, JSON.parse(snapshot.afterState), app.state) : before);
    app.activeDate = normalizeDateKey(snapshot.activeDate, todayKey());
    app.activeView = snapshot.activeView || "tasks";
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

export function showToast(message, options = {}) {
  if (options.undo?.state && !options.undo.afterState) options.undo.afterState = JSON.stringify(app.state);
  toastController.showToast(message, options);
}

export function confirmAction(options = {}) {
  return confirmDialog.confirm(options);
}
