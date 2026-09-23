const assert = require("node:assert/strict");
const { buildHeatmapModel } = require("../app/src/calendar/heatmap-view.js");
const { parseDateKey, toDateKey } = require("./test-utils.cjs");

module.exports = [
  {
    name: "builds a year model with month labels and dated tooltips",
    fn() {
      const model = buildHeatmapModel({
        activeDate: "2026-06-30",
        formatLongDate: (dateKey) => `date ${dateKey}`,
        parseDate: parseDateKey,
        statsForDate: () => ({ taskPercent: 25, habitPercent: 50 }),
        toDateKey,
      });

      assert.equal(model.days.length, 365);
      assert.equal(model.days[0].dateKey, "2025-07-01");
      assert.equal(model.days.at(-1).dateKey, "2026-06-30");
      assert.equal(model.columns, 53);
      assert.equal(model.monthLabels.some(Boolean), true);
      assert.equal(model.monthSpans.length, 12);
      assert.equal(model.monthSpans[0].label, "июль");
      assert.ok(model.monthSpans.every((item) => item.span >= 1));
      assert.equal(model.days[0].tooltip, "date 2025-07-01 (2025-07-01): задачи 25%, привычки 50%");
    },
  },
];
