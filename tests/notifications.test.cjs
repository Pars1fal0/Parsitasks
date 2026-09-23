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
