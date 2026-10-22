// Platform services: PWA updates, toasts, dialogs, auth, Google Calendar and scheduling helpers.

import * as pwaControllerModule from "../platform/pwa-controller.js";
import * as toastModule from "../ui/toast.js";
import * as saveStatusModule from "../sync/save-status.js";
import * as confirmDialogModule from "../ui/confirm-dialog.js";
import * as formDialog from "../ui/form-dialog.js";
import * as remoteSyncModule from "../sync/remote-sync.js";
import * as remoteAuthModule from "../auth/remote-auth.js";
import * as authGate from "../auth/auth-gate.js";
import * as googleCalendarApiModule from "../integrations/google-calendar-api.js";
import * as googleCalendarControllerModule from "../integrations/google-calendar-controller.js";
import * as syncHistoryModule from "../sync/sync-history.js";
import * as taskSchedule from "../tasks/task-schedule.js";
import * as calendarDragControllerModule from "../calendar/calendar-drag-controller.js";
import * as taskSubtasks from "../tasks/task-subtasks.js";
import { app } from "./store.js";
import { els } from "./dom.js";
import { render } from "./lifecycle.js";
import { confirmAction, createUndoSnapshot, formatBackupDate, restoreUndoSnapshot, saveState, showToast } from "./persistence.js";
import { addDays, cleanTimeValue, createId, formatTime, minutesToTime, normalizeDateKey, taskState, timeToMinutes, toTimeValue } from "./state.js";
import { moveTaskToDate, openDateTasks } from "./task-actions.js";

export let pwaController, toastController, saveStatusView, confirmDialog, remoteSync, remoteAuth, googleCalendarApi, googleCalendarController, syncHistory, taskScheduleController, getTaskScheduleMode, setTaskScheduleMode, syncTaskScheduleMode, syncTaskTimePresets, taskFormHome, calendarDragController;

export const priorityLabels = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

export function saveSubtaskChange(task, dateKey, scope, changes) {
  const undo = createUndoSnapshot();
  const removing = Object.hasOwn(changes, "itemId");
  let saved;
  try {
    const mutate = removing ? taskSubtasks.removeSubtask : taskSubtasks.appendSubtask;
    saved = mutate({ state: app.state, task, dateKey, scope, createId, ...changes });
  } catch (error) { return { error: error.message }; }
  if (saveState() === false) {
    // Keep the draft mounted while restoring the original task references.
    const previous = JSON.parse(undo.state);
    const original = previous.tasks.find((item) => item.id === task.id);
    Object.keys(task).forEach((key) => delete task[key]); Object.assign(task, original);
    app.state.tasks = previous.tasks.map((item) => item.id === task.id ? task : app.state.tasks.find((current) => current.id === item.id) || item);
    app.state.taskOrder = previous.taskOrder;
    return { error: "Не удалось сохранить. Попробуйте снова." };
  }
  showToast(removing ? "Подзадача удалена" : "Подзадача добавлена", { undo });
  return { id: saved.id };
}

export function wireServices() {
  app.pendingUpdateRegistration = null;

  pwaController = pwaControllerModule.createPwaController({
    onUpdateAvailable: (registration) => {
      app.pendingUpdateRegistration = registration;
      if (els.updateBanner) els.updateBanner.hidden = false;
    },
  });

  els.applyUpdateButton?.addEventListener("click", () => {
    if (!pwaController.activateUpdate(app.pendingUpdateRegistration)) return;
    els.applyUpdateButton.disabled = true;
    els.applyUpdateButton.textContent = "Обновляем...";
  });

  toastController = toastModule.createToastController({
    element: els.toast,
    restoreUndoSnapshot,
  });

  saveStatusView = saveStatusModule.createSaveStatus({
    element: els.saveStatus,
    formatTime,
    toTimeValue,
  });

  confirmDialog = confirmDialogModule.createConfirmDialog({ els });

  formDialog.createFormDialogManager({
    backdrop: els.formBackdrop,
    panels: [els.taskFormPanel, els.habitFormPanel, els.goalFormPanel],
  });

  remoteSync = remoteSyncModule.createRemoteSync();

  remoteAuth = remoteAuthModule.createRemoteAuth({
    getConfig: () => ({ anonKey: app.remoteSyncAnonKey, supabaseUrl: app.remoteSyncUrl }),
    onSessionChange: (session) => {
      if (session || authGate.isAutomationLocation()) return;
      queueMicrotask(() => authGate.redirectAfterSignOut());
    },
  });

  googleCalendarApi = googleCalendarApiModule.createGoogleCalendarApi({
    getAccessToken: async () => (await remoteAuth.ensureFreshSession().catch(() => null))?.access_token || "",
  });

  googleCalendarController = googleCalendarControllerModule.createGoogleCalendarController({
    api: googleCalendarApi,
    confirmAction,
    createId,
    deleteTask: (taskId) => taskState.deleteTask(taskId),
    els,
    formatDate: formatBackupDate,
    getAccessToken: () => remoteAuth.getSession()?.access_token || "",
    getState: () => app.state,
    getTimeZone: () => app.state.profile?.timeZone || "Europe/Moscow",
    render,
    saveState,
    showToast,
  });

  syncHistory = syncHistoryModule.createSyncHistory();

  app.syncDiagnosticsController = null;

  taskScheduleController = taskSchedule.createTaskSchedule({
    cleanTimeValue,
    els,
    minutesToTime,
    timeToMinutes,
  });

  getTaskScheduleMode = taskScheduleController.getMode;

  setTaskScheduleMode = taskScheduleController.setMode;

  syncTaskScheduleMode = taskScheduleController.syncMode;

  syncTaskTimePresets = taskScheduleController.syncPresets;

  taskFormHome = {
    next: els.taskFormPanel?.nextSibling || null,
    parent: els.taskFormPanel?.parentNode || null,
  };

  calendarDragController = calendarDragControllerModule.createCalendarDragController({
    addDays,
    getActiveDate: () => app.activeDate,
    moveTaskToDate,
    normalizeDateKey,
    openDateTasks,
  });
}
