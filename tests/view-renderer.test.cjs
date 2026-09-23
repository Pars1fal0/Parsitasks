const assert = require("node:assert/strict");
const { createViewRenderer } = require("../app/src/core/view-renderer.js");

module.exports = [
  {
    name: "renders only the active view and shared pulse",
    fn() {
      const calls = [];
      const names = ["renderArchive", "renderCategories", "renderDailyPulse", "renderGoals", "renderHabits", "renderJournal", "renderNutrition", "renderOverview", "renderTasks", "renderTimeline", "renderWeekdayLabels"];
      const ctx = Object.fromEntries(names.map((name) => [name, () => calls.push(name)]));
      createViewRenderer(ctx).render("timeline");
      assert.deepEqual(calls, ["renderDailyPulse", "renderCategories", "renderTimeline"]);
      calls.length = 0;
      createViewRenderer(ctx).render("journal");
      assert.deepEqual(calls, ["renderDailyPulse", "renderJournal"]);
      calls.length = 0;
      createViewRenderer(ctx).render("nutrition");
      assert.deepEqual(calls, ["renderDailyPulse", "renderNutrition"]);
    },
  },
];
