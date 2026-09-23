const assert = require("node:assert/strict");
const profileSettings = require("../app/src/settings/profile-settings.js");

module.exports = [
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
