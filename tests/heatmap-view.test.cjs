const assert = require("node:assert/strict");
const { buildHeatmapModel, visibleMonthSpans } = require("../app/src/calendar/heatmap-view.js");
const { createAppUtils } = require("../app/src/core/app-utils.js");
const { parseDateKey, toDateKey } = require("./test-utils.cjs");

module.exports = [
  {
    name: "heatmap makes substantial progress bright while keeping empty days muted",
    fn() {
      const { heatAlpha } = createAppUtils();
      assert.equal(Number(heatAlpha(0)), 0);
      assert.ok(Number(heatAlpha(80)) >= 0.9, "four of five tasks must look almost complete");
      const values = [0, 20, 50, 80, 100].map((percent) => Number(heatAlpha(percent)));
      assert.ok(values.every((value, index) => index === 0 || value > values[index - 1]));
      assert.equal(values.at(-1), 1);
    },
  },
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
      assert.equal(model.monthSpans[0].label, "июл");
      assert.ok(model.monthSpans.every((item) => item.span >= 1));
      assert.equal(model.days[0].tooltip, "date 2025-07-01 (2025-07-01): задачи 4 из 8, привычки 1 из 2");
      assert.equal(model.days[0].taskPercent, 50);
      assert.equal(model.days[0].habitPercent, 50);
    },
  },
  {
    name: "month labels use three letters and hide fragments shorter than three weeks",
    fn() {
      const model = buildHeatmapModel({ activeDate: "2026-10-28", formatLongDate: (date) => date, parseDate: parseDateKey,
        statsForDate: () => ({}), toDateKey });
      assert.ok(model.monthSpans.every((item) => item.label.length === 3));
      assert.deepEqual([...new Set(model.monthSpans.map((item) => item.label))].sort(), ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"].sort());
      const visible = visibleMonthSpans(model.monthSpans, 0, model.columns);
      assert.ok(visible.every((item) => item.span >= 3));
      assert.ok(!visible.some((item) => item.column === 0 && item.label === "окт"), "the partial opening October cannot collide with November");
      assert.deepEqual(visibleMonthSpans([{ column: 0, span: 5, label: "янв" }], 3, 5), []);
      assert.deepEqual(visibleMonthSpans([{ column: 0, span: 5, label: "янв" }], 2, 5), [{ column: 2, span: 3, label: "янв" }]);
    },
  },
  {
    name: "data range trims only the unused beginning and retains gaps and frozen days",
    fn() {
      const options = { activeDate: "2026-10-28", formatLongDate: (date) => date, parseDate: parseDateKey, toDateKey,
        statsForDate: (date) => date === "2026-10-01" ? { habitFrozen: 1 } : date === "2026-10-05" ? { taskTotal: 2, taskDone: 0 } : {} };
      const trimmed = buildHeatmapModel({ ...options, range: "tracking" });
      assert.equal(trimmed.days[0].dateKey, "2026-10-01");
      assert.equal(trimmed.days.at(-1).dateKey, options.activeDate);
      assert.equal(trimmed.days.length, 28);
      assert.ok(trimmed.columns <= 5);
      assert.equal(buildHeatmapModel(options).days.length, 365);
      const empty = buildHeatmapModel({ ...options, range: "tracking", statsForDate: () => ({}) });
      assert.equal(empty.days.length, 1);
      assert.equal(empty.days[0].dateKey, options.activeDate);
    },
  },
  {
    name: "golden heatmap halves use exact completions and never count empty or frozen-only categories",
    fn() {
      const cases = [
        [{ taskDone: 5, taskTotal: 5, habitDone: 1, habitTotal: 2 }, [true, false]],
        [{ taskDone: 4, taskTotal: 5, habitDone: 2, habitTotal: 2 }, [false, true]],
        [{ taskDone: 5, taskTotal: 5, habitDone: 2, habitTotal: 2 }, [true, true]],
        [{ taskDone: 0, taskTotal: 0, habitDone: 0, habitTotal: 0 }, [false, false]],
        [{ taskDone: 5, taskTotal: 5, habitDone: 0, habitTotal: 0, habitFrozen: 2 }, [true, false]],
        [{ taskDone: 0, taskTotal: 0, habitDone: 2, habitTotal: 2 }, [false, true]],
        [{ taskDone: 199, taskTotal: 200, habitDone: 199, habitTotal: 200 }, [false, false]],
      ];
      for (const [stats, expected] of cases) {
        const day = buildHeatmapModel({ activeDate: "2026-10-28", formatLongDate: (date) => date,
          parseDate: parseDateKey, statsForDate: () => ({ taskPercent: 100, habitPercent: 100, ...stats }), toDateKey }).days.at(-1);
        assert.deepEqual([day.areTasksComplete, day.areHabitsComplete], expected);
        assert.equal(day.isPerfectDay, expected.every(Boolean));
      }
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
