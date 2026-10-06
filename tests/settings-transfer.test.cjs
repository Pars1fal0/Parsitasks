const assert = require("node:assert/strict");
const { createSettingsTransfer, exportableSettings } = require("../app/src/settings/settings-transfer.js");

function harness(payload, overrides = {}) {
  const calls = [];
  const input = { files: [{ text: async () => JSON.stringify(payload) }], value: "settings.json" };
  const transfer = createSettingsTransfer({
    applyImportedSettings: (settings, keys) => calls.push(["apply", settings, keys]),
    els: { settingsImportFile: input },
    getSettings: () => ({ accentPreference: "blue", themePreference: "dark" }),
    render: () => calls.push(["render"]),
    saveUiState: () => calls.push(["save"]),
    schemaVersion: 26,
    showToast: (message) => calls.push(["toast", message]),
    ...overrides,
  });
  return { calls, input, transfer };
}

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
        futureSecret: "never-export-unknown-fields",
        themePreference: "dark",
      }), {
        accentPreference: "blue",
        themePreference: "dark",
      });
    },
  },
  {
    name: "partial imports preserve existing settings and stamp only imported keys",
    async fn() {
      const { calls, transfer } = harness({ settings: { themePreference: "light", remoteSyncUrl: "https://attacker.example", futureSecret: "secret" } });
      assert.equal(await transfer.importSettings(), true);
      assert.deepEqual(calls[0], ["apply", { themePreference: "light", accentPreference: "blue" }, ["themePreference"]]);
    },
  },
  {
    name: "rejects non-settings, empty, foreign, future and malformed payloads without mutation",
    async fn() {
      for (const payload of [null, [], "dark", {}, { tasks: [] }, { settings: [] },
        { settings: { privateSecret: "secret" } }, { settings: { themePreference: null } },
        { settings: { navigationPreferences: [] } }, { settings: { quietHours: false } },
        { app: "Another app", settings: { themePreference: "light" } },
        { type: "workspace", settings: { themePreference: "light" } },
        { schemaVersion: 27, settings: { themePreference: "light" } },
        { schemaVersion: -1, settings: { themePreference: "light" } },
        { schemaVersion: "26", settings: { themePreference: "light" } }]) {
        const { calls, input, transfer } = harness(payload);
        assert.equal(await transfer.importSettings(), false, JSON.stringify(payload));
        assert.equal(calls.length, 1);
        assert.equal(calls[0][0], "toast");
        assert.notEqual(calls[0][1], "Настройки импортированы");
        assert.equal(input.value, "");
      }
      const { calls, input, transfer } = harness(null);
      input.files[0].text = async () => "{broken";
      assert.equal(await transfer.importSettings(), false);
      assert.match(calls[0][1], /JSON/);
    },
  },
  {
    name: "a stale failed file read cannot replace the latest import status",
    async fn() {
      let reject;
      const { calls, input, transfer } = harness(null);
      input.files[0].text = () => new Promise((_, fail) => { reject = fail; });
      const pending = transfer.importSettings();
      input.files[0] = { text: async () => JSON.stringify({ themePreference: "system" }) };
      assert.equal(await transfer.importSettings(), true);
      reject(new Error("Old file unreadable"));
      assert.equal(await pending, false);
      assert.deepEqual(calls.filter(([name]) => name === "toast"), [["toast", "Настройки импортированы"]]);
    },
  },
  {
    name: "bounds file reads and checks actual UTF-8 payload size",
    async fn() {
      const { calls, input, transfer } = harness(null);
      let reads = 0;
      input.files[0] = { size: 256 * 1024 + 1, text: async () => { reads++; return "{}"; } };
      assert.equal(await transfer.importSettings(), false);
      assert.equal(reads, 0);
      assert.match(calls[0][1], /256/);
      input.files[0] = { size: 1, text: async () => JSON.stringify({ settings: { themePreference: "light" }, extra: "я".repeat(140000) }) };
      assert.equal(await transfer.importSettings(), false);
      assert.equal(calls.filter(([name]) => name === "apply").length, 0);
    },
  },
  {
    name: "does not apply a pending import to a different account",
    async fn() {
      let owner = "A", finish;
      const { calls, input, transfer } = harness(null, { getOwner: () => owner });
      input.files[0].text = () => new Promise((resolve) => { finish = resolve; });
      const pending = transfer.importSettings();
      owner = "B";
      finish(JSON.stringify({ settings: { themePreference: "light" } }));
      assert.equal(await pending, false);
      assert.deepEqual(calls.map(([name]) => name), ["toast"]);
      assert.match(calls[0][1], /Аккаунт изменился/);
    },
  },
  {
    name: "newer file wins without an old import clearing its file selection",
    async fn() {
      let finish;
      const { calls, input, transfer } = harness(null);
      input.files[0].text = () => new Promise((resolve) => { finish = resolve; });
      const pending = transfer.importSettings();
      input.files[0] = { text: async () => JSON.stringify({ themePreference: "system" }) };
      assert.equal(await transfer.importSettings(), true);
      input.value = "next-file.json";
      finish(JSON.stringify({ themePreference: "light" }));
      assert.equal(await pending, false);
      assert.equal(input.value, "next-file.json");
      assert.equal(calls.filter(([name]) => name === "apply").length, 1);
      assert.equal(calls[0][1].themePreference, "system");
    },
  },
  {
    name: "failed persistence never claims a successful import",
    async fn() {
      for (const overrides of [
        { saveUiState: () => false },
        { applyImportedSettings: () => false },
        { applyImportedSettings: () => { throw new Error("Не удалось сохранить настройки аккаунта"); } },
      ]) {
        const { calls, input, transfer } = harness({ themePreference: "light" }, overrides);
        assert.equal(await transfer.importSettings(), false);
        const message = calls.findLast(([name]) => name === "toast")[1];
        assert.notEqual(message, "Настройки импортированы");
        assert.match(message, /не удалась|Не удалось/);
        assert.equal(input.value, "");
      }
    },
  },
  {
    name: "pending reset confirmation cannot reset another account",
    async fn() {
      let owner = "A", confirm, resets = 0;
      const { calls, transfer } = harness(null, {
        getOwner: () => owner,
        confirmAction: () => new Promise((resolve) => { confirm = resolve; }),
        resetPreferences: () => { resets++; },
      });
      const pending = transfer.resetInterfaceSettings();
      owner = "B";
      confirm(true);
      await pending;
      assert.equal(resets, 0);
      assert.match(calls[0][1], /Аккаунт изменился/);
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
