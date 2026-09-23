const assert = require("node:assert/strict");
const { pruneTombstones } = require("../app/src/sync/tombstone-retention.js");

module.exports = [
  {
    name: "keeps recent deletions and removes only tombstones older than two years",
    fn() {
      const result = pruneTombstones(
        {
          tasks: {
            recent: "2026-07-01T00:00:00.000Z",
            expired: "2023-01-01T00:00:00.000Z",
          },
        },
        { now: Date.parse("2026-07-17T00:00:00.000Z") },
      );

      assert.deepEqual(result.tasks, { recent: "2026-07-01T00:00:00.000Z" });
    },
  },
];
