(function (global) {
  function createImportExport(ctx) {
    function exportData() {
      const payload = {
        app: "Parsitasks",
        schemaVersion: ctx.schemaVersion,
        exportedAt: new Date().toISOString(),
        state: ctx.getState(),
      };
      createBackup({ payload, silent: true });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `parsitasks-${ctx.toDateKey(new Date())}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      ctx.showToast("Экспорт готов");
    }

    async function importData() {
      const file = ctx.els.importFile.files?.[0];
      if (!file) return;

      const undo = ctx.createUndoSnapshot();
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const candidate = extractImportState(parsed);
        const importedState = ctx.normalizeState(candidate);
        const safetyBackup = createImportSafetyBackup(undo);
        if (safetyBackup?.ok === false) throw new Error("safety-backup-failed");
        ctx.replaceState(importedState);
        ctx.saveState({ skipBackup: true });
        ctx.render();
        ctx.showToast("Данные импортированы. Предыдущие данные сохранены", { undo });
      } catch {
        ctx.showToast("Не удалось импортировать JSON");
      } finally {
        ctx.els.importFile.value = "";
      }
    }

    function syncDesktopBackup() {
      if (!window.rhythmDesktop?.writeFileBackup) return Promise.resolve({ ok: false, reason: "desktop-unavailable" });
      return window.rhythmDesktop
        .writeFileBackup({
          schemaVersion: ctx.schemaVersion,
          state: ctx.getState(),
        })
        .then(async (result) => {
          await updateFileBackupStatus();
          return result || { ok: true };
        })
        .catch(() => {
          if (ctx.els.fileBackupStatus) {
            ctx.els.fileBackupStatus.hidden = false;
            ctx.els.fileBackupStatus.textContent = "Файловый бэкап: ошибка записи";
          }
          return { ok: false, reason: "write-failed" };
        });
    }

    async function updateFileBackupStatus() {
      if (!window.rhythmDesktop?.getFileBackupInfo || !ctx.els.fileBackupStatus || !ctx.els.openBackupFolderButton) return;
      ctx.els.fileBackupStatus.hidden = false;
      ctx.els.openBackupFolderButton.hidden = false;
      try {
        const info = await window.rhythmDesktop.getFileBackupInfo();
        if (info?.latest?.mtimeMs) {
          ctx.els.fileBackupStatus.textContent = `Файловый бэкап: ${formatBackupDate(info.latest.mtimeMs)}`;
        } else {
          ctx.els.fileBackupStatus.textContent = "Файловый бэкап: папка готова";
        }
      } catch {
        ctx.els.fileBackupStatus.textContent = "Файловый бэкап: недоступен";
      }
    }

    async function openBackupFolder() {
      if (!window.rhythmDesktop?.openBackupFolder) {
        ctx.showToast("Папка бэкапов доступна в desktop-версии приложения");
        return { ok: false, reason: "desktop-unavailable" };
      }

      try {
        const result = await window.rhythmDesktop.openBackupFolder();
        ctx.showToast(result?.ok ? "Папка бэкапов открыта" : "Не удалось открыть папку бэкапов");
        return result;
      } catch {
        ctx.showToast("Не удалось открыть папку бэкапов");
        return { ok: false, reason: "open-failed" };
      }
    }

    function createBackup({ payload = null, silent = false, throttle = false } = {}) {
      const result = ctx.storage.createBackup({
        payload,
        state: ctx.getState(),
        throttle,
      });

      if (result.ok) {
        updateBackupStatus();
        if (!silent) ctx.showToast("Локальный бэкап обновлен");
        return result;
      }

      if (!silent && result.reason !== "throttled") ctx.showToast("Не удалось создать бэкап");
      return result;
    }

    function createImportSafetyBackup(snapshot) {
      return ctx.storage.createImportSafetyBackup(snapshot, { schemaVersion: ctx.schemaVersion });
    }

    async function restoreBackup() {
      const backup = loadBackup();
      if (!backup) {
        ctx.showToast("Локальный бэкап пока не найден");
        return;
      }

      const backupDate = backup.exportedAt ? formatBackupDate(backup.exportedAt) : "без даты";
      const message = `Восстановить данные из локального бэкапа (${backupDate})? Текущий план будет заменен.`;
      const confirmed = await ctx.confirmAction({
            confirmLabel: "Восстановить",
            message,
            tone: "danger",
            title: "Восстановить бэкап?",
          });
      if (!confirmed) return;

      const undo = ctx.createUndoSnapshot();
      const safetyBackup = createImportSafetyBackup(undo);
      if (safetyBackup?.ok === false) {
        ctx.showToast("Не удалось сохранить текущее состояние. Восстановление отменено");
        return;
      }
      ctx.replaceState(ctx.normalizeState(backup.state || backup));
      ctx.saveState({ skipBackup: true });
      ctx.render();
      ctx.showToast("Данные восстановлены. Предыдущее состояние сохранено", { undo });
    }

    function loadBackup() {
      return ctx.storage.loadBackup();
    }

    function updateBackupStatus() {
      const backup = loadBackup();
      if (!backup?.exportedAt) {
        ctx.els.backupStatus.textContent = "Бэкап еще не создан";
        return;
      }
      ctx.els.backupStatus.textContent = `Бэкап: ${formatBackupDate(backup.exportedAt)}`;
    }

    function formatBackupDate(value) {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return "без даты";
      return new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    }

    function extractImportState(parsed) {
      const candidate = parsed?.state ?? parsed;
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error("invalid-import");
      }
      const recognizedKeys = [
        "tasks",
        "habits",
        "goals",
        "boardItems",
        "journalEntries",
        "nutritionFoods",
        "nutritionMeals",
        "nutritionTemplates",
        "nutritionSettings",
        "categories",
        "taskOrder",
        "tombstones",
        "syncMeta",
        "schemaVersion",
        "defaultsSeeded",
      ];
      if (!recognizedKeys.some((key) => Object.hasOwn(candidate, key))) throw new Error("unrecognized-import");
      [
        "tasks",
        "habits",
        "goals",
        "boardItems",
        "journalEntries",
        "nutritionFoods",
        "nutritionMeals",
        "nutritionTemplates",
        "categories",
      ].forEach((key) => {
        if (Object.hasOwn(candidate, key) && !Array.isArray(candidate[key])) throw new Error(`invalid-${key}`);
      });
      return candidate;
    }

    return {
      createBackup,
      createImportSafetyBackup,
      exportData,
      formatBackupDate,
      importData,
      loadBackup,
      openBackupFolder,
      restoreBackup,
      syncDesktopBackup,
      updateBackupStatus,
      updateFileBackupStatus,
    };
  }

  const api = { createImportExport };
  global.RhythmImportExport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
