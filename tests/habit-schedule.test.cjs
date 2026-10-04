const assert = require("node:assert/strict");
const schedule = require("../app/src/habits/habit-schedule.js");
const history = require("../app/src/habits/habit-config-history.js");

function habit(extra = {}) {
  return { id: "flex", startDate: "2026-09-14", type: "check", repeat: "weeklyGoal", weeklyTarget: 3,
    logs: {}, freezeDays: {}, reminderTime: "09:00", ...extra };
}
module.exports = [
  { name: "an unfinished today preserves yesterday's streak, a missed past day does not", fn() {
    const h = habit({ repeat: "daily", logs: { "2026-09-14": true, "2026-09-15": true } });
    assert.equal(schedule.streak(h, "2026-09-16", "2026-09-16"), 2);
    assert.equal(schedule.streak(h, "2026-09-16", "2026-09-17"), 0);
    assert.equal(schedule.streak(h, "2026-09-17", "2026-09-17"), 0);
    h.logs["2026-09-16"] = true;
    assert.equal(schedule.streak(h, "2026-09-16", "2026-09-16"), 3);
    const weekends = habit({ repeat: "weekends", startDate: "2026-09-19", logs: { "2026-09-19": true, "2026-09-20": true } });
    assert.equal(schedule.streak(weekends, "2026-09-26", "2026-09-26"), 2);
    const number = habit({ repeat: "daily", type: "number", goal: 10, logs: { "2026-09-14": 10, "2026-09-15": 10, "2026-09-16": 4 } });
    assert.equal(schedule.streak(number, "2026-09-16", "2026-09-16"), 2);
  } },
  { name: "flexible goals never create daily misses and count distinct complete days", fn() {
    const h = habit({ logs: { "2026-09-14": true, "2026-09-16": true, "2026-09-20": true } });
    assert.equal(schedule.statusOnDate(h, "2026-09-15"), "not-due");
    assert.equal(schedule.occursOn(h, "2026-09-15"), true);
    assert.equal(schedule.statusOnDate(h, "2026-09-14"), "complete");
    assert.equal(schedule.weekProgress(h, "2026-09-20").completed, 3);
    assert.equal(schedule.streak(h, "2026-09-22", "2026-09-22"), 1);
    assert.equal(schedule.streak(h, "2026-09-28", "2026-09-28"), 0);
    h.logs["2026-09-21"] = true; h.logs["2026-09-23"] = true; h.logs["2026-09-27"] = true;
    assert.equal(schedule.streak(h, "2026-09-28", "2026-09-28"), 2);
  } },
  { name: "freezes, pauses, numeric progress and shortened first weeks reduce only impossible targets", fn() {
    const h = habit({ type: "number", goal: 10, logs: { "2026-09-14": 10, "2026-09-15": 5 } });
    h.freezeDays["2026-09-16"] = { active: true };
    assert.equal(schedule.weekProgress(h, "2026-09-20").target, 3);
    assert.equal(schedule.weekProgress(h, "2026-09-20").completed, 1);
    for (let day = 16; day <= 20; day += 1) h.freezeDays[`2026-09-${day}`] = { active: true };
    assert.equal(schedule.weekProgress(h, "2026-09-20").target, 2);
    h.logs["2026-09-15"] = 10;
    assert.equal(schedule.weekProgress(h, "2026-09-20").achieved, true);
    assert.equal(schedule.weekProgress(habit({ startDate: "2026-09-20" }), "2026-09-20").target, 1);
    const paused = history.applyHabitAvailabilityChange(h, false, "2026-09-17");
    assert.equal(schedule.statusOnDate(paused, "2026-09-18"), "not-due");
    assert.equal(schedule.shouldRemind(paused, "2026-09-18"), false);
    const frozen = habit();
    for (let day = 14; day <= 20; day += 1) frozen.freezeDays[`2026-09-${day}`] = { active: true };
    assert.equal(schedule.weekProgress(frozen, "2026-09-20").target, 0);
    assert.equal(schedule.streak(frozen, "2026-09-21"), 0);
  } },
  { name: "history and calendar week boundaries preserve flexible goals", fn() {
    let h = habit({ startDate: "2026-12-28", weeklyTarget: 3 });
    h = history.applyHabitConfigChange(h, { ...h, weeklyTarget: 5 }, "2027-01-04");
    assert.equal(schedule.weekStart("2027-01-01"), "2026-12-28");
    assert.equal(schedule.weekProgress(h, "2027-01-01").target, 3);
    assert.equal(schedule.weekProgress(h, "2027-01-04").target, 5);
    assert.equal(schedule.weekStart("2028-02-29"), "2028-02-28");
    assert.equal(schedule.shouldRemind(h, "2027-01-04"), true);
    h.logs = { "2027-01-04": true, "2027-01-05": true, "2027-01-06": true, "2027-01-07": true, "2027-01-08": true };
    assert.equal(schedule.shouldRemind(h, "2027-01-09"), false);
    assert.equal(schedule.weekProgress(h, "2027-01-04", "2027-01-04").completed, 1);
  } },
  { name: "fixed habits retain their previous daily streak behavior", fn() {
    const h = habit({ repeat: "daily", logs: { "2026-09-14": true, "2026-09-15": true } });
    assert.equal(schedule.statusOnDate(h, "2026-09-16"), "missed");
    assert.equal(schedule.streak(h, "2026-09-15"), 2);
  } },
];
