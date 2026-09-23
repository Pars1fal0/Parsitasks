const assert = require("node:assert/strict");
const { buildCalendarTasks, occurrenceDates, occurrenceId } = require("../src/integrations/google-calendar-occurrences.js");

module.exports = [
  {
    name: "expands a recurring block while respecting exclusions and repeat end",
    fn() {
      const task = {
        id: "series",
        title: "Практика",
        date: "2026-08-03",
        scheduleMode: "block",
        startTime: "10:00",
        endTime: "10:30",
        repeat: "daily",
        repeatUntil: "2026-08-06",
        excludedDates: { "2026-08-04": true },
      };
      assert.deepEqual(occurrenceDates(task, { from: "2026-08-01", to: "2026-08-10" }), [
        "2026-08-03",
        "2026-08-05",
        "2026-08-06",
      ]);
      assert.equal(occurrenceId(task.id, "2026-08-05"), "series::2026-08-05");
    },
  },
  {
    name: "marks links for excluded or out-of-range occurrences as stale",
    fn() {
      const result = buildCalendarTasks({
        categories: [],
        googleCalendarLinks: {
          "series::2026-08-03": { eventId: "keep", sourceTaskId: "series", occurrenceDate: "2026-08-03" },
          "series::2026-08-04": { eventId: "remove", sourceTaskId: "series", occurrenceDate: "2026-08-04" },
        },
        tasks: [{
          id: "series",
          title: "Практика",
          date: "2026-08-03",
          scheduleMode: "block",
          startTime: "10:00",
          endTime: "10:30",
          repeat: "daily",
          excludedDates: { "2026-08-04": true },
        }],
      }, { from: "2026-08-03", to: "2026-08-04" });
      assert.deepEqual(result.tasks.map((task) => task.id), ["series::2026-08-03"]);
      assert.deepEqual(result.staleTaskIds, ["series::2026-08-04"]);
    },
  },
];
