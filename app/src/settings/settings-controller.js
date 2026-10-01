(function (global) {
  function createSettingsController(ctx) {
    const settingsSync = global.RhythmSettingsSync.createSettingsSync(ctx);

    function organizeLayout() {
      const grid = document.querySelector("#settingsView .settings-grid");
      const section = (heading) => document.querySelector(`#${heading}`).closest("details");
      const appearance = section("appearanceHeading");
      const reminders = section("notificationsSettingsHeading");
      const account = section("dataSettingsHeading");
      const help = document.querySelector("#helpSettingsHeading")?.closest("details");
      const primary = [appearance, reminders, account, help].filter(Boolean);
      const children = [...grid.children];
      const identity = document.querySelector(".settings-account-card");
      identity.classList.remove("panel");
      account.querySelector(":scope > summary").after(identity);
      primary.forEach((group) => {
        group.classList.remove("panel");
        group.classList.add("settings-primary-group");
      });
      children.filter((node) => !primary.includes(node)).forEach((node) => {
        node.classList.remove("panel", "settings-panel", "settings-accordion");
        node.classList.add("settings-subsection");
        const destination = node.contains(document.querySelector("#navigationPreferences")) || node.contains(ctx.els.categoryForm) ? appearance : account;
        destination.append(node);
      });
      const status = document.querySelector("#remoteSyncStatus");
      account.querySelector(".settings-account-card").after(status);
      const deleteAccount = document.querySelector("#remoteAccountDeleteButton");
      const danger = document.createElement("div");
      danger.className = "settings-actions";
      danger.append(deleteAccount);
      account.append(danger);
      grid.replaceChildren(...primary);
    }

    function bindEvents() {
      organizeLayout();
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
      const quietEnabled = document.querySelector("#quietHoursEnabled");
      const quietStart = document.querySelector("#quietHoursStart");
      const quietEnd = document.querySelector("#quietHoursEnd");
      [quietEnabled, quietStart, quietEnd].forEach((field) => field?.addEventListener("change", () => {
        if (quietEnabled.checked && quietStart.value === quietEnd.value) {
          ctx.showToast?.("Начало и конец тихих часов должны отличаться");
          syncControls();
          return;
        }
        ctx.updateSetting("quietHours", { enabled: quietEnabled.checked, start: quietStart.value, end: quietEnd.value });
      }));
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
      const quiet = settings.quietHours || { enabled: false, start: "22:00", end: "08:00" };
      const enabled = document.querySelector("#quietHoursEnabled");
      if (enabled) enabled.checked = quiet.enabled;
      ["Start", "End"].forEach((part) => {
        const field = document.querySelector(`#quietHours${part}`);
        if (field) { field.value = quiet[part.toLowerCase()]; field.disabled = !quiet.enabled; }
      });
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
