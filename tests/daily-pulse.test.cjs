const assert = require("node:assert/strict");
const { createDailyPulse, percent } = require("../app/src/core/daily-pulse.js");

module.exports = [
  {
    name: "calculates a balanced task and habit pulse",
    fn() {
      const els = Object.fromEntries([
        "focusTitle", "focusMeta", "focusPercent", "focusBar", "todayOpenMetric", "todayDoneMetric",
        "habitDoneMetric", "habitFrozenMetric", "sideProgressValue", "sideProgressBar", "sideProgressSummary",
      ].map((key) => [key, { style: {}, textContent: "" }]));
      const controller = createDailyPulse({
        els,
        getTasks: () => [{ id: "done", title: "Готово" }, { id: "open", title: "Следующая" }],
        getHabits: () => [{ id: "habit" }],
        isTaskDone: (task) => task.id === "done",
        isHabitComplete: () => true,
        taskDetails: () => ["10:00", "Работа"],
      });
      const result = controller.render("2026-08-09");
      assert.equal(result.taskPercent, 50);
      assert.equal(result.habitPercent, 100);
      assert.equal(result.pulse, 75);
      assert.equal(els.focusTitle.textContent, "Следующая");
      assert.equal(els.sideProgressSummary.textContent, "Задачи 50% · привычки 100%");
    },
  },
  {
    name: "keeps empty progress at zero",
    fn() {
      assert.equal(percent(0, 0), 0);
      assert.equal(percent(1, 3), 33);
    },
  },
  {
    name: "treats an all-frozen habit day as neutral",
    fn() {
      const els = Object.fromEntries([
        "focusTitle", "focusMeta", "focusPercent", "focusBar", "todayOpenMetric", "todayDoneMetric",
        "habitDoneMetric", "habitFrozenMetric", "sideProgressValue", "sideProgressBar", "sideProgressSummary",
      ].map((key) => [key, { style: {}, textContent: "" }]));
      const pulse = createDailyPulse({
        els,
        getTasks: () => [{ id: "done", title: "Задача" }],
        getHabits: () => [{ id: "frozen" }],
        isTaskDone: () => true,
        habitStatusOnDate: () => "frozen",
        taskDetails: () => [],
      }).render("2026-09-25");
      assert.equal(pulse.pulse, 100);
      assert.equal(pulse.frozenHabits, 1);
      assert.equal(els.habitDoneMetric.textContent, "0/0");
      assert.equal(els.habitFrozenMetric.textContent, "Заморожено 1");
    },
  },
];
