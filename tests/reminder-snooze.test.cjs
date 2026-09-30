const assert = require("node:assert/strict");
require("../app/src/platform/reminder-policy.js");
require("../app/src/core/workspace-local.js");
require("../app/src/habits/habit-schedule.js");
const { createNotifications } = require("../app/src/platform/notifications.js");
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function setup() {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  let now = new Date(2026, 8, 30, 10);
  let quiet = { enabled: false, start: "22:00", end: "08:00" };
  const task = { id: "t", title: "Позвонить", date: "2026-09-30", time: "09:00", reminderOffset: "0", notified: { "2026-09-30": true } };
  const state = { tasks: [task], habits: [] };
  let owner = "alice";
  const ctx = { reminderStorage: storage, getUserId: () => owner, getQuietHours: () => quiet, getNow: () => now, getState: () => state,
    tasksForDate: (date) => state.tasks.filter((item) => item.date === date), taskOccursOn: (item, date) => item.date === date,
    isTaskDone: (item) => Boolean(item.done), cleanTimeValue: (value) => value, getCategory: () => null,
    parseDate: (key) => new Date(`${key}T00:00:00`), toDateKey: dateKey, saveState() {}, showToast() {}, getNotificationsEnabled: () => true };
  return { ctx, task, controller: createNotifications(ctx), setNow: (value) => { now = value; }, setQuiet: (value) => { quiet = value; }, setOwner: (value) => { owner = value; } };
}
module.exports = [
  { name: "persists snoozes per occurrence and isolates user accounts", fn() {
    const test = setup();
    assert.equal(test.controller.snoozeReminder("task", "t", "2026-09-30", "30"), true);
    assert.equal(test.task.date, "2026-09-30");
    const rebuilt = createNotifications(test.ctx);
    assert.equal(rebuilt.collectReminders()[0].at.getTime(), new Date(2026, 8, 30, 10, 30).getTime());
    assert.ok(rebuilt.collectReminders()[0].snooze);
    test.setOwner("bob");
    assert.equal(rebuilt.collectReminders()[0].snooze, null);
    assert.equal(rebuilt.collectReminders()[0].at.getHours(), 9);
  } },
  { name: "rejects snoozes for completed tasks and missing occurrences", fn() {
    const test = setup(); test.task.done = true;
    assert.equal(test.controller.snoozeReminder("task", "t", "2026-09-30", "10"), false);
    test.task.done = false;
    assert.equal(test.controller.snoozeReminder("task", "t", "2026-10-01", "10"), false);
  } },
  { name: "quiet hours defer browser delivery and a snooze is delivered only once", async fn() {
    const previousWindow = global.window;
    const previousNotification = global.Notification;
    const deliveries = [];
    global.Notification = class { static permission = "granted"; constructor(title, options) { deliveries.push(options); } };
    global.window = { Notification: global.Notification };
    try {
      const test = setup();
      test.setNow(new Date(2026, 8, 30, 21, 55));
      test.setQuiet({ enabled: true, start: "22:00", end: "08:00" });
      assert.equal(test.controller.snoozeReminder("task", "t", "2026-09-30", "10"), true);
      assert.equal(test.controller.collectReminders()[0].at.getTime(), new Date(2026, 9, 1, 8).getTime());
      test.setNow(new Date(2026, 9, 1, 7, 59));
      test.controller.checkDueNotifications();
      await new Promise(setImmediate);
      assert.equal(deliveries.length, 0);
      test.setNow(new Date(2026, 9, 1, 8));
      test.controller.checkDueNotifications();
      await new Promise(setImmediate);
      assert.equal(deliveries.length, 1);
      test.controller.checkDueNotifications();
      await new Promise(setImmediate);
      assert.equal(deliveries.length, 1);
      assert.equal(createNotifications(test.ctx).collectReminders()[0].snooze, null);
    } finally { global.window = previousWindow; global.Notification = previousNotification; }
  } },
  { name: "desktop snapshots include adjusted snoozes and quiet hours", fn() {
    const previousWindow = global.window;
    let snapshot;
    global.window = { rhythmDesktop: { syncReminders: (payload) => { snapshot = payload; } } };
    try {
      const test = setup();
      test.setNow(new Date(2026, 8, 30, 23));
      test.setQuiet({ enabled: true, start: "22:00", end: "08:00" });
      test.controller.snoozeReminder("task", "t", "2026-09-30", "30");
      assert.equal(snapshot.reminders.length, 1);
      assert.equal(snapshot.reminders[0].taskId, "t");
      assert.equal(Date.parse(snapshot.reminders[0].reminderAt), new Date(2026, 9, 1, 8).getTime());
      assert.deepEqual(snapshot.quietHours, { enabled: true, start: "22:00", end: "08:00" });
    } finally { global.window = previousWindow; }
  } },
  { name: "desktop keeps last night's habit reminder when quiet hours end today", fn() {
    const previousWindow = global.window;
    let snapshot;
    global.window = { rhythmDesktop: { syncReminders: (payload) => { snapshot = payload; } } };
    try {
      const test = setup();
      test.ctx.getState().tasks = [];
      test.ctx.getState().habits = [{ id: "h", title: "Вечерняя привычка", startDate: "2026-09-29", repeat: "daily", type: "check", logs: {}, reminderTime: "23:00" }];
      test.setNow(new Date(2026, 8, 30, 8, 5));
      test.setQuiet({ enabled: true, start: "22:00", end: "08:00" });
      test.controller.syncDesktopReminders();
      const deferred = snapshot.reminders.find((item) => item.dateKey === "2026-09-29");
      assert.ok(deferred);
      assert.equal(Date.parse(deferred.reminderAt), new Date(2026, 8, 30, 8).getTime());
    } finally { global.window = previousWindow; }
  } },
];
