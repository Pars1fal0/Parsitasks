const assert = require("node:assert/strict");
const { resolveDateRollover } = require("../src/core/date-rollover.js");

module.exports = [
  {
    name: "advances the viewed day when midnight passes",
    fn() {
      assert.deepEqual(resolveDateRollover("2026-07-11", "2026-07-11", "2026-07-12"), {
        activeDate: "2026-07-12",
        changed: true,
        today: "2026-07-12",
      });
    },
  },
  {
    name: "keeps a deliberately browsed date when midnight passes",
    fn() {
      assert.equal(resolveDateRollover("2026-07-01", "2026-07-11", "2026-07-12").activeDate, "2026-07-01");
    },
  },
];
