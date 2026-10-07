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
    let lastSave = { bytes: 0, durationMs: 0 };
    let ownerRevision;
    let cachedOwner = "";
    let ownerFromState = false;
    let ownerUiRevision;
    let lastWrittenRevision;
    let schemaRevision;
    let unsupportedState = null;

    function loadState() {
      return readSnapshot().state;
    }

    function readSnapshot() {
      const state = readJson(keys.state, null);
      if (!isState(state)) return { state: null, owner: loadUiState().remoteSyncAccountId || "" };
      const { _localOwner, ...document } = state;
      return { state: document, owner: _localOwner ?? loadUiState().remoteSyncAccountId ?? "" };
    }

    function getOwner() {
      const revision = getRevision();
      const uiRevision = ownerFromState ? ownerUiRevision : storage.getItem(keys.uiState);
      if (revision !== ownerRevision || uiRevision !== ownerUiRevision) {
        const state = readJson(keys.state, null);
        ownerFromState = isState(state) && state._localOwner != null;
        cachedOwner = ownerFromState ? state._localOwner : loadUiState().remoteSyncAccountId || "";
        ownerRevision = revision;
        ownerUiRevision = uiRevision;
      }
      return cachedOwner;
    }

    function getRevision() {
      return storage.getItem(keys.state);
    }

    function loadStateWithRecovery() {
      let raw = null;
      try {
        raw = storage.getItem(keys.state);
        if (!raw) return { state: null, status: "empty" };
        const state = JSON.parse(raw);
        if (!isState(state)) throw new Error("Invalid stored state");
        const { _localOwner, ...document } = state;
        return { state: document, status: isNewerSchema(document) ? "newer" : "ok" };
      } catch (error) {
        try {
          if (raw) storage.setItem(keys.corruptState, raw);
        } catch {}
        let owner = "";
        try { owner = getOwner(); } catch {}
        const backup = loadBackup({ owner });
        const recoveredState = isState(backup?.state) ? backup.state : null;
        if (!recoveredState) return { error, state: null, status: "corrupt" };
        if (isNewerSchema(backup)) return { error, state: null, status: "corrupt", reason: "newer-backup" };
        try {
          writeJson(keys.state, { ...recoveredState, _localOwner: owner });
        } catch (writeError) {
          return { error, state: recoveredState, status: "recovered-memory", writeError };
        }
        return { error, state: recoveredState, status: "recovered" };
      }
    }

    function saveState(state, saveOptions = {}) {
      if (!isState(state)) throw new Error("Invalid state");
      if (getUnsupportedState()) throw Object.assign(new Error("Update the application before saving this workspace"), { code: "client-outdated" });
      const nextState = {
        ...state,
        schemaVersion: saveOptions.schemaVersion || schemaVersion,
      };
      const previous = !saveOptions.skipBackup && Date.now() - lastBackupAt >= 60000 ? readSnapshot() : null;
      const started = global.performance?.now?.() || Date.now();
      const encoded = JSON.stringify({ ...nextState, _localOwner: Object.hasOwn(saveOptions, "owner") ? saveOptions.owner || "" : getOwner() });
      storage.setItem(keys.state, encoded);
      lastWrittenRevision = encoded;
      schemaRevision = encoded;
      unsupportedState = null;
      ownerRevision = encoded;
      ownerFromState = true;
      cachedOwner = Object.hasOwn(saveOptions, "owner") ? saveOptions.owner || "" : cachedOwner;
      lastSave = { bytes: new TextEncoder().encode(encoded).byteLength, durationMs: Math.round(((global.performance?.now?.() || Date.now()) - started) * 100) / 100 };

      if (!saveOptions.skipBackup && previous?.state) {
        createBackup({
          state: previous.state,
          owner: previous.owner,
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

    function createBackup({ payload = null, state = null, throttle = false, now = Date.now(), owner } = {}) {
      if (throttle && now - lastBackupAt < 60000) {
        return { ok: false, reason: "throttled" };
      }
      try { owner ??= getOwner(); } catch (error) { return { ok: false, error }; }

      const backup = {
        ...(payload || {
          app: appName,
          schemaVersion,
          exportedAt: new Date(now).toISOString(),
          state,
        }),
        _localOwner: owner,
      };

      if (!isState(backup.state) || typeof owner !== "string") return { ok: false, reason: "invalid-state" };
      if (getUnsupportedState() && !isNewerSchema(backup.state)) return { ok: false, reason: "client-outdated" };

      try {
        writeJson(keys.backup, backup);
        lastBackupAt = now;
        return { ok: true, backup };
      } catch (error) {
        return { ok: false, error };
      }
    }

    function loadBackup({ owner } = {}) {
      try { owner ??= getOwner(); } catch { return null; }
      const backup = readJson(keys.backup, null);
      if (!backup || !isState(backup.state)) return null;
      // Untagged old copies cannot safely be assigned to a signed-in account.
      if ((backup._localOwner ?? "") !== owner) return null;
      return backup;
    }

    function createImportSafetyBackup(snapshot, backupOptions = {}) {
      if (!snapshot?.state) return { ok: false, reason: "empty-snapshot" };
      if (getUnsupportedState()) return { ok: false, reason: "client-outdated" };

      try {
        const backup = {
          app: appName,
          schemaVersion: backupOptions.schemaVersion || schemaVersion,
          reason: "before-import",
          _localOwner: getOwner(),
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

    function isNewerSchema(value) {
      return Math.max(Number(value?.schemaVersion) || 0, Number(value?.state?.schemaVersion) || 0) > schemaVersion;
    }

    function getUnsupportedState() {
      let raw;
      try { raw = getRevision(); } catch { return null; }
      if (raw === schemaRevision) return unsupportedState;
      let stored;
      try { stored = JSON.parse(raw); } catch {}
      if (!isState(stored)) {
        const backup = loadBackup();
        return backup && isNewerSchema(backup) ? backup.state : null;
      }
      schemaRevision = raw;
      unsupportedState = null;
      if (!isNewerSchema(stored)) return null;
      const { _localOwner, ...document } = stored;
      unsupportedState = document;
      return unsupportedState;
    }

    function writeJson(key, value) {
      storage.setItem(key, JSON.stringify(value));
    }

    return {
      keys,
      getOwner,
      getRevision,
      getSavedRevision: () => lastWrittenRevision,
      getUnsupportedState,
      getDiagnostics: () => ({ ...lastSave }),
      createBackup,
      createImportSafetyBackup,
      loadBackup,
      loadState,
      readSnapshot,
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
