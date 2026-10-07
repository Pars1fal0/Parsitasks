const assert = require("node:assert/strict");
const { createMemoryStorage, storageApi } = require("./test-utils.cjs");

module.exports = [
  {
    name: "newer local workspaces remain intact and cannot be overwritten or backed up through an older normalizer",
    fn() {
      const memory = createMemoryStorage();
      const adapter = storageApi.createLocalStorageAdapter({ storage: memory, schemaVersion: 7 });
      const state = { schemaVersion: 8, tasks: [{ id: "safe" }], futureFeature: { keep: true }, _localOwner: "account" };
      const raw = JSON.stringify(state);
      memory.setItem(adapter.keys.state, raw);
      assert.equal(adapter.loadStateWithRecovery().status, "newer");
      assert.equal(adapter.getUnsupportedState().futureFeature.keep, true);
      assert.throws(() => adapter.saveState({ tasks: [] }), (error) => error.code === "client-outdated");
      assert.equal(adapter.createBackup({ state: { schemaVersion: 7, tasks: [] } }).reason, "client-outdated");
      assert.equal(adapter.createImportSafetyBackup({ state: '{"tasks":[]}' }).reason, "client-outdated");
      assert.equal(memory.getItem(adapter.keys.state), raw);
      assert.equal(adapter.createBackup({ state: adapter.getUnsupportedState() }).ok, true);
      assert.equal(adapter.loadBackup().state.futureFeature.keep, true);
    },
  },
  {
    name: "automatic recovery refuses a backup from a newer schema without replacing the corrupt source",
    fn() {
      const memory = createMemoryStorage();
      const adapter = storageApi.createLocalStorageAdapter({ storage: memory, schemaVersion: 7 });
      memory.setItem(adapter.keys.state, "{broken");
      memory.setItem(adapter.keys.backup, JSON.stringify({ schemaVersion: 8, state: { schemaVersion: 8, tasks: [] } }));
      const result = adapter.loadStateWithRecovery();
      assert.equal(result.status, "corrupt");
      assert.equal(result.reason, "newer-backup");
      assert.equal(adapter.getUnsupportedState().schemaVersion, 8);
      assert.throws(() => adapter.saveState({ tasks: [] }), (error) => error.code === "client-outdated");
      assert.equal(memory.getItem(adapter.keys.state), "{broken");
    },
  },
  {
    name: "backup ownership prevents restoration into another account and survives corrupt-state recovery",
    fn() {
      const memory = createMemoryStorage();
      const adapter = storageApi.createLocalStorageAdapter({ storage: memory });
      const state = { tasks: [{ id: "first-account" }] };
      adapter.saveState(state, { owner: "first", skipBackup: true });
      adapter.createBackup({ state });
      assert.equal(adapter.loadBackup()._localOwner, "first");
      assert.equal(adapter.loadBackup({ owner: "second" }), null);
      adapter.saveUiState({ remoteSyncAccountId: "second" });
      memory.setItem(adapter.keys.state, "{broken");
      assert.equal(adapter.loadStateWithRecovery().status, "corrupt");
      assert.equal(memory.getItem(adapter.keys.state), "{broken");
      adapter.saveUiState({ remoteSyncAccountId: "first" });
      assert.equal(adapter.loadStateWithRecovery().status, "recovered");
      assert.equal(adapter.getOwner(), "first");
      assert.deepEqual(adapter.loadState(), state);
    },
  },
  {
    name: "legacy ownerless backups remain recoverable locally but are not silently assigned to an account",
    fn() {
      const memory = createMemoryStorage();
      const adapter = storageApi.createLocalStorageAdapter({ storage: memory });
      const raw = JSON.stringify({ state: { tasks: [{ id: "legacy" }] } });
      memory.setItem(adapter.keys.backup, raw);
      assert.ok(adapter.loadBackup());
      adapter.saveUiState({ remoteSyncAccountId: "account" });
      assert.equal(adapter.loadBackup(), null);
      assert.equal(memory.getItem(adapter.keys.backup), raw);
    },
  },
  {
    name: "automatic backup records the previous workspace owner when a new account replaces it",
    fn() {
      const memory = createMemoryStorage();
      const adapter = storageApi.createLocalStorageAdapter({ storage: memory });
      adapter.saveState({ tasks: [{ id: "first" }] }, { owner: "first", skipBackup: true });
      adapter.saveState({ tasks: [{ id: "second" }] }, { owner: "second" });
      assert.equal(adapter.loadBackup(), null);
      assert.equal(adapter.loadBackup({ owner: "first" })._localOwner, "first");
      assert.equal(adapter.loadBackup({ owner: "first" }).state.tasks[0].id, "first");
      adapter.createImportSafetyBackup({ state: JSON.stringify({ tasks: [] }), userId: "unexpected" });
      assert.equal(JSON.parse(memory.getItem(adapter.keys.importSafetyBackup))._localOwner, "second");
    },
  },
  {
    name: "legacy ownership follows UI account changes without rewriting the workspace",
    fn() {
      const memoryStorage = createMemoryStorage();
      const storage = storageApi.createLocalStorageAdapter({ storage: memoryStorage });
      memoryStorage.setItem(storage.keys.state, JSON.stringify({ tasks: [] }));
      storage.saveUiState({ remoteSyncAccountId: "first" });
      assert.equal(storage.getOwner(), "first");
      storage.saveUiState({ remoteSyncAccountId: "second" });
      assert.equal(storage.getOwner(), "second");
      storage.saveState({ tasks: [] }, { owner: "explicit", skipBackup: true });
      storage.saveUiState({ remoteSyncAccountId: "third" });
      assert.equal(storage.getOwner(), "explicit");
    },
  },
  {
    name: "adapter saves state, ui state, backups, and import safety backup",
    fn() {
      const memoryStorage = createMemoryStorage();
      const storage = storageApi.createLocalStorageAdapter({
        storage: memoryStorage,
        schemaVersion: 7,
      });

      storage.saveUiState({ taskSearchQuery: "дом" });
      assert.deepEqual(storage.loadUiState(), { taskSearchQuery: "дом" });

      const state = storage.saveState({ tasks: [], habits: [], goals: [], categories: [] }, { schemaVersion: 7, skipBackup: true });
      assert.equal(state.schemaVersion, 7);
      assert.equal(storage.loadState().schemaVersion, 7);
      assert.deepEqual(storage.loadStateWithRecovery(), { state, status: "ok" });

      assert.equal(storage.createBackup({ state, now: 100000 }).ok, true);
      assert.equal(storage.createBackup({ state, now: 100100, throttle: true }).reason, "throttled");
      assert.equal(storage.loadBackup().state.schemaVersion, 7);

      const safety = storage.createImportSafetyBackup({ state: JSON.stringify(state) }, { schemaVersion: 7 });
      assert.equal(safety.ok, true);
      assert.equal(JSON.parse(memoryStorage.getItem(storage.keys.importSafetyBackup)).reason, "before-import");
    },
  },
  {
    name: "archives corrupt state and restores the latest valid backup",
    fn() {
      const memoryStorage = createMemoryStorage();
      const storage = storageApi.createLocalStorageAdapter({
        storage: memoryStorage,
        schemaVersion: 7,
      });
      const backupState = { schemaVersion: 7, tasks: [{ id: "safe" }] };
      memoryStorage.setItem(storage.keys.state, "{broken");
      memoryStorage.setItem(storage.keys.backup, JSON.stringify({ state: backupState }));

      const result = storage.loadStateWithRecovery();

      assert.equal(result.status, "recovered");
      assert.deepEqual(result.state, backupState);
      assert.equal(memoryStorage.getItem(storage.keys.corruptState), "{broken");
      assert.deepEqual(JSON.parse(memoryStorage.getItem(storage.keys.state)), { ...backupState, _localOwner: "" });
    },
  },
  {
    name: "keeps the previous valid state as the automatic undo backup",
    fn() {
      const memoryStorage = createMemoryStorage();
      const storage = storageApi.createLocalStorageAdapter({ storage: memoryStorage, schemaVersion: 7 });
      storage.saveState({ tasks: [{ id: "before" }] }, { skipBackup: true });
      storage.saveState({ tasks: [{ id: "after" }] });

      assert.deepEqual(storage.loadBackup().state.tasks, [{ id: "before" }]);
      assert.deepEqual(storage.loadState().tasks, [{ id: "after" }]);
    },
  },
];
