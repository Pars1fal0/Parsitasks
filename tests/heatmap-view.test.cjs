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
        statsForDate: () => ({ taskPercent: 50, taskDone: 4, taskTotal: 8, habitPercent: 50, habitDone: 1, habitTotal: 2 }),
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
      assert.equal(model.days[0].tooltip, "date 2025-07-01 (2025-07-01): задачи 4 из 8, привычки 1 из 2");
      assert.equal(model.days[0].taskPercent, 50);
      assert.equal(model.days[0].habitPercent, 50);
    },
  },
  {
    name: "marks a perfect day only when both tasks and habits are fully completed",
    fn() {
      const cases = [
        { taskDone: 2, taskTotal: 2, habitDone: 3, habitTotal: 3, expected: true },
        { taskDone: 1, taskTotal: 2, habitDone: 3, habitTotal: 3, expected: false },
        { taskDone: 2, taskTotal: 2, habitDone: 2, habitTotal: 3, expected: false },
        { taskDone: 0, taskTotal: 0, habitDone: 0, habitTotal: 0, expected: false },
        { taskDone: 0, taskTotal: 0, habitDone: 3, habitTotal: 3, expected: false },
        { taskDone: 2, taskTotal: 2, habitDone: 0, habitTotal: 0, habitFrozen: 2, expected: false },
        { taskDone: 199, taskTotal: 200, habitDone: 3, habitTotal: 3, expected: false },
        { taskDone: 2, taskTotal: 2, habitDone: 199, habitTotal: 200, expected: false },
      ];
      for (const { expected, ...stats } of cases) {
        const day = buildHeatmapModel({
          activeDate: "2026-10-21", formatLongDate: (date) => date, parseDate: parseDateKey,
          statsForDate: () => ({ taskPercent: 100, habitPercent: 100, ...stats }), toDateKey,
        }).days.at(-1);
        assert.equal(day.isPerfectDay, expected, JSON.stringify(stats));
        assert.equal(day.tooltip.includes("Всё выполнено"), expected);
      }
    },
  },
  {
    name: "shows frozen habits separately from required completions",
    fn() {
      const model = buildHeatmapModel({
        activeDate: "2026-09-25",
        formatLongDate: (date) => date,
        parseDate: parseDateKey,
        statsForDate: () => ({ taskPercent: 0, habitPercent: 0, habitDone: 0, habitTotal: 0, habitFrozen: 2 }),
        toDateKey,
      });
      assert.match(model.days.at(-1).tooltip, /привычки 0 из 0, заморожено 2/);
      assert.match(model.days.at(-1).tooltip, /задачи 0 из 0/);
      assert.equal(model.days.at(-1).tooltip.includes("%"), false);
      assert.equal(model.days.at(-1).habitFrozen, 2);
    },
  },
];
