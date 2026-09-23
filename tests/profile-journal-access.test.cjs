const assert = require("node:assert/strict");
const { normalizeProfile } = require("../app/src/settings/profile-settings.js");
const { mergeStates } = require("../app/src/core/state-merge.js");

module.exports = [
  {
    name: "normalizes independent MCP journal permissions",
    fn() {
      assert.deepEqual(normalizeProfile({
        journalAccess: { read: false, write: true },
      }).journalAccess, { read: false, write: true });
      assert.deepEqual(normalizeProfile({}).journalAccess, { read: true, write: true });
    },
  },
  {
    name: "keeps the newest synchronized journal privacy choice",
    fn() {
      const merged = mergeStates(
        { profile: { timeZone: "Europe/Moscow", journalAccess: { read: true, write: true }, updatedAt: "2026-07-25T10:00:00.000Z" } },
        { profile: { timeZone: "Europe/Moscow", journalAccess: { read: false, write: true }, updatedAt: "2026-07-25T11:00:00.000Z" } },
      );
      assert.equal(merged.profile.journalAccess.read, false);
    },
  },
];
