const assert = require("node:assert/strict");
const { createSettingsTransfer, exportableSettings } = require("../app/src/settings/settings-transfer.js");

module.exports = [
  {
    name: "never exports database endpoints or synchronization state",
    fn() {
      assert.deepEqual(exportableSettings({
        accentPreference: "blue",
        remoteSyncAccountId: "user-id",
        remoteSyncAnonKey: "public-key",
        remoteSyncEnabled: "on",
        remoteSyncUrl: "https://attacker.supabase.co",
        themePreference: "dark",
      }), {
        accentPreference: "blue",
        themePreference: "dark",
      });
    },
  },
  {
    name: "imports settings and clears the selected file",
    async fn() {
      const calls = [];
      const input = {
        files: [{ text: async () => JSON.stringify({ settings: { themePreference: "light" } }) }],
        value: "settings.json",
      };
      const transfer = createSettingsTransfer({
        applyImportedSettings: (settings) => calls.push(["apply", settings]),
        els: { settingsImportFile: input },
        render: () => calls.push(["render"]),
        saveUiState: () => calls.push(["save"]),
        showToast: (message) => calls.push(["toast", message]),
      });

      await transfer.importSettings();

      assert.deepEqual(calls[0], ["apply", { themePreference: "light" }]);
      assert.deepEqual(calls.slice(1), [["save"], ["render"], ["toast", "Настройки импортированы"]]);
      assert.equal(input.value, "");
    },
  },
  {
    name: "resets interface preferences only after confirmation",
    async fn() {
      let resets = 0;
      const transfer = createSettingsTransfer({
        confirmAction: async () => true,
        resetPreferences: () => {
          resets += 1;
        },
      });

      await transfer.resetInterfaceSettings();
      assert.equal(resets, 1);
    },
  },
];
