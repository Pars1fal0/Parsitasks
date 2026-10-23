const assert = require("node:assert/strict");
const { breakMinutes, formatDuration, formatRemaining, pluralSessions } = require("../app/src/core/focus-timer.js");

module.exports = [
  {
    name: "formats the remaining focus time as a rounded-up clock",
    fn() {
      assert.equal(formatRemaining(25 * 60000), "25:00");
      assert.equal(formatRemaining(61001), "01:02");
      assert.equal(formatRemaining(-500), "00:00");
    },
  },
  {
    name: "scales breaks with the session and gives a long break after a full cycle",
    fn() {
      assert.equal(breakMinutes(15, false), 5);
      assert.equal(breakMinutes(25, false), 5);
      assert.equal(breakMinutes(50, false), 10);
      assert.equal(breakMinutes(25, true), 15);
    },
  },
  {
    name: "describes daily focus totals in Russian",
    fn() {
      assert.equal(formatDuration(40), "40 мин");
      assert.equal(formatDuration(120), "2 ч");
      assert.equal(formatDuration(75), "1 ч 15 мин");
      assert.deepEqual([1, 2, 5, 11, 21, 24].map(pluralSessions), ["сессия", "сессии", "сессий", "сессий", "сессия", "сессии"]);
    },
  },
];
