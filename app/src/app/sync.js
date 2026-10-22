// Import/export, settings transfer, remote sync and device sync.

import * as profileSettings from "../settings/profile-settings.js";
import * as syncMetadata from "../sync/sync-metadata.js";
import * as stateMerge from "../core/state-merge.js";
import * as importExport from "../settings/import-export.js";
import * as settingsTransferModule from "../settings/settings-transfer.js";
import * as settingsControllerModule from "../settings/settings-controller.js";
import * as remoteSyncController from "../sync/remote-sync-controller.js";
import * as remoteAuthControllerModule from "../auth/remote-auth-controller.js";
import * as remoteDataControllerModule from "../sync/remote-data-controller.js";
import * as syncDiagnosticsModule from "../sync/sync-diagnostics.js";
import * as deviceSyncControllerModule from "../sync/device-sync-controller.js";
import * as mcpActivityControllerModule from "../integrations/mcp-activity-controller.js";
import * as mcpActivity from "../integrations/mcp-activity.js";
import { app } from "./store.js";
import { els } from "./dom.js";
import { exportData } from "./forms.js";
import { render, renderSaveStatus } from "./lifecycle.js";
import { confirmAction, createImportSafetyBackup, createUndoSnapshot, formatBackupDate, normalizeState, replaceState, restoreBackup, saveState, showToast } from "./persistence.js";
import { openBackupFolder, requestNotifications } from "./platform.js";
import { remoteAuth, remoteSync, syncHistory } from "./services.js";
import { applyImportedSettings, checkRemoteConnection, describeRemoteSyncError, getRemoteUiSettings, getUiSettings, latestIsoDate, pullRemoteState, pushRemoteState, renderRemoteSyncStatus, renderSettingsBackupStatus, resetInterfacePreferences, saveAccountPreferences, saveUiState, scheduleRemotePush, updateJournalPermission, updateSetting, updateTimeZone } from "./settings.js";
import { SCHEMA_VERSION, settingsState, storage, toDateKey } from "./state.js";

export let importExportController, settingsTransfer, settingsController, remoteSyncWorkflow, remoteAuthController, remoteDataController, deviceSyncController, mcpActivityController;

