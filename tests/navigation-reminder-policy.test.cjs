const assert = require("node:assert/strict");
const navigation = require("../app/src/settings/navigation-preferences.js");
const policy = require("../app/src/platform/reminder-policy.js");
const { createSettingsState } = require("../app/src/settings/settings-state.js");

module.exports = [
  { name: "normalizes navigation without hiding settings or duplicating bottom slots", fn() {
    assert.deepEqual(navigation.normalize(), { hidden: ["timeline", "goals", "study", "nutrition", "journal", "board", "archive"], mobile: ["tasks", "habits", "overview"] });
    assert.deepEqual(navigation.normalize(null), navigation.normalize());
    assert.deepEqual(navigation.normalize({ hidden: [], mobile: ["tasks", "timeline", "habits", "overview"] }), { hidden: [], mobile: ["tasks", "timeline", "habits", "overview"] });
    assert.deepEqual(navigation.normalize({ hidden: [] }).hidden, []);
    const prefs = navigation.normalize({ hidden: ["settings", "board", "bad", "toString"], mobile: ["study", "journal", "journal", "board", "tasks", "habits", "goals"] });
    assert.deepEqual(prefs, { hidden: ["board"], mobile: ["study", "journal", "tasks", "habits"] });
    assert.deepEqual(navigation.normalize({ hidden: Object.keys(navigation.LABELS), mobile: [] }), { hidden: Object.keys(navigation.LABELS).filter((view) => view !== "settings"), mobile: ["settings"] });
  } },
  { name: "preserves device-local navigation and quiet hours through settings import", fn() {
    const prefs = { hidden: ["nutrition"], mobile: ["study", "journal"] };
    const quiet = { enabled: true, start: "23:30", end: "07:15" };
    const settings = createSettingsState().normalizeImportedSettings({ navigationPreferences: prefs, quietHours: quiet });
    assert.deepEqual(settings.navigationPreferences, prefs);
    assert.deepEqual(settings.quietHours, quiet);
    assert.deepEqual(createSettingsState().createRemoteUiSettings(settings), {});
  } },
  { name: "defers night reminders to the following allowed calendar time", fn() {
    const quiet = { enabled: true, start: "22:00", end: "08:00" };
    assert.equal(policy.nextAllowed(new Date(2026, 11, 31, 23, 30), quiet).getTime(), new Date(2027, 0, 1, 8).getTime());
    assert.equal(policy.nextAllowed(new Date(2026, 8, 30, 7, 59), quiet).getTime(), new Date(2026, 8, 30, 8).getTime());
    assert.equal(policy.nextAllowed(new Date(2026, 8, 30, 8), quiet).getTime(), new Date(2026, 8, 30, 8).getTime());
    assert.equal(policy.nextAllowed(new Date(2026, 8, 30, 22), quiet).getTime(), new Date(2026, 9, 1, 8).getTime());
  } },
  { name: "handles daytime quiet hours, disabled hours and malformed preferences", fn() {
    const date = new Date(2026, 8, 30, 12, 30);
    assert.equal(policy.nextAllowed(date, { enabled: true, start: "12:00", end: "14:00" }).getHours(), 14);
    assert.equal(policy.nextAllowed(date, { enabled: false }).getTime(), date.getTime());
    assert.equal(policy.normalizeQuietHours({ enabled: true, start: "08:00", end: "08:00" }).enabled, false);
    assert.deepEqual(policy.normalizeQuietHours(null), { enabled: false, start: "22:00", end: "08:00" });
    assert.deepEqual(policy.normalizeQuietHours({ start: "25:99", end: "bad" }), { enabled: false, start: "22:00", end: "08:00" });
  } },
  { name: "snoozes without changing the task date and respects year boundaries", fn() {
    const now = new Date(2026, 11, 31, 23, 55);
    assert.equal(policy.snoozeUntil(now, "10").getTime(), new Date(2027, 0, 1, 0, 5).getTime());
    assert.equal(policy.snoozeUntil(now, "tomorrow").getTime(), new Date(2027, 0, 1, 9).getTime());
    assert.equal(now.getFullYear(), 2026);
  } },
];
