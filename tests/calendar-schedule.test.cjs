const assert = require("node:assert/strict");
const { freeIntervals, quarterMinute } = require("../app/src/calendar/calendar-schedule.js");
const { buildHash, parseHash } = require("../app/src/core/navigation-state.js");

module.exports = [
  { name: "calendar clicks and drops use the quarter hour under the pointer", fn() {
    assert.equal(quarterMinute(9.75 * 96 + 1, 96), 585);
    assert.equal(quarterMinute(9.25 * 96, 96), 555);
    assert.equal(quarterMinute(-10, 96), 0);
    assert.equal(quarterMinute(25 * 96, 96), 1425);
  } },
  { name: "day calendar has a stable deep link", fn() {
    assert.equal(buildHash("overview", "day"), "#calendar/day");
    assert.deepEqual(parseHash("#calendar/day"), { view: "overview", overviewMode: "day" });
  } },
  { name: "free time merges overlapping blocks and lessons, not deadline markers", fn() {
    assert.deepEqual(freeIntervals([
      { isTimeBlock: true, minutes: 480, endMinutes: 570 },
      { isTimeBlock: true, minutes: 540, endMinutes: 600 },
      { isTimeBlock: false, minutes: 630, endMinutes: 660 },
      { isTimeBlock: true, minutes: 720, endMinutes: 780 },
    ], 480, 900), [{ start: 600, end: 720 }, { start: 780, end: 900 }]);
  } },
  { name: "free time is clipped to the requested day range", fn() {
    assert.deepEqual(freeIntervals([{ isTimeBlock: true, minutes: 300, endMinutes: 600 },
      { isTimeBlock: true, minutes: 800, endMinutes: 1440 }], 480, 900), [{ start: 600, end: 800 }]);
    assert.deepEqual(freeIntervals([], 480, 900), [{ start: 480, end: 900 }]);
    assert.deepEqual(freeIntervals([{ isTimeBlock: true, minutes: 0, endMinutes: 1440 }], 480, 900), []);
  } },
  { name: "calendar completion and scheduling live beside the schedule view", async fn() {
    const { toggleTaskDone, scheduleTask } = require("../app/src/calendar/calendar-schedule.js");
    const recurrence = require("../app/src/tasks/recurrence.js");
    const task = { id: "task", title: "Созвон", date: "2026-10-05", repeat: "none", completed: {}, scheduleMode: "block", startTime: "10:00", endTime: "11:00", time: "11:00", notified: {} };
    const state = { tasks: [task], taskOrder: {} };
    const renders = [];
    const toasts = [];
    const base = {
      confirmDiscardOpenForms: async () => true,
      getState: () => state,
      render: () => renders.push("render"),
      taskOccursOn: (item, date) => recurrence.taskScheduledOn(item, date) && item.excludedDates?.[date] !== true,
      isTaskDone: (item, date) => item.completed?.[date] === true,
      createUndoSnapshot: () => ({ state: JSON.stringify(state) }),
      saveState: () => true,
      restoreState: () => {},
      showToast: (message) => toasts.push(message),
      saveUiState: () => {},
      setActiveDate: () => {},
      formatLongDate: (date) => date,
    };
    assert.equal(await toggleTaskDone(base, "task", "2026-10-05"), true);
    assert.equal(task.completed["2026-10-05"], true);
    assert.equal(toasts.at(-1), "Задача выполнена");
    let restored = null;
    const undone = { ...base, saveState: () => false, restoreState: (undo) => { restored = JSON.parse(undo.state); } };
    assert.equal(await toggleTaskDone(undone, "task", "2026-10-05"), false);
    assert.equal(restored.tasks[0].completed["2026-10-05"], true);

    let timed = "";
    assert.equal(await scheduleTask({ ...base, setTaskTime: async (_id, start) => { timed = start; return true; } }, "task", "2026-10-05", "2026-10-05", "12:00"), true);
    assert.equal(timed, "12:00");

    const dates = [];
    assert.equal(await scheduleTask({ ...base, createId: () => "copy", taskScheduledOn: recurrence.taskScheduledOn, isTimeBlock: (item) => item.scheduleMode === "block", timeToMinutes: (value) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }, minutesToTime: (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`, setActiveDate: (date) => dates.push(date) }, "task", "2026-10-05", "2026-10-06", "15:00"), true);
    assert.equal(task.date, "2026-10-06");
    assert.equal(task.startTime, "15:00");
    assert.equal(task.endTime, "16:00");
    assert.equal(dates.at(-1), "2026-10-06");
    assert.match(toasts.at(-1), /2026-10-06/);

    const series = { id: "series", title: "Повтор", date: "2026-10-01", repeat: "daily", completed: {}, time: "09:00" };
    const seriesState = { tasks: [series], taskOrder: {} };
    let confirmed = false;
    assert.equal(await scheduleTask({ ...base, getState: () => seriesState, confirmAction: async () => { confirmed = true; return false; } }, "series", "2026-10-05", "2026-10-06", "15:00"), false);
    assert.equal(confirmed, true);
    assert.equal(series.date, "2026-10-01");
    assert.equal(seriesState.tasks.length, 1);
  } },
];
