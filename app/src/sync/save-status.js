(function (global) {
  function createSaveStatus(options = {}) {
    function render(state = {}) {
      if (!options.element) return "";
      const message = getMessage(state);
      options.element.textContent = message;
      options.element.dataset.state = getStateCode(state);
      return message;
    }

    function getMessage(state = {}) {
      if (state.localStorageError) return state.localStorageError;
      if (state.online === false) return state.remoteEnabled
        ? "Нет связи · сохранено на устройстве, синхронизируем позже"
        : "Нет связи · сохранено на устройстве";
      if (state.remoteEnabled && state.syncStatus?.lastError) return "Сохранено на устройстве · не удалось синхронизировать";
      if (state.remoteEnabled && state.syncStatus?.inFlight) return "Сохранено на устройстве · синхронизация…";
      if (state.remoteEnabled && state.syncStatus?.pending) {
        return "Сохранено на устройстве · ожидает синхронизации";
      }
      if (state.remoteEnabled && state.remoteLastPushedAt) {
        const syncedAt = new Date(state.remoteLastPushedAt);
        if (!Number.isNaN(syncedAt.getTime())) {
          return `Синхронизировано ${options.formatTime(options.toTimeValue(syncedAt))}`;
        }
      }
      if (!state.localUpdatedAt) return "Сохранено на устройстве";
      const savedAt = new Date(state.localUpdatedAt);
      if (Number.isNaN(savedAt.getTime())) return "Сохранено на устройстве";
      return `Сохранено на устройстве ${options.formatTime(options.toTimeValue(savedAt))}`;
    }

    function getStateCode(state = {}) {
      if (state.localStorageError) return "error";
      if (state.online === false) return "offline";
      if (state.remoteEnabled && state.syncStatus?.lastError) return "error";
      if (state.remoteEnabled && state.syncStatus?.inFlight) return "syncing";
      if (state.remoteEnabled && state.syncStatus?.pending) return "pending";
      if (state.remoteEnabled && state.remoteLastPushedAt) return "synced";
      return "local";
    }

    function describeRemoteError(error) {
      if (error?.code === "clock-skew") return "проверь дату и время на устройстве";
      if (error?.code === "client-outdated") return "обнови приложение · облачные данные созданы более новой версией, локальные записи сохранены";
      if (error?.code === "workspace-too-large") return "объём данных превышает лимит облака · локальные записи сохранены, экспортируй JSON";
      if (error?.code === "request-timeout") return "сервер не ответил вовремя · повтори синхронизацию";
      if (error?.code === "local-save-failed") return "нет места на устройстве · экспортируй данные и освободи хранилище";
      if (error?.status === 401) return "сессия истекла · войди в аккаунт снова";
      if (error?.status === 403) return "доступ к данным запрещён · проверь аккаунт";
      if (error?.status === 404) return "таблица rhythm_states не создана";
      const message = String(error?.message || "").trim();
      if (/failed to fetch|network|load failed/i.test(message)) return "нет сети или Supabase URL недоступен";
      return message || "неизвестная ошибка";
    }

    return { describeRemoteError, getMessage, getStateCode, render };
  }

  const api = { createSaveStatus };
  global.RhythmSaveStatus = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
