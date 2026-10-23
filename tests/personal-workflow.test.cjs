const assert = require("node:assert/strict");
const { findFreeSlots, normalizePlanning, minuteOf, timeOf } = require("../app/src/calendar/free-time.js");
const { mergeFocusSessions, normalizeFocusSessions, focusStats } = require("../app/src/core/focus-history.js");
const { normalizeState } = require("../app/src/core/document-state.js");
const { mergeStates } = require("../app/src/core/state-merge.js");
const { createAutoBackup } = require("../app/src/core/auto-backup.js");

module.exports = [
  { name: "free-time search respects lessons, overlaps, deadlines and actual time", fn() {
    const entries = [
      { isTimeBlock: true, minutes: 540, endMinutes: 600 },
      { isTimeBlock: true, minutes: 570, endMinutes: 615 },
      { isTimeBlock: false, minutes: 630, endMinutes: 660 },
    ];
    const slots = findFreeSlots([
      { date: "2026-10-22", entries: [] },
      { date: "2026-10-23", entries },
      { date: "2026-10-24", entries: [] },
    ], { start: "08:00", end: "13:00", duration: 45 }, { today: "2026-10-23", nowMinute: 500, dueDate: "2026-10-23", dueTime: "11:00" });
    assert.deepEqual(slots, [{ date: "2026-10-23", start: 615, end: 660, availableEnd: 660 }]);
    assert.deepEqual(findFreeSlots([{ date: "2026-10-23", entries }], { duration: 60 }, { today: "2026-10-23", nowMinute: 1400 }), []);
    assert.deepEqual(normalizePlanning(null), { start: "08:00", end: "22:00", duration: 60, updatedAt: "" });
    assert.equal(minuteOf("24:00"), null);
    assert.equal(timeOf(585), "09:45");
  } },
  { name: "focus history merges independently and idempotently without discarding old days", fn() {
    const a = { id: "session-a", date: "2024-01-01", minutes: 25, count: 1, taskId: "a" };
    const b = { ...a, id: "session-b", date: "2026-10-23", minutes: 15 };
    assert.deepEqual(focusStats(mergeFocusSessions([a], [a, b]), b.date), { count: 1, minutes: 15 });
    assert.equal(mergeFocusSessions([a], [a, b]).length, 2);
    assert.deepEqual(mergeFocusSessions([a], [{ ...a, taskId: "z" }]), mergeFocusSessions([{ ...a, taskId: "z" }], [a]));
    assert.deepEqual(mergeFocusSessions({}, null), []);
    assert.deepEqual(normalizeFocusSessions([{ ...a, date: "2026-02-30" }, { ...a, minutes: -1 }]), []);
    const left = normalizeState({ focusSessions: [a], tasks: [] });
    const right = normalizeState({ focusSessions: [b], tasks: [] });
    assert.equal(mergeStates(left, right).focusSessions.length, 2);
    assert.equal(normalizeState(mergeStates(left, right)).focusSessions.length, 2);
  } },
  { name: "planning preferences merge separately from unrelated account settings", fn() {
    const a = normalizeState({ profile: { planning: { start: "09:00", end: "18:00", duration: 30, updatedAt: "2026-10-23T10:00:00Z" } } });
    const b = normalizeState({ profile: { updatedAt: "2026-10-23T11:00:00Z", timeZone: "Europe/Saratov" } });
    assert.equal(mergeStates(a, b).profile.planning.start, "09:00");
    assert.equal(mergeStates(a, b).profile.timeZone, "Europe/Saratov");
  } },
  { name: "automatic backup ignores stale account callbacks and does not overlap", async fn() {
    let owner = "a", callback, release, writes = 0;
    const next = [], saved = [], errors = [];
    const controller = createAutoBackup({ getOwner: () => owner, setInterval: (fn) => { callback = fn; return 1; }, clearInterval() {},
      onNext: (value) => next.push(value), onSaved: (value) => saved.push(value), onError: () => errors.push(1),
      backupLocal: () => ({ ok: true }), backupFile: () => { writes++; return new Promise((resolve) => { release = resolve; }); } });
    controller.schedule(5);
    const old = callback;
    const pending = callback();
    await callback(); assert.equal(writes, 1);
    owner = "b"; controller.schedule(15);
    const length = next.length;
    release({ ok: true }); await pending; await old();
    assert.equal(saved.length, 0); assert.equal(next.length, length); assert.equal(writes, 1);
    const current = callback(); release({ ok: true }); await current;
    assert.equal(saved.length, 1); assert.deepEqual(errors, []);
    controller.stop();
  } },
];
