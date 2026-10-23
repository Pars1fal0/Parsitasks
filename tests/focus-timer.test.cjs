const assert = require("node:assert/strict");
const { formatRemaining } = require("../app/src/core/focus-timer.js");

module.exports = [
  {
    name: "formats the remaining focus time as a rounded-up clock",
    fn() {
      assert.equal(formatRemaining(25 * 60000), "25:00");
      assert.equal(formatRemaining(61001), "01:02");
      assert.equal(formatRemaining(-500), "00:00");
    },
  },
];
