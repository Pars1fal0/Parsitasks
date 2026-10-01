const assert = require("node:assert/strict");
const { createRemoteSyncWorkflow } = require("../app/src/sync/remote-sync-controller.js");
const { createRemoteSync } = require("../app/src/sync/remote-sync.js");
const { createRemoteDataController } = require("../app/src/sync/remote-data-controller.js");
const { createImportExport } = require("../app/src/settings/import-export.js");
const { createRemoteAuth, SESSION_KEY } = require("../app/src/auth/remote-auth.js");
const { createDeviceSyncController } = require("../app/src/sync/device-sync-controller.js");
const { createMemoryStorage, storageApi } = require("./test-utils.cjs");
const { installDom } = require("./dom-test-utils.cjs");

function gate() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const config = { accessToken: "test-token", anonKey: "test-key", enabled: true, supabaseUrl: "https://demo.supabase.co", userId: "account-a" };
const remote = { found: true, updatedAt: "2026-10-01T08:00:00.000Z", state: { tasks: [{ id: "remote" }] } };
const response = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });

function fixture() {
  const data = { config: { ...config }, state: { tasks: [{ id: "local" }] }, meta: { pending: true }, messages: [], pushed: [] };
  const ctx = {
    getSettings: () => data.config, getState: () => data.state, getSyncMeta: () => data.meta,
    setSyncMeta: (value) => Object.assign(data.meta, value),
    replaceState: (value) => { data.state = value; },
    createUndoSnapshot: () => ({ state: JSON.stringify(data.state) }),
    createImportSafetyBackup: () => ({ ok: true }),
    getRemoteUiSettings: () => ({}), getLocalUpdatedAt: () => data.localVersion || "local-v1",
    mergeStates: (a, b) => ({ tasks: [...a.tasks, ...b.tasks] }),
    latestIsoDate: (...values) => values.filter(Boolean).sort().at(-1), isRemoteVersionNewer: () => true,
    confirmAction: async () => true, describeError: (error) => error.message, formatDate: (value) => value,
    render() {}, renderSaveStatus() {}, saveState() {}, saveUiState() {}, syncControls() {},
    showToast: (message) => data.messages.push(message), statusElement: { textContent: "" }, schemaVersion: 26,
    remoteSync: {
      normalizeConfig: (value) => ({ ...value }), isConfigured: (value) => Boolean(value.enabled && value.userId),
      pullState: async () => ({ found: false }),
      pushState: async (owner, payload) => { data.pushed.push({ owner, payload }); return { row: { updated_at: remote.updatedAt } }; },
    },
  };
  return { data, ctx };
}

