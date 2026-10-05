const assert = require("node:assert/strict");
const { freeIntervals, quarterMinute, zoomHeight, anchoredScroll } = require("../app/src/calendar/calendar-schedule.js");
const { buildHash, parseHash } = require("../app/src/core/navigation-state.js");

module.exports = [
  { name: "calendar touch zoom bounds and keeps the same hour under the fingers", fn() {
    assert.equal(zoomHeight(10), 48);
    assert.equal(zoomHeight(500), 192);
    assert.equal(zoomHeight("invalid"), 72);
    const before = 700, anchor = 240, oldHeight = 72, nextHeight = 120;
    const after = anchoredScroll(before, oldHeight, nextHeight, anchor);
    assert.equal((before + anchor - 48) / oldHeight, (after + anchor - 48) / nextHeight);
    assert.equal(anchoredScroll(0, 192, 48, 200), 0);
  } },
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
];
