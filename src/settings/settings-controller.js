(function (global) {
  function createSettingsController(ctx) {
    const settingsSync = global.RhythmSettingsSync.createSettingsSync(ctx);

    function bindEvents() {
      ctx.els.settingsExportButton?.addEventListener("click", ctx.exportData);
      ctx.els.settingsImportDataButton?.addEventListener("click", () => ctx.els.importFile?.click());
      ctx.els.settingsRestoreBackupButton?.addEventListener("click", ctx.restoreBackup);
      ctx.els.settingsOpenBackupFolderButton?.addEventListener("click", ctx.openBackupFolder);
      ctx.els.settingsNotifyButton?.addEventListener("click", ctx.requestNotifications);
      ctx.els.settingsExportSettingsButton?.addEventListener("click", ctx.exportSettings);
      ctx.els.settingsImportSettingsButton?.addEventListener("click", () => ctx.els.settingsImportFile?.click());
      ctx.els.settingsImportFile?.addEventListener("change", ctx.importSettings);
      ctx.els.settingsResetButton?.addEventListener("click", ctx.resetInterfaceSettings);
      settingsSync.bindEvents();

      ctx.els.accentPreferences?.forEach((input) => {
        input.addEventListener("change", () => {
          if (input.checked) ctx.updateSetting("accentPreference", input.value);
        });
      });
      ctx.els.themePreference?.addEventListener("change", () => ctx.updateSetting("themePreference", ctx.els.themePreference.value));
      ctx.els.notificationSetting?.addEventListener("change", () => ctx.updateSetting("notificationSetting", ctx.els.notificationSetting.value));
      ctx.els.backupSchedule?.addEventListener("change", () => ctx.updateSetting("backupSchedule", ctx.els.backupSchedule.value));
      ctx.els.firstDayOfWeek?.addEventListener("change", () => ctx.updateSetting("firstDayOfWeek", ctx.els.firstDayOfWeek.value));
      ctx.els.densityPreference?.addEventListener("change", () => ctx.updateSetting("densityPreference", ctx.els.densityPreference.value));
      ctx.els.timeFormat?.addEventListener("change", () => ctx.updateSetting("timeFormat", ctx.els.timeFormat.value));
      ctx.els.timeZoneSetting?.addEventListener("change", () => ctx.updateTimeZone(ctx.els.timeZoneSetting.value));
      ctx.els.mcpJournalRead?.addEventListener("change", () => ctx.updateJournalPermission("read", ctx.els.mcpJournalRead.value));
      ctx.els.mcpJournalWrite?.addEventListener("change", () => ctx.updateJournalPermission("write", ctx.els.mcpJournalWrite.value));
    }

    function syncControls(settings = ctx.getSettings()) {
      ctx.els.accentPreferences?.forEach((input) => {
        input.checked = input.value === settings.accentPreference;
      });
      setValue(ctx.els.themePreference, settings.themePreference);
      setValue(ctx.els.notificationSetting, settings.notificationSetting);
      setValue(ctx.els.backupSchedule, settings.backupSchedule);
      setValue(ctx.els.firstDayOfWeek, settings.firstDayOfWeek);
      setValue(ctx.els.densityPreference, settings.densityPreference);
      setValue(ctx.els.timeFormat, settings.timeFormat);
      setValue(ctx.els.timeZoneSetting, settings.timeZone);
      setValue(ctx.els.mcpJournalRead, settings.journalAccess?.read === false ? "off" : "on");
      setValue(ctx.els.mcpJournalWrite, settings.journalAccess?.write === false ? "off" : "on");
      settingsSync.syncControls(settings);
      ctx.renderBackupStatus?.();
    }

    function setValue(element, value) {
      if (element) element.value = value;
    }

    return {
      bindEvents,
      syncControls,
    };
  }

  global.RhythmSettingsController = { createSettingsController };
})(window);
