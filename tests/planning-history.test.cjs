const assert = require("node:assert/strict");
const { archiveEntryInPeriod, buildBacklogEntries } = require("../app/src/core/planning-history.js");
const { toDateKey, parseDateKey } = require("./test-utils.cjs");

function addDays(dateKey, days) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

module.exports = [
  {
    name: "includes old one-off tasks and missed recurring occurrences in backlog",
    fn() {
      const entries = buildBacklogEntries({
        addDays,
        isTaskDone: (task, dateKey) => task.completed?.[dateKey] === true,
        isTaskExcluded: () => false,
        taskOccursOn: (task, dateKey) => task.repeat === "daily" && dateKey >= task.date,
        tasks: [
          { id: "one", title: "Old", date: "2026-07-01", repeat: "none", completed: {} },
          { id: "daily", title: "Daily", date: "2026-07-01", repeat: "daily", completed: { "2026-07-10": true } },
        ],
        todayKey: "2026-07-13",
        recurringWindowDays: 4,
      });
      assert.equal(entries.some((entry) => entry.task.id === "one"), true);
      assert.equal(entries.some((entry) => entry.task.id === "daily" && entry.dateKey === "2026-07-09"), true);
      assert.equal(entries.some((entry) => entry.dateKey === "2026-07-10"), false);
    },
  },
  {
    name: "filters archive entries by recent period",
    fn() {
      assert.equal(archiveEntryInPeriod("2026-07-10", "week", "2026-07-13", addDays), true);
      assert.equal(archiveEntryInPeriod("2026-06-01", "week", "2026-07-13", addDays), false);
      assert.equal(archiveEntryInPeriod("2020-01-01", "all", "2026-07-13", addDays), true);
    },
  },
];
