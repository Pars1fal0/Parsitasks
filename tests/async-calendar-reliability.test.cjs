const assert = require("node:assert/strict");
const { createGoogleCalendarController, applyCalendarResult } = require("../app/src/integrations/google-calendar-controller.js");

function fixture() {
  return { tasks: [{ id: "task", title: "Original", date: "2026-10-22", repeat: "none", startTime: "10:00", endTime: "11:00", scheduleMode: "block", updatedAt: "2026-10-21T10:00:00Z" }],
    categories: [], googleCalendarLinks: {}, tombstones: { tasks: {} } };
}
const patch = { id: "task", title: "Remote", date: "2026-10-22", startTime: "12:00", endTime: "13:00", updatedAt: "2026-10-21T11:00:00Z" };

module.exports = [
  { name: "calendar disconnect confirmation cannot affect a replacement account", async fn() {
    let owner = "one", accept, disconnect, calls = 0;
    const controller = createGoogleCalendarController({
      els: { googleCalendarDisconnect: { addEventListener: (_event, callback) => { disconnect = callback; } } },
      getOwner: () => owner, getAccessToken: () => "synthetic", showToast() {},
      confirmAction: () => new Promise((resolve) => { accept = resolve; }),
      api: { status: async () => ({ connected: true }), disconnect: async () => { calls++; } },
    });
    controller.bindEvents(); await controller.refreshStatus();
    const pending = disconnect(); owner = "two"; accept(true); await pending;
    assert.equal(calls, 0);
  } },
  { name: "a time zone change during calendar sync queues the new zone", async fn() {
    const originalTimer = global.setTimeout;
    const callbacks = [], zones = []; let finish, zone = "Europe/Moscow";
    global.setTimeout = (callback) => { callbacks.push(callback); return callbacks.length; };
    try {
      const state = fixture();
      const controller = createGoogleCalendarController({ els: {}, getState: () => state, getOwner: () => "one",
        getAccessToken: () => "synthetic", getTimeZone: () => zone,
        api: { status: async () => ({ connected: true }), sync: (payload) => { zones.push(payload.timeZone); return new Promise((resolve) => { finish = resolve; }); } },
        saveState: () => true, render() {}, showToast() {} });
      await controller.refreshStatus();
      let pending = controller.sync(); zone = "Asia/Tokyo"; finish({ links: {} }); await pending;
      assert.equal(callbacks.length, 1);
      pending = callbacks[0](); finish({ links: {} }); await pending;
      assert.deepEqual(zones, ["Europe/Moscow", "Asia/Tokyo"]);
    } finally { global.setTimeout = originalTimer; }
  } },
  { name: "changing only the account time zone schedules a fresh calendar sync", async fn() {
    const originalTimer = global.setTimeout, originalClear = global.clearTimeout;
    const callbacks = [], zones = [];
    global.setTimeout = (callback) => { callbacks.push(callback); return callbacks.length; };
    global.clearTimeout = () => {};
    try {
      const state = fixture(); let zone = "Europe/Moscow";
      const controller = createGoogleCalendarController({ els: {}, getState: () => state, getOwner: () => "one",
        getAccessToken: () => "synthetic", getTimeZone: () => zone,
        api: { status: async () => ({ connected: true }), sync: async (payload) => { zones.push(payload.timeZone); return { links: {} }; } },
        saveState: () => true, render() {}, showToast() {} });
      await controller.refreshStatus(); await controller.sync();
      controller.schedule(); assert.equal(callbacks.length, 0);
      zone = "Asia/Tokyo"; controller.schedule(); assert.equal(callbacks.length, 1);
      await callbacks[0]();
      assert.deepEqual(zones, ["Europe/Moscow", "Asia/Tokyo"]);
      controller.schedule(); assert.equal(callbacks.length, 1);
    } finally { global.setTimeout = originalTimer; global.clearTimeout = originalClear; }
  } },
  { name: "calendar results preserve edits, deletions and unrelated new tasks made during a request", fn() {
    const baseline = fixture();
    const state = structuredClone(baseline);
    state.tasks[0].title = "New local text";
    state.tasks.push({ id: "new", title: "Another new task" });
    applyCalendarResult(state, { links: { task: { eventId: "event" } }, upserts: [patch], deletions: ["new"] }, { createId: () => "google", deleteTask: (id) => { state.tasks = state.tasks.filter((t) => t.id !== id); } }, baseline);
    assert.equal(state.tasks[0].title, "New local text");
    assert.ok(state.tasks.some((t) => t.id === "new"));
    assert.equal(state.googleCalendarLinks.task.eventId, "event");
    const deleted = structuredClone(baseline); deleted.tasks = []; deleted.tombstones.tasks.task = "2026-10-22T10:00:00Z";
    applyCalendarResult(deleted, { upserts: [patch] }, { createId: () => "google" }, baseline);
    assert.equal(deleted.tasks.length, 0);
  } },
  { name: "calendar imports can update multiple occurrences of an unchanged series", fn() {
    const baseline = fixture(); baseline.tasks[0] = { id: "series", title: "Series", repeat: "daily", excludedDates: {} };
    const state = structuredClone(baseline);
    applyCalendarResult(state, { upserts: ["2026-10-22", "2026-10-23"].map((date) => ({ ...patch, id: `series::${date}`, sourceTaskId: "series", occurrenceDate: date, date })) }, { createId: () => "google" }, baseline);
    assert.equal(state.tasks.length, 3);
    assert.deepEqual(state.tasks[0].excludedDates, { "2026-10-22": true, "2026-10-23": true });
  } },
  { name: "calendar sync rolls back storage failures, rejects changed owners and queues newer edits", async fn() {
    const originalTimer = global.setTimeout;
    const callbacks = [];
    global.setTimeout = (callback) => { callbacks.push(callback); return 1; };
    try {
      let state = fixture(), owner = "one", release, fail = true;
      const toasts = [];
      const controller = createGoogleCalendarController({ els: {}, getState: () => state, getOwner: () => owner,
        getAccessToken: () => "synthetic", getTimeZone: () => "UTC", createId: () => "google",
        api: { status: async () => ({ connected: true, direction: "two-way" }), sync: () => new Promise((resolve) => { release = resolve; }) },
        saveState: () => !fail, replaceState: (next) => { state = next; }, render() {}, showToast: (text) => toasts.push(text) });
      await controller.refreshStatus();
      const before = structuredClone(state);
      let pending = controller.sync({ announce: true }); release({ upserts: [patch] }); await pending;
      assert.deepEqual(state, before);
      assert.ok(toasts.some((text) => text.includes("Не удалось сохранить")));
      fail = false;
      pending = controller.sync({ silent: true });
      state.tasks[0].title = "Fresh local edit"; controller.schedule();
      release({ upserts: [patch] }); await pending;
      assert.equal(state.tasks[0].title, "Fresh local edit"); assert.equal(callbacks.length, 1);
      pending = controller.sync({ silent: true }); owner = "two"; state = fixture(); state.tasks[0].title = "Other owner";
      release({ upserts: [patch] }); await pending;
      assert.equal(state.tasks[0].title, "Other owner");
    } finally { global.setTimeout = originalTimer; }
  } },
];
