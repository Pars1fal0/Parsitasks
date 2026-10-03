const assert = require("node:assert/strict");
const profileSettings = require("../app/src/settings/profile-settings.js");

module.exports = [
  {
    name: "merges account preferences per field and rejects device credentials",
    fn() {
      const old = "2026-10-01T10:00:00.000Z", next = "2026-10-01T11:00:00.000Z";
      const merged = profileSettings.mergePreferences({
        themePreference: { value: "light", updatedAt: next },
        firstDayOfWeek: { value: "monday", updatedAt: old },
      }, {
        themePreference: { value: "dark", updatedAt: old },
        firstDayOfWeek: { value: "sunday", updatedAt: next },
        remoteSyncAnonKey: { value: "secret", updatedAt: next },
        notificationSetting: { value: "off", updatedAt: next },
        accentPreference: { value: "blue", updatedAt: "invalid" },
      });
      assert.equal(merged.themePreference.value, "light");
      assert.equal(merged.firstDayOfWeek.value, "sunday");
      assert.equal(Object.hasOwn(merged, "remoteSyncAnonKey"), false);
      assert.equal(Object.hasOwn(merged, "notificationSetting"), false);
      assert.equal(Object.hasOwn(merged, "accentPreference"), false);
      assert.equal(profileSettings.mergePreferences(merged, { themePreference: { value: "dark", updatedAt: "1970-01-01T00:00:00.000Z" } }).themePreference.value, "light");
    },
  },
  {
    name: "normalizes valid IANA time zones and rejects invalid values",
    fn() {
      assert.equal(profileSettings.normalizeTimeZone("Asia/Yekaterinburg"), "Asia/Yekaterinburg");
      assert.equal(profileSettings.normalizeTimeZone("not/a-zone", "Europe/Moscow"), "Europe/Moscow");
      assert.equal(
        profileSettings.normalizeProfile({
          timeZone: "Europe/Samara",
          updatedAt: "2026-07-25T10:00:00.000Z",
        }).updatedAt,
        "2026-07-25T10:00:00.000Z",
      );
    },
  },
];
