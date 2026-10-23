const assert = require("node:assert/strict");
const { createDailyPulse, percent, pluralDays, shiftDateKey } = require("../app/src/core/daily-pulse.js");

module.exports = [
  {
    name: "calculates a balanced task and habit pulse",
    fn() {
      const els = Object.fromEntries([
        "focusTitle", "focusMeta", "focusPercent", "focusBar", "todayOpenMetric", "todayDoneMetric",
        "habitDoneMetric", "habitFrozenMetric", "sideProgressValue", "sideProgressBar", "sideProgressSummary", "dayProgressValue", "dayProgressSummary", "dayProgressBar",
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
      assert.equal(els.sideProgressSummary.textContent, "Задачи: 1 из 2 · Привычки: 1 из 1");
      assert.equal(els.sideProgressValue.textContent, "75%");
      assert.equal(els.dayProgressValue.textContent, "75%");
      assert.equal(els.dayProgressBar.style.width, "75%");
      assert.equal(els.dayProgressSummary.textContent, "Задачи: 1 из 2 · Привычки: 1 из 1");
      assert.equal(els.focusPercent.textContent, "1 из 2 задач");
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
    name: "shows a neutral state when nothing is planned",
    fn() {
      const els = Object.fromEntries([
        "focusTitle", "focusMeta", "focusPercent", "focusBar", "todayOpenMetric", "todayDoneMetric",
        "habitDoneMetric", "habitFrozenMetric", "sideProgressValue", "sideProgressBar", "sideProgressSummary",
      ].map((key) => [key, { style: {}, textContent: "" }]));
      createDailyPulse({
        els,
        getTasks: () => [],
        getHabits: () => [],
        isTaskDone: () => false,
        isHabitComplete: () => false,
      }).render("2026-09-26");
      assert.equal(els.focusPercent.textContent, "—");
      assert.equal(els.habitDoneMetric.textContent, "—");
      assert.equal(els.sideProgressValue.textContent, "—");
      assert.equal(els.sideProgressSummary.textContent, "Нет обязательных дел");
    },
  },
  {
    name: "omits empty categories from the day summary",
    fn() {
      const els = Object.fromEntries([
        "focusTitle", "focusMeta", "focusPercent", "focusBar", "todayOpenMetric", "todayDoneMetric",
        "habitDoneMetric", "habitFrozenMetric", "sideProgressValue", "sideProgressBar", "sideProgressSummary",
      ].map((key) => [key, { style: {}, textContent: "" }]));
      createDailyPulse({
        els,
        getTasks: () => [],
        getHabits: (date) => date === "2026-09-26" ? [{ id: "habit" }] : [],
        isTaskDone: () => false,
        isHabitComplete: () => true,
      }).render("2026-09-26");
      assert.equal(els.sideProgressSummary.textContent, "Привычки: 1 из 1");
      assert.equal(els.sideProgressValue.textContent, "100%");
      assert.equal(els.focusPercent.textContent, "—");
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
      assert.equal(els.sideProgressValue.textContent, "100%");
      assert.equal(pulse.frozenHabits, 1);
      assert.equal(els.habitDoneMetric.textContent, "—");
      assert.equal(els.habitFrozenMetric.textContent, "Заморожено 1");
    },
  },
  {
    name: "counts a streak of fully closed days and celebrates only a fresh completion",
    fn() {
      const els = Object.fromEntries([
        "focusTitle", "focusMeta", "focusPercent", "focusBar", "todayOpenMetric", "todayDoneMetric",
        "habitDoneMetric", "habitFrozenMetric", "sideProgressValue", "sideProgressBar", "sideProgressSummary", "dayProgressValue", "dayProgressSummary", "dayProgressBar",
      ].map((key) => [key, { style: {}, textContent: "" }]));
      const done = new Set(["2026-10-20", "2026-10-21"]);
      const celebrations = [];
      const controller = createDailyPulse({
        els,
        getTasks: (date) => date === "2026-10-19" ? [] : date >= "2026-10-17" ? [{ id: date, title: date }] : [],
        getHabits: () => [],
        isTaskDone: (task) => done.has(task.id) || task.id <= "2026-10-18",
        isHabitComplete: () => false,
        onDayComplete: (event) => celebrations.push(event),
        taskDetails: () => [],
      });
      let result = controller.render("2026-10-22");
      assert.equal(result.perfect, false);
      assert.equal(result.streak, 4, "an empty day is neutral and an unfinished selected day keeps the run");
      assert.match(els.sideProgressSummary.textContent, /Серия 100%: 4 дня$/);
      done.add("2026-10-22");
      result = controller.render("2026-10-22");
      assert.equal(result.streak, 5);
      assert.deepEqual(celebrations, [{ dateKey: "2026-10-22", streak: 5 }]);
      controller.render("2026-10-22");
      controller.render("2026-10-21");
      assert.equal(celebrations.length, 1, "re-rendering or revisiting a closed day does not celebrate again");
    },
  },
  {
    name: "formats day counts and shifts date keys across months",
    fn() {
      assert.deepEqual([1, 2, 5, 11, 21, 22, 112].map(pluralDays), ["день", "дня", "дней", "дней", "день", "дня", "дней"]);
      assert.equal(shiftDateKey("2026-03-01", -1), "2026-02-28");
      assert.equal(shiftDateKey("2026-12-31", 1), "2027-01-01");
    },
  },
];
