(function (global) {
  const SETTING_KEYS = new Set([
    "accentPreference", "backupSchedule", "densityPreference", "firstDayOfWeek",
    "navigationPreferences", "notificationSetting", "quietHours", "themePreference", "timeFormat",
  ]);
  const MAX_SETTINGS_BYTES = 256 * 1024;

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function exportableSettings(settings = {}) {
    return Object.fromEntries(
      Object.entries(settings).filter(([key]) => SETTING_KEYS.has(key)),
    );
  }

  function createSettingsTransfer(ctx) {
    let importGeneration = 0;

    function exportSettings() {
      const payload = {
        app: "Parsitasks",
        exportedAt: new Date().toISOString(),
        schemaVersion: ctx.schemaVersion,
        settings: exportableSettings(ctx.getSettings()),
        type: "settings",
      };
      const blob = new global.Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = global.URL.createObjectURL(blob);
      const link = ctx.document.createElement("a");
      link.href = url;
      link.download = `parsitasks-settings-${ctx.toDateKey(new Date())}.json`;
      ctx.document.body.appendChild(link);
      link.click();
      link.remove();
      global.URL.revokeObjectURL(url);
      ctx.showToast("Настройки экспортированы");
    }

    async function importSettings() {
      const file = ctx.els.settingsImportFile?.files?.[0];
      if (!file) return;
      const generation = ++importGeneration;
      const owner = ctx.getOwner?.();

      try {
        if (file.size > MAX_SETTINGS_BYTES) throw new Error("Файл настроек слишком большой · максимум 256 КБ");
        const text = await file.text();
        if (generation !== importGeneration) return false;
        if (ctx.getOwner?.() !== owner) throw new Error("Аккаунт изменился · выбери файл настроек заново");
        if (new global.Blob([text]).size > MAX_SETTINGS_BYTES) throw new Error("Файл настроек слишком большой · максимум 256 КБ");
        let parsed;
        try { parsed = JSON.parse(text); } catch { throw new Error("Не удалось прочитать JSON настроек"); }
        if (!isRecord(parsed) || (parsed.app !== undefined && parsed.app !== "Parsitasks") || (parsed.type !== undefined && parsed.type !== "settings")) {
          throw new Error("Выбери JSON настроек Parsitasks, а не файл с задачами");
        }
        if (parsed.schemaVersion !== undefined && (!Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1 || parsed.schemaVersion > ctx.schemaVersion)) {
          throw new Error("Файл настроек создан в другой версии · обнови приложение");
        }
        const source = Object.hasOwn(parsed, "settings") ? parsed.settings : parsed;
        if (!isRecord(source)) throw new Error("В файле нет настроек интерфейса");
        const imported = exportableSettings(source);
        const keys = Object.keys(imported);
        if (!keys.length || keys.some((key) => {
          const value = imported[key];
          if (["navigationPreferences", "quietHours"].includes(key)) return !isRecord(value);
          return typeof value !== "string" && !(key === "backupSchedule" && typeof value === "number" && Number.isFinite(value));
        })) throw new Error("В файле нет корректных настроек интерфейса");
        // Partial files change only their declared preferences, not unrelated account/device settings.
        if (ctx.applyImportedSettings({ ...ctx.getSettings?.(), ...imported }, keys) === false) {
          throw new Error("Не удалось сохранить настройки");
        }
        const saved = ctx.saveUiState();
        ctx.render();
        if (saved === false) {
          ctx.showToast("Настройки применены, но запись на устройстве не удалась · освободи место и повтори импорт");
          return false;
        }
        ctx.showToast("Настройки импортированы");
        return true;
      } catch (error) {
        if (generation !== importGeneration) return false;
        ctx.showToast(error.message || "Не удалось импортировать настройки");
        return false;
      } finally {
        if (generation === importGeneration && ctx.els.settingsImportFile?.files?.[0] === file) ctx.els.settingsImportFile.value = "";
      }
    }

    async function resetInterfaceSettings() {
      const owner = ctx.getOwner?.();
      const confirmed = await ctx.confirmAction({
        confirmLabel: "Сбросить",
        message: "Тема, цвет, плотность, навигация, формат времени и первый день недели вернутся к настройкам по умолчанию. Данные задач и привычек не изменятся.",
        tone: "danger",
        title: "Сбросить настройки интерфейса?",
      });
      if (!confirmed) return;
      if (ctx.getOwner?.() !== owner) {
        ctx.showToast("Аккаунт изменился · открой сброс настроек заново");
        return;
      }
      ctx.resetPreferences();
    }

    return { exportSettings, importSettings, resetInterfaceSettings };
  }

  const api = { createSettingsTransfer, exportableSettings };
  global.RhythmSettingsTransfer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
