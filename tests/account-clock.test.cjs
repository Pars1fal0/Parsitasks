const assert = require("node:assert/strict");
const { createAppUtils } = require("../app/src/core/app-utils.js");
const { createNotifications } = require("../app/src/platform/notifications.js");
const policy = require("../app/src/platform/reminder-policy.js");

module.exports = [
  { name: "account clock agrees with MCP across midnight without shifting calendar arithmetic", async fn() {
    const mcp = await import("../mcp/task-service.mjs");
    const instant = new Date("2026-10-21T22:30:00Z");
    for (const zone of ["America/Los_Angeles", "Europe/Saratov", "Asia/Tokyo", "Pacific/Kiritimati"]) {
      const clock = createAppUtils({ getTimeZone: () => zone });
      assert.equal(clock.todayKey(instant), mcp.toDateKey(instant, zone));
      assert.equal(clock.addDays("2026-10-21", 1), "2026-10-22");
      assert.equal(clock.toDateKey(clock.parseDate("2026-10-21")), "2026-10-21");
    }
    const clock = createAppUtils({ getTimeZone: () => "America/Los_Angeles" });
    assert.equal(clock.toTimeValue(instant), "15:30");
    assert.equal(clock.nowInTimeZone(instant).getHours(), 15);
  } },
  { name: "account clock follows preference changes and resolves DST reminders", fn() {
    let zone = "America/New_York";
    const clock = createAppUtils({ getTimeZone: () => zone });
    assert.equal(clock.dateAtTime("2026-03-07", "09:00").toISOString(), "2026-03-07T14:00:00.000Z");
    assert.equal(clock.dateAtTime("2026-03-08", "09:00").toISOString(), "2026-03-08T13:00:00.000Z");
    assert.equal(clock.dateAtTime("2026-03-08", "02:30").toISOString(), "2026-03-08T07:30:00.000Z");
    zone = "Europe/Berlin";
    assert.equal(clock.dateAtTime("2026-03-29", "02:30").toISOString(), "2026-03-29T01:30:00.000Z");
    zone = "Asia/Tokyo";
    assert.equal(clock.todayKey(new Date("2026-10-21T22:30:00Z")), "2026-10-22");
  } },
  { name: "task and habit reminders use account time rather than device time", fn() {
    const clock = createAppUtils({ getTimeZone: () => "America/Los_Angeles" });
    const notifications = createNotifications({ ...clock });
    assert.equal(notifications.habitReminderDate({ reminderTime: "09:00" }, "2026-10-21").toISOString(), "2026-10-21T16:00:00.000Z");
    const task = { dueDate: "2026-10-21", dueTime: "11:30", dueReminderOffset: "15" };
    assert.equal(notifications.getReminderDate(task, "2026-10-20").toISOString(), "2026-10-21T18:15:00.000Z");
    assert.equal(notifications.getTaskDeadlineDate(task, "2026-10-20").toISOString(), "2026-10-21T18:30:00.000Z");
  } },
  { name: "quiet hours and tomorrow snoozes retain account time on desktop and web", fn() {
    const instant = new Date("2026-10-22T06:30:00Z");
    const prefs = { enabled: true, start: "22:00", end: "08:00", timeZone: "America/Los_Angeles" };
    assert.equal(policy.normalizeQuietHours(prefs).timeZone, prefs.timeZone);
    assert.equal(policy.nextAllowed(instant, prefs).toISOString(), "2026-10-22T15:00:00.000Z");
    assert.equal(policy.snoozeUntil(instant, "tomorrow", prefs.timeZone).toISOString(), "2026-10-22T16:00:00.000Z");
  } },
];
