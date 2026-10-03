const assert = require("node:assert/strict");
const { buildActivitySeries } = require("../app/src/calendar/activity-charts.js");
const helpers = {
  parseDate: (key) => new Date(`${key}T12:00:00`),
  toDateKey: (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
  statsForDate: () => ({ taskDone: 1, taskTotal: 2, habitDone: 2, habitTotal: 3, habitFlexibleDone: 1 }),
};
module.exports = [
  { name: "activity series ends on the selected historical day and includes both boundaries", fn() {
    const series = buildActivitySeries({ ...helpers, endDate: "2026-10-03", today: "2026-10-06", days: 30 });
    assert.equal(series.length, 30); assert.equal(series[0].date, "2026-09-04"); assert.equal(series.at(-1).date, "2026-10-03");
    assert.equal(series[0].taskDone, 1); assert.equal(series[0].taskTotal, 2);
  } },
  { name: "future selections never create artificial missed days in activity charts", fn() {
    const series = buildActivitySeries({ ...helpers, endDate: "2027-01-20", today: "2026-10-03", days: 7 });
    assert.equal(series[0].date, "2026-09-27"); assert.equal(series.at(-1).date, "2026-10-03");
  } },
  { name: "flexible weekly completions are not mistaken for mandatory daily habits", fn() {
    const [point] = buildActivitySeries({ ...helpers, endDate: "2026-10-03", today: "2026-10-03", days: 1 });
    assert.equal(point.habitDone, 1); assert.equal(point.habitTotal, 2); assert.equal(point.habitPercent, 50);
  } },
  { name: "days without scheduled habits remain gaps rather than zero or perfect scores", fn() {
    const [point] = buildActivitySeries({ ...helpers, statsForDate: () => ({ taskDone: 0, taskTotal: 0, habitDone: 1, habitTotal: 1, habitFlexibleDone: 1 }), endDate: "2026-10-03", today: "2026-10-03", days: 1 });
    assert.equal(point.habitPercent, null); assert.equal(point.habitTotal, 0);
  } },
  { name: "chart ranges cross leap years without duplicate or missing local dates", fn() {
    const series = buildActivitySeries({ ...helpers, endDate: "2024-03-01", today: "2026-10-03", days: 3 });
    assert.deepEqual(series.map((point) => point.date), ["2024-02-28", "2024-02-29", "2024-03-01"]);
  } },
];
