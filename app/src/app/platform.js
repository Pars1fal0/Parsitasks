// Reminders and desktop integrations.

import { app } from "./store.js";
import { applySettingsPreferences, saveUiState } from "./settings.js";
import { notificationsController } from "./shell.js";
import { importExportController } from "./sync.js";

export function checkDueNotifications() {
  notificationsController.checkDueNotifications();
}

export async function requestNotifications() {
  app.notificationSetting = "on";
  applySettingsPreferences();
  saveUiState();
  return notificationsController.requestNotifications();
}

export function updateNotificationButton(permission = "Notification" in window ? Notification.permission : "default") {
  notificationsController.updateNotificationButton(permission);
}

export function syncDesktopReminders() {
  notificationsController.syncDesktopReminders();
}

export function syncDesktopBackup() {
  return importExportController.syncDesktopBackup();
}

export async function updateFileBackupStatus() {
  return importExportController.updateFileBackupStatus();
}

export async function openBackupFolder() {
  return importExportController.openBackupFolder();
}

export function getTaskDeadlineDate(task, dateKey) {
  return notificationsController.getTaskDeadlineDate(task, dateKey);
}
