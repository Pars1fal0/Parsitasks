const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const documentState = require("../app/src/core/document-state.js");
const { createStateController } = require("../app/src/core/state-controller.js");
const { createLocalStorageAdapter } = require("../app/src/core/storage.js");
const { mergeStates, undoChanges } = require("../app/src/core/state-merge.js");
const metadata = require("../app/src/sync/sync-metadata.js");
const { createMemoryStorage } = require("./test-utils.cjs");
const { createNotifications } = require("../app/src/platform/notifications.js");
const study = require("../app/src/study/study-model.js");

const today = "2026-10-05";
const now = `${today}T10:00:00.000Z`;
const task = (id) => ({ id, title: id, date: today, repeat: "none", completed: {}, createdAt: now, updatedAt: now });
function controller(storage, owner = "") {
  const tracker = metadata.createSyncMetadataTracker({ now: () => now });
  return createStateController({ initialState: storage.loadState(), normalizeState: documentState.normalizeState,
    clone: structuredClone, schemaVersion: documentState.SCHEMA_VERSION, storage, getOwner: () => owner,
    mergeStates, sameValue: metadata.sameValue, trackChanges: tracker.trackChanges });
}
function sharedStorage(tasks = []) {
  const storage = createLocalStorageAdapter({ storage: createMemoryStorage(), schemaVersion: documentState.SCHEMA_VERSION });
  storage.saveState(documentState.normalizeState({ tasks }), { owner: "", skipBackup: true });
  return storage;
}
module.exports = [
  { name: "independent tabs preserve additions and deletion tombstones", fn() {
    const storage = sharedStorage(); const a = controller(storage); const b = controller(storage);
    a.getState().tasks.push(task("a")); a.saveState();
    b.getState().tasks.push(task("b")); b.saveState();
    assert.deepEqual(storage.loadState().tasks.map((item) => item.id).sort(), ["a", "b"]);
    a.receiveExternal(storage.loadState());
    a.getState().tasks = a.getState().tasks.filter((item) => item.id !== "a");
    a.getState().tombstones.tasks.a = now; a.saveState();
    b.getState().tasks.push(task("c")); b.saveState();
    assert.deepEqual(storage.loadState().tasks.map((item) => item.id).sort(), ["b", "c"]);
  } },
  { name: "same-millisecond edits and out-of-order storage events cannot restore stale completion", fn() {
    const storage = sharedStorage([task("a")]); const a = controller(storage); const b = controller(storage);
    a.getState().tasks[0].completed[today] = true; a.saveState(); const previous = storage.loadState();
    a.getState().tasks[0].completed[today] = false; a.saveState();
    a.receiveExternal(previous); assert.notEqual(a.getState().tasks[0].completed[today], true);
    b.getState().tasks.push(task("b")); b.saveState();
    assert.notEqual(storage.loadState().tasks.find((item) => item.id === "a").completed[today], true);
  } },
  { name: "undoing a deletion survives another tab save without reviving later deletions", fn() {
    const storage = sharedStorage([task("a")]); const a = controller(storage); const b = controller(storage);
    const original = structuredClone(a.getState());
    a.getState().tasks = []; a.getState().tombstones.tasks.a = now; a.saveState();
    const deleted = storage.loadState();
    b.getState().tasks.push(task("b")); b.saveState();
    a.replaceState(original); a.saveState();
    assert.deepEqual(storage.loadState().tasks.map((item) => item.id).sort(), ["a", "b"]);
    assert.equal(mergeStates(storage.loadState(), deleted).tasks.length, 2);
    const laterDelete = { tasks: [], tombstones: { tasks: { a: "2026-10-05T12:00:00.000Z" } } };
    assert.deepEqual(mergeStates(storage.loadState(), laterDelete).tasks.map((item) => item.id), ["b"]);
  } },
  { name: "undo only reverts its own changes while retaining later records and dated progress", fn() {
    const before = documentState.normalizeState({ tasks: [task("a")] });
    const after = structuredClone(before); after.tasks[0].completed[today] = true;
    const current = structuredClone(after); current.tasks.push(task("b")); current.tasks[0].completed["2026-10-06"] = true;
    const undone = undoChanges(before, after, current, now);
    assert.deepEqual(undone.tasks.map((item) => item.id), ["a", "b"]);
    assert.notEqual(undone.tasks[0].completed[today], true);
    assert.equal(undone.tasks[0].completed["2026-10-06"], true);
    const added = structuredClone(before); added.tasks.push(task("new"));
    const live = structuredClone(added); live.tasks.push(task("other"));
    const undoAdd = undoChanges(before, added, live, now);
    assert.deepEqual(undoAdd.tasks.map((item) => item.id), ["a", "other"]);
    assert.equal(undoAdd.tombstones.tasks.new, now);
    const deleted = structuredClone(before); deleted.tasks = []; deleted.tombstones.tasks.a = now;
    const undoDelete = undoChanges(before, deleted, { ...deleted, tasks: [task("b")] }, now);
    assert.deepEqual(undoDelete.tasks.map((item) => item.id).sort(), ["a", "b"]);
    assert.equal(undoDelete.tombstones.tasks.a, undefined);
    const laterEdit = structuredClone(added); laterEdit.tasks[1].title = "Later edit";
    assert.equal(undoChanges(before, added, laterEdit, now).tasks[1].title, "Later edit");
  } },
  { name: "a stale tab cannot write into the other account workspace and explicit replacement remains possible", fn() {
    const storage = sharedStorage(); const a = controller(storage);
    storage.saveState(documentState.normalizeState({ tasks: [task("other-user")] }), { owner: "other" });
    a.getState().tasks.push(task("private"));
    assert.throws(() => a.saveState(), /Workspace changed/);
    assert.deepEqual(storage.loadState().tasks.map((item) => item.id), ["other-user"]);
    assert.equal(Object.hasOwn(storage.loadState(), "_localOwner"), false);
    const b = controller(storage, "other"); b.replaceState({ tasks: [task("replacement")] });
    b.saveState(undefined, { skipChangeTracking: true });
    assert.deepEqual(storage.loadState().tasks.map((item) => item.id), ["replacement"]);
  } },
  { name: "divergent note bodies are retained once while sequential revisions do not become conflicts", fn() {
    const base = { id: "note", title: "Note", bodyBaseUpdatedAt: now, createdAt: now };
    const a = { notes: [{ ...base, body: "Version A", updatedAt: "2026-10-05T10:01:00.000Z" }] };
    const b = { notes: [{ ...base, body: "Version B", updatedAt: "2026-10-05T10:02:00.000Z" }] };
    const merged = mergeStates(a, b);
    assert.equal(merged.notes.length, 2); assert.deepEqual(merged.notes.map((item) => item.body).sort(), ["Version A", "Version B"]);
    assert.equal(mergeStates(merged, a).notes.length, 2);
    const next = { notes: [{ ...b.notes[0], body: "Next version", bodyBaseUpdatedAt: b.notes[0].updatedAt, updatedAt: "2026-10-05T10:03:00.000Z" }] };
    assert.equal(mergeStates(b, next).notes.length, 1);
  } },
  { name: "concurrent daily journal edits retain losing text in revision history even with separate IDs", fn() {
    const a = { id: "a", date: today, text: "Version A", createdAt: now, updatedAt: now, revisions: [] };
    const b = { ...a, text: "Version B", updatedAt: "2026-10-05T10:02:00.000Z" };
    for (const id of ["a", "b"]) {
      const state = mergeStates({ journalEntries: [a] }, { journalEntries: [{ ...b, id }] });
      assert.equal(state.journalEntries.length, 1);
      assert.equal(state.journalEntries[0].text, "Version B");
      assert.ok(state.journalEntries[0].revisions.some((item) => item.text === "Version A"));
      assert.equal(mergeStates(state, { journalEntries: [a] }).journalEntries[0].revisions.length, 1);
    }
  } },
  { name: "task work and submission reminders are independent even when submission reminders are disabled", async fn() {
    const t = { ...task("work"), startTime: "14:00", endTime: "15:00", scheduleMode: "block", reminderOffset: "15",
      dueDate: "2026-10-07", dueTime: "11:30", dueReminderOffset: "none" };
    const state = { tasks: [t], habits: [] };
    const api = createNotifications({ getState: () => state, getNow: () => new Date(`${today}T10:00:00`),
      tasksForDate: (date) => date === today ? [t] : [], isTaskDone: (item, date) => item.completed[date] === true,
      taskOccursOn: (item, date) => item.date === date, toDateKey: (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      cleanTimeValue: (value) => value || "", parseDate: (date) => new Date(`${date}T00:00:00`), saveState() {} });
    assert.deepEqual(api.collectReminders(7).map((item) => item.kind), ["task-work"]);
    t.dueReminderOffset = "15";
    const reminders = api.collectReminders(7); assert.equal(reminders.length, 2);
    assert.equal(reminders[0].at.getHours(), 13); assert.equal(reminders[0].at.getMinutes(), 45);
    assert.equal(reminders[1].at.getHours(), 11); assert.equal(reminders[1].at.getMinutes(), 15);
    const originalNavigator = Object.getOwnPropertyDescriptor(global, "navigator");
    Object.defineProperty(global, "navigator", { configurable: true, value: { serviceWorker: { getRegistration: async () => ({ showNotification: async () => {} }) } } });
    try {
      await api.deliverNotification(t, today, "task-work");
      assert.equal(t.workNotified[today], true); assert.equal(t.notified, undefined);
      await api.deliverNotification(t, today, "task"); assert.equal(t.notified[today], true);
    } finally { if (originalNavigator) Object.defineProperty(global, "navigator", originalNavigator); else delete global.navigator; }
  } },
  { name: "homework uses today's future practice, skips elapsed pairs, and follows moved occurrence times", fn() {
    const lessons = [{ id: "practice", subjectId: "math", weekday: 1, weekType: "all", lessonType: "practice", startTime: "15:00", endTime: "16:30" }];
    assert.equal(study.nextLessonOccurrence(lessons, "math", today, {}, "10:00").date, today);
    assert.equal(study.nextLessonOccurrence(lessons, "math", today, {}, "15:00").date, "2026-10-12");
    lessons[0].exceptions = { [today]: { date: today, startTime: "09:00", endTime: "10:30" } };
    assert.equal(study.nextLessonOccurrence(lessons, "math", today, {}, "10:00").date, "2026-10-12");
    lessons[0].lessonType = "lecture"; lessons[0].exceptions = {};
    assert.equal(study.nextLessonOccurrence(lessons, "math", today, {}, "10:00").startTime, "15:00");
  } },
  { name: "notification delivery cannot acknowledge a different account after awaiting the service worker", async fn() {
    const originalNavigator = Object.getOwnPropertyDescriptor(global, "navigator");
    let release; let owner = "a"; let shown = 0; let saved = 0;
    const registration = new Promise((resolve) => { release = resolve; });
    Object.defineProperty(global, "navigator", { configurable: true, value: { serviceWorker: { getRegistration: () => registration } } });
    try {
      const entity = task("a");
      const api = createNotifications({ getUserId: () => owner, getState: () => ({ tasks: [entity] }), saveState: () => { saved++; } });
      const delivery = api.deliverNotification(entity, today);
      owner = "b"; release({ showNotification: async () => { shown++; } }); await delivery;
      assert.equal(shown, 0); assert.equal(saved, 0); assert.equal(entity.notified, undefined);
    } finally { if (originalNavigator) Object.defineProperty(global, "navigator", originalNavigator); else delete global.navigator; }
  } },
  { name: "MCP limiter uses the authenticated token, delegates globally, and fails closed on missing migration", async fn() {
    const { consumeRequestLimit } = await import("../mcp/request-limit.mjs");
    const calls = []; let used = 0;
    const fetchFn = async (url, init) => { calls.push({ url, init }); return Response.json({ allowed: ++used <= 1, retryAfter: 23 }); };
    const env = { SUPABASE_URL: "https://example.test/", SUPABASE_PUBLISHABLE_KEY: "public" };
    assert.equal((await consumeRequestLimit(env, { accessToken: "token" }, fetchFn)).allowed, true);
    assert.equal((await consumeRequestLimit(env, { accessToken: "token" }, fetchFn)).allowed, false);
    assert.equal(calls[0].init.body, "{}"); assert.equal(calls[0].init.headers.Authorization, "Bearer token");
    assert.match(calls[0].url, /rpc\/consume_parsitasks_request$/);
    await assert.rejects(consumeRequestLimit(env, { accessToken: "token" }, async () => new Response("", { status: 404 })), /unavailable/);
    await assert.rejects(consumeRequestLimit(env, { accessToken: "token" }, async () => Response.json({ allowed: "yes", retryAfter: 23 })), /Invalid/);
  } },
  { name: "unchanged cloud state does not create another full-state write", async fn() {
    const { createRemoteSyncWorkflow } = require("../app/src/sync/remote-sync-controller.js");
    let pushes = 0; let pending = true; const state = { tasks: [task("a")] };
    const workflow = createRemoteSyncWorkflow({
      getSettings: () => ({ enabled: true, userId: "synthetic", accessToken: "token" }),
      getState: () => state, getSyncMeta: () => ({ pending, lastPushedAt: now }),
      setSyncMeta: (meta) => { if (Object.hasOwn(meta, "pending")) pending = meta.pending; },
      statesEqual: metadata.sameValue, isRemoteVersionNewer: () => false,
      syncControls() {},
      remoteSync: { normalizeConfig: (config) => config, isConfigured: () => true,
        pullState: async () => ({ found: true, state: structuredClone(state), uiState: {}, updatedAt: now }),
        pushState: async () => { pushes++; } },
    });
    await workflow.push({ silent: true });
    assert.equal(pushes, 0); assert.equal(pending, false); assert.equal(workflow.getStatus().lastError, "");
  } },
  { name: "server migration bounds snapshots and denies direct or anonymous rate-counter access", fn() {
    const sql = fs.readFileSync(path.join(__dirname, "../database/20261005-reliability.sql"), "utf8");
    assert.match(sql, /owner_id uuid := auth\.uid\(\)/); assert.match(sql, /on conflict \(user_id\) do update/);
    assert.match(sql, /enable row level security/); assert.match(sql, /revoke all on table public\.parsitasks_request_limits from public, anon, authenticated/);
    assert.match(sql, /set search_path = ''/); assert.match(sql, /interval '5 minutes'/); assert.match(sql, /retained_bytes > 16777216/);
    assert.match(sql, /octet_length\(state::text\) <= 8388608/); assert.doesNotMatch(sql, /grant.*parsitasks_request_limits/);
  } },
  { name: "structural equality ignores database JSON key order without ignoring array order", fn() {
    assert.equal(metadata.sameValue({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 }), true);
    assert.equal(metadata.sameValue([1, 2], [2, 1]), false);
    const storage = sharedStorage(); controller(storage).saveState();
    assert.ok(storage.getDiagnostics().bytes > 0); assert.ok(storage.getDiagnostics().durationMs >= 0);
  } },
  { name: "oversized cloud state is rejected before any network request", async fn() {
    const { createRemoteSync } = require("../app/src/sync/remote-sync.js"); let requests = 0;
    const api = createRemoteSync({ fetch: async () => { requests++; throw new Error("unexpected network access"); } });
    await assert.rejects(api.pushState({ enabled: true, userId: "fake", anonKey: "fake", accessToken: "fake", supabaseUrl: "https://example.test" },
      { state: { large: "a".repeat(4 * 1024 * 1024) } }), (error) => error.code === "workspace-too-large");
    assert.equal(requests, 0);
  } },
];
