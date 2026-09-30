const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rhythmDesktop", {
  syncReminders(payload) {
    ipcRenderer.send("reminders:sync", payload);
  },
  onReminderClicked(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("reminders:clicked", listener);
    return () => ipcRenderer.removeListener("reminders:clicked", listener);
  },
  onReminderDelivered(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("reminders:delivered", listener);
    return () => ipcRenderer.removeListener("reminders:delivered", listener);
  },
  showTestNotification() {
    return ipcRenderer.invoke("reminders:test");
  },
  writeFileBackup(payload) {
    return ipcRenderer.invoke("backups:write-file", payload);
  },
  getFileBackupInfo() {
    return ipcRenderer.invoke("backups:info");
  },
  openBackupFolder() {
    return ipcRenderer.invoke("backups:open-folder");
  },
  getUpdateStatus() {
    return ipcRenderer.invoke("updates:get-status");
  },
  checkForUpdates() {
    return ipcRenderer.invoke("updates:check");
  },
  installUpdate() {
    return ipcRenderer.invoke("updates:install");
  },
  openReleases() {
    return ipcRenderer.invoke("updates:open-releases");
  },
  onUpdateStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("updates:status", listener);
    return () => ipcRenderer.removeListener("updates:status", listener);
  },
});
