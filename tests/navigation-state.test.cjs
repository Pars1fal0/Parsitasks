const assert = require("node:assert/strict");
const { buildHash, parseHash } = require("../app/src/core/navigation-state.js");

module.exports = [
  {
    name: "maps application views to stable URL hashes",
    fn() {
      assert.equal(buildHash("tasks", "week"), "#tasks");
      assert.equal(buildHash("timeline", "week"), "#timeline");
      assert.equal(buildHash("journal", "week"), "#journal");
      assert.equal(buildHash("nutrition", "week"), "#nutrition");
      assert.equal(buildHash("board", "week"), "#board");
      assert.equal(buildHash("overview", "month"), "#calendar/month");
      assert.deepEqual(parseHash("#calendar/year"), { view: "overview", overviewMode: "year" });
      assert.deepEqual(parseHash("#/habits"), { view: "habits", overviewMode: null });
      assert.deepEqual(parseHash("#journal"), { view: "journal", overviewMode: null });
      assert.deepEqual(parseHash("#nutrition"), { view: "nutrition", overviewMode: null });
      assert.deepEqual(parseHash("#board"), { view: "board", overviewMode: null });
      assert.equal(parseHash("#unknown"), null);
    },
  },
];
