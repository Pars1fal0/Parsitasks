const assert = require("node:assert/strict");
const { createNotifications } = require("../app/src/platform/notifications.js");

function createController() {
  return createNotifications({
    cleanTimeValue(value) {
      return /^\d{2}:\d{2}$/.test(String(value || "")) ? value : "";
    },
    parseDate(dateKey) {
      const [year, month, day] = dateKey.split("-").map(Number);
      return new Date(year, month - 1, day);
    },
  });
}

module.exports = [
  { name: "habit reminders link to habits, retain failure retries and use their selected time", async fn() {
    const originalNavigator = Object.getOwnPropertyDescriptor(global, "navigator");
    const calls = [];
    let fails = true;
    Object.defineProperty(global, "navigator", { configurable: true, value: { serviceWorker: { getRegistration: async () => ({
      showNotification: async (...args) => { if (fails) throw new Error("offline"); calls.push(args); },
    }) } } });
    try {
      const controller = createNotifications({ saveState() {}, habitTitleOnDate: () => "Historical title" });
      const h = { id: "h", title: "Habit", reminderTime: "08:35" };
      await controller.deliverNotification(h, "2026-09-30", "habit");
      assert.equal(h.notified, undefined);
      fails = false;
      await controller.deliverNotification(h, "2026-09-30", "habit");
      assert.equal(calls[0][1].data.url, "/app#habits");
      assert.equal(calls[0][1].data.habitId, "h");
      assert.equal(calls[0][1].body, "Historical title");
      assert.equal(h.notified["2026-09-30"], true);
      const time = createController().habitReminderDate(h, "2026-09-30");
      assert.equal(time.getHours(), 8); assert.equal(time.getMinutes(), 35);
    } finally {
      if (originalNavigator) Object.defineProperty(global, "navigator", originalNavigator);
      else delete global.navigator;
    }
  } },
  { name: "desktop snapshots exclude completed, frozen and past habit reminders", fn() {
    require("../app/src/habits/habit-schedule.js");
    const previousWindow = global.window;
    let snapshot;
    global.window = { rhythmDesktop: { syncReminders: (value) => { snapshot = value; } } };
    const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const today = dateKey(new Date());
    const base = { repeat: "daily", type: "check", startDate: today, reminderTime: "08:00", logs: {} };
    try {
      createNotifications({ getState: () => ({ habits: [
        { ...base, id: "open", title: "Open" },
        { ...base, id: "done", title: "Done", logs: { [today]: true } },
        { ...base, id: "frozen", title: "Frozen", freezeDays: { [today]: { active: true } } },
      ] }), getNotificationsEnabled: () => true, tasksForDate: () => [], toDateKey: dateKey,
        cleanTimeValue: (value) => value, parseDate: (key) => new Date(`${key}T12:00:00`) }).syncDesktopReminders();
      assert.equal(snapshot.reminders.filter((item) => item.dateKey === today).length, 1);
      assert.equal(snapshot.reminders.find((item) => item.dateKey === today).habitId, "open");
      assert.ok(snapshot.reminders.every((item) => item.dateKey >= today));
    } finally { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; }
  } },
  {
    name: "delivers PWA reminders through the service worker and marks them sent",
    async fn() {
      const originalNavigator = Object.getOwnPropertyDescriptor(global, "navigator");
      const calls = [];
      Object.defineProperty(global, "navigator", {
        configurable: true,
        value: { serviceWorker: { getRegistration: async () => ({ showNotification: async (...args) => calls.push(args) }) } },
      });
      try {
        let saved = 0;
        const controller = createNotifications({ saveState: () => { saved += 1; } });
        const task = { id: "task", title: "Напоминание", notified: {} };
        await controller.deliverNotification(task, "2026-08-09");
        assert.equal(calls.length, 1);
        assert.equal(calls[0][0], "Parsitasks");
        assert.equal(calls[0][1].data.url, "/app#tasks");
        assert.equal(task.notified["2026-08-09"], true);
        assert.equal(saved, 1);
      } finally {
        if (originalNavigator) Object.defineProperty(global, "navigator", originalNavigator);
        else delete global.navigator;
      }
    },
  },
  {
    name: "uses a time block start for its reminder",
    fn() {
      const reminder = createController().getReminderDate(
        { scheduleMode: "block", startTime: "14:00", time: "15:30", reminderOffset: "15" },
        "2026-07-13",
      );
      assert.equal(reminder.getHours(), 13);
      assert.equal(reminder.getMinutes(), 45);
    },
  },
  {
    name: "uses a deadline time for a deadline reminder",
    fn() {
      const reminder = createController().getReminderDate(
        { scheduleMode: "deadline", time: "10:00", reminderOffset: "30" },
        "2026-07-13",
      );
      assert.equal(reminder.getHours(), 9);
      assert.equal(reminder.getMinutes(), 30);
    },
  },
];
