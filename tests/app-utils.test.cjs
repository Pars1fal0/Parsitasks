const assert = require("node:assert/strict");
const { createAppUtils } = require("../app/src/core/app-utils.js");

module.exports = [
  {
    name: "keeps date and time helpers deterministic after extraction",
    fn() {
      const utils = createAppUtils({ getFirstDayOfWeek: () => "monday", getTimeFormat: () => "24" });
      assert.equal(utils.addDays("2026-07-13", 1), "2026-07-14");
      assert.equal(utils.cleanTimeValue("9:05"), "09:05");
      assert.equal(utils.minutesToTime(15 * 60 + 30), "15:30");
      assert.deepEqual(utils.getWeekDates("2026-07-15"), [
        "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19",
      ]);
    },
  },
];
