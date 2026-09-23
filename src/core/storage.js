(function (global) {
  const DEFAULT_KEYS = {
    state: "rhythm-day-state-v1",
    uiState: "rhythm-day-ui-v1",
    backup: "rhythm-day-backup-v1",
    corruptState: "rhythm-day-corrupt-state-v1",
    importSafetyBackup: "rhythm-day-import-safety-backup-v1",
  };

  function createLocalStorageAdapter(options = {}) {
    const storage = options.storage || global.localStorage;
    const keys = { ...DEFAULT_KEYS, ...(options.keys || {}) };
    const appName = options.appName || "Parsitasks";
    const schemaVersion = options.schemaVersion || 1;
    let lastBackupAt = 0;

    function loadState() {
      return readJson(keys.state, null);
    }

    function loadStateWithRecovery() {
      let raw = null;
      try {
        raw = storage.getItem(keys.state);
        if (!raw) return { state: null, status: "empty" };
        return { state: JSON.parse(raw), status: "ok" };
      } catch (error) {
        try {
          if (raw) storage.setItem(keys.corruptState, raw);
        } catch {}
        const backup = loadBackup();
        const recoveredState = backup?.state && typeof backup.state === "object" ? backup.state : null;
        if (!recoveredState) return { error, state: null, status: "corrupt" };
        try {
          writeJson(keys.state, recoveredState);
        } catch (writeError) {
          return { error, state: recoveredState, status: "recovered-memory", writeError };
        }
        return { error, state: recoveredState, status: "recovered" };
      }
    }

    function saveState(state, saveOptions = {}) {
      const nextState = {
        ...state,
        schemaVersion: saveOptions.schemaVersion || schemaVersion,
      };
      const previousState = readJson(keys.state, null);
      writeJson(keys.state, nextState);

      if (!saveOptions.skipBackup && previousState && typeof previousState === "object") {
        createBackup({
          state: previousState,
          schemaVersion: saveOptions.schemaVersion || schemaVersion,
          silent: true,
          throttle: true,
        });
      }

      return nextState;
    }

    function loadUiState() {
      return readJson(keys.uiState, {});
    }

    function saveUiState(uiState) {
      writeJson(keys.uiState, uiState || {});
    }

    function createBackup({ payload = null, state = null, throttle = false, now = Date.now() } = {}) {
      if (throttle && now - lastBackupAt < 60000) {
        return { ok: false, reason: "throttled" };
      }

      const backup =
        payload ||
        {
          app: appName,
          schemaVersion,
          exportedAt: new Date(now).toISOString(),
          state,
        };

      try {
        writeJson(keys.backup, backup);
        lastBackupAt = now;
        return { ok: true, backup };
      } catch (error) {
        return { ok: false, error };
      }
    }

    function loadBackup() {
      const backup = readJson(keys.backup, null);
      if (!backup || typeof backup !== "object") return null;
      return backup;
    }

    function createImportSafetyBackup(snapshot, backupOptions = {}) {
      if (!snapshot?.state) return { ok: false, reason: "empty-snapshot" };

      try {
        const backup = {
          app: appName,
          schemaVersion: backupOptions.schemaVersion || schemaVersion,
          reason: "before-import",
          exportedAt: new Date().toISOString(),
          state: JSON.parse(snapshot.state),
        };
        writeJson(keys.importSafetyBackup, backup);
        return { ok: true, backup };
      } catch (error) {
        return { ok: false, error };
      }
    }

    function readJson(key, fallback) {
      try {
        const value = storage.getItem(key);
        return value ? JSON.parse(value) : fallback;
      } catch {
        return fallback;
      }
    }

    function writeJson(key, value) {
      storage.setItem(key, JSON.stringify(value));
    }

    return {
      keys,
      createBackup,
      createImportSafetyBackup,
      loadBackup,
      loadState,
      loadStateWithRecovery,
      loadUiState,
      saveState,
      saveUiState,
    };
  }

  const api = { createLocalStorageAdapter, DEFAULT_KEYS };
  global.RhythmStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