export function wireSync() {
  importExportController = importExport.createImportExport({
    getUserId: () => remoteAuth.getSession()?.user?.id || "",
    els,
    confirmAction,
    createUndoSnapshot,
    getState: () => app.state,
    normalizeState,
    render,
    replaceState,
    saveState,
    schemaVersion: SCHEMA_VERSION,
    showToast,
    storage,
    toDateKey,
  });

  settingsTransfer = settingsTransferModule.createSettingsTransfer({
    applyImportedSettings: (settings, keys = profileSettings.preferenceKeys) => {
      const previousSettings = getUiSettings();
      applyImportedSettings(settings);
      const accountKeys = keys.filter((key) => profileSettings.preferenceKeys.includes(key));
      if (accountKeys.length && !saveAccountPreferences(accountKeys)) {
        applyImportedSettings(previousSettings);
        saveUiState();
        throw new Error("Не удалось сохранить настройки аккаунта");
      }
    },
    confirmAction,
    document,
    els,
    getOwner: () => JSON.stringify([remoteAuth.getSession()?.user?.id || "", app.remoteSyncAccountId, app.authenticatedSyncGeneration]),
    getSettings: getUiSettings,
    render,
    resetPreferences: resetInterfacePreferences,
    saveUiState,
    schemaVersion: SCHEMA_VERSION,
    showToast,
    toDateKey,
  });

  settingsController = settingsControllerModule.createSettingsController({
    els,
    exportData,
    exportSettings: settingsTransfer.exportSettings,
    getSettings: () => ({ ...getUiSettings(), journalAccess: app.state.profile.journalAccess, timeZone: app.state.profile.timeZone }),
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

  remoteSyncWorkflow = remoteSyncController.createRemoteSyncWorkflow({
    confirmAction,
    createImportSafetyBackup,
    createUndoSnapshot,
    describeError: describeRemoteSyncError,
    els,
    formatDate: formatBackupDate,
    getLocalUpdatedAt: () => app.localStateUpdatedAt,
    getRemoteUiSettings,
    getSettings: () => ({
      accessToken: remoteAuth.getSession()?.access_token || "",
      anonKey: app.remoteSyncAnonKey,
      enabled: app.remoteSyncEnabled === "on",
      supabaseUrl: app.remoteSyncUrl,
      userId: remoteAuth.getSession()?.user?.id || "",
    }),
    getState: () => app.state,
    getSyncMeta: () => ({
      lastPulledAt: app.remoteSyncLastPulledAt,
      lastPushedAt: app.remoteSyncLastPushedAt,
      pending: app.remoteSyncPending,
    }),
    isWorkspaceReady: () => !app.remoteSyncAccountId || app.remoteSyncAccountId === remoteAuth.getSession()?.user?.id,
    isRemoteVersionNewer: settingsState.isRemoteVersionNewer,
    latestIsoDate,
    mergeStates: stateMerge.mergeStates,
    remoteSync,
    statesEqual: (left, right) => syncMetadata.sameValue(normalizeState(left), normalizeState(right)),
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
      if (lastPulledAt) app.remoteSyncLastPulledAt = lastPulledAt;
      if (lastPushedAt) app.remoteSyncLastPushedAt = lastPushedAt;
      if (typeof pending === "boolean") app.remoteSyncPending = pending;
    },
    showToast,
    statusElement: els.remoteSyncStatus,
    syncControls: () => settingsController.syncControls(),
  });

  remoteAuthController = remoteAuthControllerModule.createRemoteAuthController({
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

  remoteDataController = remoteDataControllerModule.createRemoteDataController({
    afterAccountDeleted: async () => {
      app.remoteSyncEnabled = "off";
      app.remoteSyncPending = false;
      await remoteAuth.signOut();
      saveUiState();
      settingsController.syncControls();
      remoteAuthController.render();
      renderRemoteSyncStatus();
    },
    afterSnapshotRestored: (result) => {
      const restoredAt = result?.saved?.row?.updated_at || result?.saved?.clientUpdatedAt || new Date().toISOString();
      app.remoteSyncLastPulledAt = restoredAt;
      app.remoteSyncLastPushedAt = restoredAt;
      app.remoteSyncPending = false;
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
      anonKey: app.remoteSyncAnonKey,
      enabled: true,
      supabaseUrl: app.remoteSyncUrl,
      userId: remoteAuth.getSession()?.user?.id || "",
    }),
    getState: () => app.state,
    getUserEmail: () => remoteAuth.getSession()?.user?.email || "",
    isReady: () => Boolean(remoteAuth.getSession()?.access_token && app.remoteSyncUrl && app.remoteSyncAnonKey),
    remoteSync,
    render,
    replaceState,
    saveState,
    showToast,
  });

  app.syncDiagnosticsController = syncDiagnosticsModule.createSyncDiagnostics({
    container: els.syncDiagnostics,
    describeError: describeRemoteSyncError,
    formatDate: formatBackupDate,
    getSnapshot: () => {
      const workflowStatus = remoteSyncWorkflow.getStatus();
      return {
        accountLabel: remoteAuth.getSession()?.user?.email || "",
        authenticated: Boolean(remoteAuth.getSession()?.access_token),
        enabled: app.remoteSyncEnabled === "on",
        inFlight: workflowStatus.inFlight,
        lastError: workflowStatus.lastError,
        lastPulledAt: app.remoteSyncLastPulledAt,
        lastPushedAt: app.remoteSyncLastPushedAt,
        online: navigator.onLine !== false,
        pending: workflowStatus.pending,
        projectConfigured: Boolean(app.remoteSyncUrl && app.remoteSyncAnonKey),
      };
    },
  });

  deviceSyncController = deviceSyncControllerModule.createDeviceSyncController({
    ensureFreshSession: () => remoteAuth.ensureFreshSession().catch(() => null),
    onOnline: () => {
      renderSaveStatus();
      scheduleRemotePush();
    },
    syncLatest: (options) => remoteSyncWorkflow.syncLatest(options),
  });

  syncHistory.render(els.remoteSyncHistory, formatBackupDate);

  mcpActivityController = mcpActivityControllerModule.createMcpActivityController({
    activityApi: mcpActivity,
    confirmAction,
    container: els.mcpActivityList,
    formatDate: formatBackupDate,
    getState: () => app.state,
    render,
    replaceState,
    saveState,
    showToast,
  });
}