module.exports = [
  {
    name: "workspace ownership blocks uploads while another account is still being loaded",
    async fn() {
      const { data, ctx } = fixture(); ctx.isWorkspaceReady = () => false;
      const workflow = createRemoteSyncWorkflow(ctx); await workflow.push();
      assert.equal(data.pushed.length, 0); assert.equal(workflow.isReady(), false);
    },
  },
  {
    name: "cloud restore reports a local write failure without replacing the previous workspace in memory",
    async fn() {
      const document = installDom(); const { data, ctx } = fixture(); let marked = false;
      ctx.els = { remoteSnapshotSelect: document.createElement("select") }; ctx.els.remoteSnapshotSelect.value = "7";
      ctx.getConfig = () => data.config; ctx.isReady = () => true;
      ctx.saveState = () => false; ctx.afterSnapshotRestored = () => { marked = true; };
      ctx.remoteSync.restoreSnapshot = async () => ({ snapshot: { state: remote.state } });
      await createRemoteDataController(ctx).restoreSelectedSnapshot();
      assert.deepEqual(data.state.tasks, [{ id: "local" }]); assert.equal(marked, false);
      assert.match(data.messages.at(-1), /Облако восстановлено, но/);
    },
  },
  {
    name: "failure to reload snapshot history does not falsely report that restoration failed",
    async fn() {
      const document = installDom(); const { data, ctx } = fixture();
      ctx.els = { remoteSnapshotSelect: document.createElement("select") }; ctx.els.remoteSnapshotSelect.value = "7";
      ctx.getConfig = () => data.config; ctx.isReady = () => true;
      ctx.remoteSync.restoreSnapshot = async () => ({ snapshot: { state: remote.state } });
      ctx.remoteSync.listSnapshots = async () => { throw new Error("Offline"); };
      await createRemoteDataController(ctx).restoreSelectedSnapshot();
      assert.deepEqual(data.state.tasks, [{ id: "remote" }]);
      assert.match(data.messages.at(-1), /Версия восстановлена, но список/);
    },
  },
  {
    name: "an auth validation response cannot overwrite a later account sign-in",
    async fn() {
      const memory = createMemoryStorage(); const delayed = gate();
      memory.setItem(SESSION_KEY, JSON.stringify({ access_token: "jwt-a", user: { id: "a" } }));
      const auth = createRemoteAuth({ storage: memory, getConfig: () => config,
        fetch: (url) => url.endsWith("/user") ? delayed.promise : Promise.resolve(response({ access_token: "jwt-b", user: { id: "b" } })) });
      const validate = auth.validateSession(); await Promise.resolve(); await auth.signIn("b@example.test", "password");
      delayed.resolve(response({ id: "a" })); await validate;
      assert.equal(auth.getSession().user.id, "b");
    },
  },
  {
    name: "signing out invalidates an earlier sign-in request even when no session existed yet",
    async fn() {
      const delayed = gate(); const auth = createRemoteAuth({ storage: createMemoryStorage(), getConfig: () => config, fetch: () => delayed.promise });
      const login = auth.signIn("a@example.test", "password"); await auth.signOut();
      delayed.resolve(response({ access_token: "late", user: { id: "a" } }));
      await assert.rejects(login, /Состояние входа изменилось/); assert.equal(auth.getSession(), null);
    },
  },
  {
    name: "a stalled authentication request times out without deleting an existing session",
    async fn() {
      const memory = createMemoryStorage(); const session = { access_token: "jwt", refresh_token: "refresh", user: { id: "a" } };
      memory.setItem(SESSION_KEY, JSON.stringify(session));
      const auth = createRemoteAuth({ storage: memory, getConfig: () => config, requestTimeoutMs: 100, fetch: () => new Promise(() => {}) });
      await assert.rejects(auth.refreshSession(), (error) => error.code === "request-timeout");
      assert.deepEqual(auth.getSession(), session);
    },
  },
  {
    name: "discarding an old account response prevents merging or uploading it into the new account",
    async fn() {
      for (const action of ["push", "syncLatest", "pull"]) {
        const { data, ctx } = fixture(); const delayed = gate();
        ctx.remoteSync.pullState = () => delayed.promise;
        const workflow = createRemoteSyncWorkflow(ctx);
        const operation = workflow[action]({ silent: true });
        data.config.userId = "account-b"; data.state = { tasks: [{ id: "b-only" }] };
        delayed.resolve(remote); await operation;
        assert.deepEqual(data.state.tasks, [{ id: "b-only" }]);
        assert.equal(data.pushed.length, 0); assert.equal(data.messages.length, 0);
        assert.equal(workflow.getStatus().inFlight, false);
      }
    },
  },
  {
    name: "resetting the queue invalidates a request already in flight",
    async fn() {
      const { data, ctx } = fixture(); const delayed = gate();
      ctx.remoteSync.pullState = () => delayed.promise;
      const workflow = createRemoteSyncWorkflow(ctx); const operation = workflow.push({ silent: true });
      workflow.resetQueue(); delayed.resolve(remote); await operation;
      assert.equal(data.pushed.length, 0); assert.equal(data.meta.pending, false);
      assert.deepEqual(data.state.tasks, [{ id: "local" }]);
    },
  },
  {
    name: "late write success does not change the new account synchronization flags",
    async fn() {
      const { data, ctx } = fixture(); const delayed = gate();
      ctx.remoteSync.pushState = () => delayed.promise;
      const workflow = createRemoteSyncWorkflow(ctx); const operation = workflow.push({ silent: true });
      await Promise.resolve(); await Promise.resolve();
      data.config.userId = "account-b";
      delayed.resolve({ row: { updated_at: remote.updatedAt } }); await operation;
      assert.equal(data.meta.lastPushedAt, undefined); assert.equal(data.meta.pending, true);
    },
  },
  {
    name: "failed local persistence rolls back a merge without advancing its remote revision",
    async fn() {
      const { data, ctx } = fixture(); ctx.remoteSync.pullState = async () => remote;
      ctx.saveState = () => false;
      const workflow = createRemoteSyncWorkflow(ctx);
      const result = await workflow.syncLatest({ silent: true });
      assert.equal(result.changed, false); assert.equal(result.error.code, "local-save-failed");
      assert.deepEqual(data.state.tasks, [{ id: "local" }]);
      assert.equal(data.meta.lastPulledAt, undefined); assert.equal(data.meta.pending, true);
      assert.equal(data.pushed.length, 0);
    },
  },
  {
    name: "a manually merged workspace is sent back to the cloud instead of silently clearing pending changes",
    async fn() {
      const { data, ctx } = fixture(); let pulls = 0;
      ctx.confirmAction = async () => "secondary";
      ctx.remoteSync.pullState = async () => ++pulls === 1 ? remote : { found: true, updatedAt: remote.updatedAt, state: data.state };
      ctx.isRemoteVersionNewer = (_version, pulled) => !pulled;
      const workflow = createRemoteSyncWorkflow(ctx); await workflow.pull();
      assert.equal(data.meta.pending, true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(data.pushed[0].payload.state.tasks.map((task) => task.id), ["local", "remote"]);
      assert.equal(data.meta.pending, false); workflow.resetQueue();
    },
  },
  {
    name: "a local edit made while confirmation is open is not replaced by an old cloud read",
    async fn() {
      const { data, ctx } = fixture(); ctx.remoteSync.pullState = async () => remote;
      ctx.confirmAction = async () => { data.localVersion = "local-v2"; data.state.tasks.push({ id: "new-edit" }); return true; };
      const workflow = createRemoteSyncWorkflow(ctx); await workflow.pull();
      assert.deepEqual(data.state.tasks.map((task) => task.id), ["local", "new-edit"]);
      assert.match(data.messages.at(-1), /изменились/); workflow.resetQueue();
    },
  },
  {
    name: "sync requests time out both before headers and while reading the body and remain retryable",
    async fn() {
      for (const stalledBody of [false, true]) {
        let signal; let stalled = true;
        const sync = createRemoteSync({ requestTimeoutMs: 100, fetch: async (_url, init) => {
          signal = init.signal;
          if (!stalled) return response([]);
          const never = new Promise(() => {});
          return stalledBody ? { ok: true, text: () => never } : never;
        } });
        await assert.rejects(sync.pullState(config), (error) => error.code === "request-timeout");
        assert.equal(signal.aborted, true); stalled = false;
        assert.equal((await sync.pullState(config)).found, false);
      }
    },
  },
  {
    name: "valid JSON with an invalid state shape restores the backup rather than wiping the workspace",
    fn() {
      for (const invalid of [null, [], 42, { tasks: {} }, { studyLessons: "broken" }]) {
        const memory = createMemoryStorage(); const adapter = storageApi.createLocalStorageAdapter({ storage: memory });
        memory.setItem(adapter.keys.state, JSON.stringify(invalid));
        memory.setItem(adapter.keys.backup, JSON.stringify({ state: { tasks: [{ id: "safe" }] } }));
        const result = adapter.loadStateWithRecovery();
        assert.equal(result.status, "recovered"); assert.equal(result.state.tasks[0].id, "safe");
        assert.equal(memory.getItem(adapter.keys.corruptState), JSON.stringify(invalid));
      }
    },
  },
  {
    name: "failed local backup restoration rolls back memory and never reports success",
    async fn() {
      const { data, ctx } = fixture();
      ctx.normalizeState = (value) => value; ctx.getUserId = () => data.config.userId;
      ctx.saveState = () => false; ctx.els = {};
      ctx.storage = { loadBackup: () => ({ state: remote.state }), createImportSafetyBackup: () => ({ ok: true }) };
      await createImportExport(ctx).restoreBackup();
      assert.deepEqual(data.state.tasks, [{ id: "local" }]);
      assert.match(data.messages.at(-1), /Не удалось записать/);
    },
  },
  {
    name: "backup confirmation is scoped to the account that opened it",
    async fn() {
      const { data, ctx } = fixture(); ctx.els = {}; ctx.getUserId = () => data.config.userId;
      ctx.confirmAction = async () => { data.config.userId = "account-b"; return true; };
      ctx.storage = { loadBackup: () => ({ state: remote.state }) };
      await createImportExport(ctx).restoreBackup(); assert.deepEqual(data.state.tasks, [{ id: "local" }]);
    },
  },
  {
    name: "cloud restoration ignores a response belonging to a previous account",
    async fn() {
      const document = installDom(); const delayed = gate(); const { data, ctx } = fixture();
      ctx.els = { remoteSnapshotSelect: document.createElement("select") }; ctx.els.remoteSnapshotSelect.value = "7";
      ctx.getConfig = () => data.config; ctx.isReady = () => true;
      ctx.remoteSync.restoreSnapshot = () => delayed.promise;
      const controller = createRemoteDataController(ctx); const operation = controller.restoreSelectedSnapshot();
      await Promise.resolve(); data.config.userId = "account-b";
      delayed.resolve({ snapshot: { state: remote.state } }); await operation;
      assert.deepEqual(data.state.tasks, [{ id: "local" }]); assert.equal(data.messages.length, 0);
    },
  },
  {
    name: "delete confirmation cannot delete a different account after switching users",
    async fn() {
      const { data, ctx } = fixture(); let deletes = 0;
      ctx.els = {}; ctx.getConfig = () => data.config; ctx.isReady = () => true; ctx.getUserEmail = () => "a@example.test";
      ctx.confirmAction = async () => { data.config.userId = "account-b"; return true; };
      ctx.remoteSync.deleteAccount = async () => { deletes += 1; };
      await createRemoteDataController(ctx).deleteAccount(); assert.equal(deletes, 0);
    },
  },
  {
    name: "concurrent auth refreshes share one request and a temporary server failure keeps the session",
    async fn() {
      const memory = createMemoryStorage(); const delayed = gate(); let calls = 0;
      const session = { access_token: "jwt", refresh_token: "refresh", user: { id: "a" } };
      memory.setItem(SESSION_KEY, JSON.stringify(session));
      const auth = createRemoteAuth({ storage: memory, getConfig: () => config, fetch: () => { calls += 1; return delayed.promise; } });
      const a = auth.refreshSession(); const b = auth.refreshSession(); delayed.resolve(response({ message: "Unavailable" }, 503));
      const results = await Promise.allSettled([a, b]);
      assert.equal(calls, 1); assert.ok(results.every((result) => result.status === "rejected"));
      assert.deepEqual(auth.getSession(), session);
    },
  },
  {
    name: "an auth refresh completing after sign out cannot resurrect the signed-out session",
    async fn() {
      const memory = createMemoryStorage(); const delayed = gate();
      memory.setItem(SESSION_KEY, JSON.stringify({ access_token: "jwt", refresh_token: "refresh", user: { id: "a" } }));
      const auth = createRemoteAuth({ storage: memory, getConfig: () => config,
        fetch: (url) => url.endsWith("/logout") ? Promise.resolve(response({})) : delayed.promise });
      const refresh = auth.refreshSession(); await auth.signOut();
      delayed.resolve(response({ access_token: "late", refresh_token: "late-refresh", user: { id: "a" } }));
      await refresh; assert.equal(auth.getSession(), null); assert.equal(memory.getItem(SESSION_KEY), null);
    },
  },
  {
    name: "background device checks contain rejected session requests instead of unhandled promises",
    async fn() {
      const controller = createDeviceSyncController({ ensureFreshSession: async () => { throw new Error("Offline"); } });
      const result = await controller.syncNow({ force: true }); assert.equal(result.changed, false); assert.equal(result.error.message, "Offline");
    },
  },
  {
    name: "study-only JSON is accepted while malformed study arrays are rejected",
    async fn() {
      for (const valid of [true, false]) {
        const { data, ctx } = fixture(); let confirmed = false;
        ctx.normalizeState = (value) => value;
        ctx.confirmAction = async () => { confirmed = true; return true; };
        ctx.storage = { createImportSafetyBackup: () => ({ ok: true }) };
        ctx.els = { importFile: { files: [{ text: async () => JSON.stringify({ studySubjects: valid ? [{ id: "math" }] : {} }) }] } };
        await createImportExport(ctx).importData();
        assert.equal(confirmed, valid);
        if (valid) assert.equal(data.state.studySubjects[0].id, "math");
        else assert.equal(data.state.tasks[0].id, "local");
      }
    },
  },
];
