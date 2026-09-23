const assert = require("node:assert/strict");
const { createRemoteSyncWorkflow } = require("../src/sync/remote-sync-controller.js");

module.exports = [
  {
    name: "reloads and merges once when a remote write revision conflicts",
    async fn() {
      let pulls = 0;
      let pushes = 0;
      let state = { tasks: [{ id: "local" }] };
      const workflow = createRemoteSyncWorkflow({
        createImportSafetyBackup() {},
        createUndoSnapshot: () => ({ state: "local" }),
        describeError: (error) => error.message,
        formatDate: (value) => value,
        getLocalUpdatedAt: () => "2026-07-13T09:00:00.000Z",
        getRemoteUiSettings: () => ({}),
        getSettings: () => ({ accessToken: "jwt", enabled: true, anonKey: "anon", supabaseUrl: "url", userId: "user" }),
        getState: () => state,
        getSyncMeta: () => ({ lastPulledAt: "", lastPushedAt: "" }),
        isRemoteVersionNewer: () => true,
        latestIsoDate: (...values) => values.filter(Boolean).sort().at(-1) || "",
        mergeStates: (local, remote) => ({ tasks: [...local.tasks.filter((task) => task.id === "local"), ...remote.tasks] }),
        remoteSync: {
          normalizeConfig: (config) => config,
          isConfigured: (config) => config.enabled,
          pullState: async () => {
            pulls += 1;
            return {
              found: true,
              state: { tasks: [{ id: `remote-${pulls}` }] },
              updatedAt: `2026-07-13T10:00:0${pulls}.000Z`,
            };
          },
          pushState: async () => {
            pushes += 1;
            if (pushes === 1) throw Object.assign(new Error("conflict"), { code: "sync-conflict" });
            return { row: { updated_at: "2026-07-13T10:00:03.000Z" } };
          },
        },
        render() {},
        renderSaveStatus() {},
        replaceState: (nextState) => { state = nextState; },
        saveState() {},
        saveUiState() {},
        schemaVersion: 10,
        setSyncMeta() {},
        showToast() {},
        statusElement: { textContent: "" },
        syncControls() {},
      });

      await workflow.push({ silent: true });

      assert.equal(pulls, 2);
      assert.equal(pushes, 2);
      assert.deepEqual(state.tasks.map((task) => task.id), ["local", "remote-2"]);
      assert.equal(workflow.getStatus().lastError, "");
    },
  },
  {
    name: "merges a newer remote snapshot during automatic sync",
    async fn() {
      let enabled = true;
      let replaced = null;
      let safety = null;
      const workflow = createRemoteSyncWorkflow({
        createImportSafetyBackup: (snapshot) => { safety = snapshot; },
        createUndoSnapshot: () => ({ state: "local" }),
        describeError: (error) => error.message,
        formatDate: (value) => value,
        getLocalUpdatedAt: () => "2026-07-12T00:00:00.000Z",
        getRemoteUiSettings: () => ({}),
        getSettings: () => ({ accessToken: "jwt", enabled, anonKey: "anon", supabaseUrl: "url", userId: "user" }),
        getState: () => ({ tasks: [{ id: "local" }] }),
        getSyncMeta: () => ({ lastPulledAt: "", lastPushedAt: "" }),
        isRemoteVersionNewer: () => true,
        latestIsoDate: () => "",
        mergeStates: () => ({ tasks: [{ id: "merged" }] }),
        remoteSync: {
          normalizeConfig: (config) => config,
          isConfigured: (config) => config.enabled,
          pullState: async () => {
            enabled = false;
            return { found: true, clientUpdatedAt: "2026-07-13T00:00:00.000Z", state: { tasks: [{ id: "remote" }] } };
          },
        },
        render() {},
        renderSaveStatus() {},
        replaceState: (state) => { replaced = state; },
        saveState() {},
        saveUiState() {},
        schemaVersion: 9,
        setSyncMeta() {},
        showToast() {},
        statusElement: { textContent: "" },
        syncControls() {},
      });

      const result = await workflow.syncLatest({ silent: true });
      assert.equal(result.changed, true);
      assert.deepEqual(replaced, { tasks: [{ id: "merged" }] });
      assert.deepEqual(safety, { state: "local" });
    },
  },
  {
    name: "merges another device before an automatic push",
    async fn() {
      let state = { tasks: [{ id: "local" }] };
      let pushedState = null;
      let lastPushedAt = "";
      const workflow = createRemoteSyncWorkflow({
        createImportSafetyBackup() {},
        createUndoSnapshot: () => ({ state: "local" }),
        describeError: (error) => error.message,
        formatDate: (value) => value,
        getLocalUpdatedAt: () => "2026-07-13T09:00:00.000Z",
        getRemoteUiSettings: () => ({}),
        getSettings: () => ({ accessToken: "jwt", enabled: true, anonKey: "anon", supabaseUrl: "url", userId: "user" }),
        getState: () => state,
        getSyncMeta: () => ({ lastPulledAt: "", lastPushedAt: "" }),
        isRemoteVersionNewer: () => true,
        latestIsoDate: (...values) => values.filter(Boolean).sort().at(-1) || "",
        mergeStates: () => ({ tasks: [{ id: "local" }, { id: "remote" }] }),
        remoteSync: {
          normalizeConfig: (config) => config,
          isConfigured: (config) => config.enabled,
          pullState: async () => ({
            found: true,
            clientUpdatedAt: "2026-07-13T10:00:00.000Z",
            state: { tasks: [{ id: "remote" }] },
          }),
          pushState: async (_config, payload) => {
            pushedState = payload.state;
            return { row: { updated_at: "2026-07-13T10:00:01.000Z" } };
          },
        },
        render() {},
        renderSaveStatus() {},
        replaceState: (nextState) => { state = nextState; },
        saveState() {},
        saveUiState() {},
        schemaVersion: 9,
        setSyncMeta: (meta) => { lastPushedAt = meta.lastPushedAt || lastPushedAt; },
        showToast() {},
        statusElement: { textContent: "" },
        syncControls() {},
      });

      await workflow.push({ silent: true });

      assert.deepEqual(pushedState, { tasks: [{ id: "local" }, { id: "remote" }] });
      assert.equal(lastPushedAt, "2026-07-13T10:00:01.000Z");
      assert.equal(workflow.getStatus().lastError, "");
    },
  },
  {
    name: "resumes a persisted pending upload after restart",
    async fn() {
      let pending = true;
      let pushes = 0;
      const workflow = createRemoteSyncWorkflow({
        createImportSafetyBackup() {},
        createUndoSnapshot: () => ({ state: "{}" }),
        describeError: (error) => error.message,
        formatDate: (value) => value,
        getLocalUpdatedAt: () => "2026-07-17T08:00:00.000Z",
        getRemoteUiSettings: () => ({}),
        getSettings: () => ({ accessToken: "jwt", enabled: true, anonKey: "anon", supabaseUrl: "url", userId: "user" }),
        getState: () => ({ tasks: [{ id: "offline-change" }] }),
        getSyncMeta: () => ({ lastPulledAt: "", lastPushedAt: "", pending }),
        isRemoteVersionNewer: () => false,
        latestIsoDate: (...values) => values.filter(Boolean).sort().at(-1) || "",
        mergeStates: (local) => local,
        remoteSync: {
          normalizeConfig: (config) => config,
          isConfigured: (config) => config.enabled,
          pullState: async () => ({ found: false }),
          pushState: async () => {
            pushes += 1;
            return { row: { updated_at: "2026-07-17T08:00:01.000Z" } };
          },
        },
        render() {},
        renderSaveStatus() {},
        replaceState() {},
        saveState() {},
        saveUiState() {},
        schemaVersion: 12,
        setSyncMeta: (meta) => {
          if (typeof meta.pending === "boolean") pending = meta.pending;
        },
        showToast() {},
        statusElement: { textContent: "" },
        syncControls() {},
      });

      await workflow.resumePending();

      assert.equal(pushes, 1);
      assert.equal(pending, false);
      assert.equal(workflow.getStatus().pending, false);
    },
  },
  {
    name: "remembers local changes even before an account is connected",
    fn() {
      let pending = false;
      const workflow = createRemoteSyncWorkflow({
        getSettings: () => ({ enabled: true, anonKey: "anon", supabaseUrl: "url" }),
        getSyncMeta: () => ({ pending }),
        remoteSync: {
          normalizeConfig: (config) => config,
          isConfigured: () => false,
        },
        saveUiState() {},
        setSyncMeta: (meta) => {
          if (typeof meta.pending === "boolean") pending = meta.pending;
        },
        statusElement: { textContent: "" },
        syncControls() {},
      });

      workflow.schedulePush();

      assert.equal(pending, true);
      assert.equal(workflow.getStatus().pending, true);
    },
  },
  {
    name: "cancels pending uploads before switching accounts",
    async fn() {
      let pending = false;
      let pushes = 0;
      const workflow = createRemoteSyncWorkflow({
        getSettings: () => ({ accessToken: "jwt", enabled: true, anonKey: "anon", supabaseUrl: "url", userId: "user" }),
        getSyncMeta: () => ({ pending }),
        remoteSync: {
          normalizeConfig: (config) => config,
          isConfigured: () => true,
          pushState: async () => { pushes += 1; },
        },
        saveUiState() {},
        setSyncMeta: (meta) => {
          if (typeof meta.pending === "boolean") pending = meta.pending;
        },
        statusElement: { textContent: "" },
        syncControls() {},
      });

      workflow.schedulePush();
      workflow.resetQueue();
      await new Promise((resolve) => setTimeout(resolve, 20));

      assert.equal(pushes, 0);
      assert.equal(pending, false);
      assert.equal(workflow.getStatus().pending, false);
    },
  },
  {
    name: "flushes a queued local change after another sync operation finishes",
    async fn() {
      let pending = false;
      let pushes = 0;
      let releaseCheck;
      const checkGate = new Promise((resolve) => { releaseCheck = resolve; });
      const workflow = createRemoteSyncWorkflow({
        createImportSafetyBackup: () => ({ ok: true }),
        createUndoSnapshot: () => ({ state: "{}" }),
        describeError: (error) => error.message,
        formatDate: (value) => value,
        getLocalUpdatedAt: () => "2026-07-19T08:00:00.000Z",
        getRemoteUiSettings: () => ({}),
        getSettings: () => ({ accessToken: "jwt", enabled: true, anonKey: "anon", supabaseUrl: "url", userId: "user" }),
        getState: () => ({ tasks: [{ id: "changed" }] }),
        getSyncMeta: () => ({ lastPulledAt: "", lastPushedAt: "", pending }),
        isRemoteVersionNewer: () => false,
        latestIsoDate: (...values) => values.filter(Boolean).sort().at(-1) || "",
        mergeStates: (local) => local,
        remoteSync: {
          normalizeConfig: (config) => config,
          isConfigured: (config) => config.enabled,
          checkConnection: async () => {
            await checkGate;
            return { found: false };
          },
          pullState: async () => ({ found: false }),
          pushState: async () => {
            pushes += 1;
            return { row: { updated_at: "2026-07-19T08:00:01.000Z" } };
          },
        },
        render() {},
        renderSaveStatus() {},
        replaceState() {},
        saveState() {},
        saveUiState() {},
        schemaVersion: 12,
        setSyncMeta: (meta) => {
          if (typeof meta.pending === "boolean") pending = meta.pending;
        },
        showToast() {},
        statusElement: { textContent: "" },
        syncControls() {},
      });

      const checkPromise = workflow.check();
      workflow.schedulePush();
      const queued = await workflow.push({ silent: true });
      assert.deepEqual(queued, { queued: true });
      releaseCheck();
      await checkPromise;
      await new Promise((resolve) => setTimeout(resolve, 20));

      assert.equal(pushes, 1);
      assert.equal(pending, false);
      assert.equal(workflow.getStatus().pending, false);
    },
  },
];
