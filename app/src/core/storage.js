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
      const state = readJson(keys.state, null);
      return isState(state) ? state : null;
    }

    function loadStateWithRecovery() {
      let raw = null;
      try {
        raw = storage.getItem(keys.state);
        if (!raw) return { state: null, status: "empty" };
        const state = JSON.parse(raw);
        if (!isState(state)) throw new Error("Invalid stored state");
        return { state, status: "ok" };
      } catch (error) {
        try {
          if (raw) storage.setItem(keys.corruptState, raw);
        } catch {}
        const backup = loadBackup();
        const recoveredState = isState(backup?.state) ? backup.state : null;
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
      if (!isState(state)) throw new Error("Invalid state");
      const nextState = {
        ...state,
        schemaVersion: saveOptions.schemaVersion || schemaVersion,
      };
      const previousState = loadState();
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

      if (!isState(backup.state)) return { ok: false, reason: "invalid-state" };

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
      if (!backup || !isState(backup.state)) return null;
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
        if (!isState(backup.state)) throw new Error("Invalid safety backup state");
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

  function isState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return ["tasks", "habits", "goals", "categories", "notes", "boardItems", "journalEntries", "studySubjects", "studyLessons", "studyFiles"]
      .every((key) => !Object.hasOwn(value, key) || Array.isArray(value[key]));
  }

  const api = { createLocalStorageAdapter, DEFAULT_KEYS };
  global.RhythmStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
