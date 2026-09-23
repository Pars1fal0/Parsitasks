const assert = require("node:assert/strict");
const { createSyncHistory } = require("../src/sync/sync-history.js");

module.exports = [
  {
    name: "keeps the newest sync events first and limits stored history",
    fn() {
      const values = new Map();
      const storage = {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
      };
      const history = createSyncHistory({ limit: 2, storage });
      history.record("push");
      history.record("pull");
      history.record("merge", "automatic");

      assert.deepEqual(history.list().map((entry) => entry.type), ["merge", "pull"]);
      assert.equal(history.list()[0].detail, "automatic");
    },
  },
];
