const assert = require("node:assert/strict");
const { createSettingsState } = require("../app/src/settings/settings-state.js");

module.exports = [
  {
    name: "normalizes imported settings and keeps all interface settings device-local",
    fn() {
      const settingsState = createSettingsState({
        cleanText: (value) => String(value || "").trim(),
        validBackupSchedules: ["0", "5", "15", "30", "60"],
      });

      const normalized = settingsState.normalizeImportedSettings({
        accentPreference: "pink-neon",
        backupSchedule: "999",
        remoteSyncAnonKey: " secret ",
        remoteSyncPending: true,
        remoteSyncUrl: " https://demo.supabase.co ",
        themePreference: "neon",
      });
      const remoteSafe = settingsState.createRemoteUiSettings(normalized, { remoteSyncLastPushedAt: "2026-07-02T10:00:00.000Z" });

      assert.equal(normalized.backupSchedule, "5");
      assert.equal(normalized.accentPreference, "emerald");
      assert.equal(normalized.themePreference, "dark");
      assert.equal(Object.hasOwn(normalized, "remoteSyncAnonKey"), false);
      assert.equal(Object.hasOwn(normalized, "remoteSyncUrl"), false);
      assert.deepEqual(remoteSafe, {});
      assert.equal(settingsState.isRemoteVersionNewer("2026-07-02T10:05:00.000Z", "2026-07-02T10:00:00.000Z"), true);
      assert.equal(settingsState.isRemoteVersionNewer("2026-07-02T09:55:00.000Z", "2026-07-02T10:00:00.000Z"), false);
      assert.equal(settingsState.normalizeAccentPreference("orange"), "orange");
    },
  },
];
