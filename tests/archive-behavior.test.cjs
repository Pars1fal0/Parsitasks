const assert = require("node:assert/strict");
const { removeArchiveEntries } = require("../src/tasks/archive-view.js");

module.exports = [
  {
    name: "removes one recurring archive occurrence without resurrecting it as unfinished",
    fn() {
      const task = {
        id: "repeat-1",
        repeat: "daily",
        completed: { "2026-07-13": true },
        excludedDates: {},
      };

      const deletedIds = removeArchiveEntries([{ dateKey: "2026-07-13", task }]);

      assert.equal(deletedIds.size, 0);
      assert.equal(task.completed["2026-07-13"], undefined);
      assert.equal(task.excludedDates["2026-07-13"], true);
    },
  },
  {
    name: "returns one-off task ids for permanent archive deletion",
    fn() {
      const deletedIds = removeArchiveEntries([{ dateKey: "2026-07-13", task: { id: "single-1", repeat: "none" } }]);
      assert.deepEqual([...deletedIds], ["single-1"]);
    },
  },
];
