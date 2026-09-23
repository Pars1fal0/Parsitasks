const assert = require("node:assert/strict");
const { createImportExport } = require("../src/settings/import-export.js");

module.exports = [
  {
    name: "creates a safety backup and undo snapshot before restoring",
    async fn() {
      const calls = [];
      const undo = { state: '{"tasks":[{"id":"current"}]}' };
      const controller = createImportExport({
        confirmAction: async () => true,
        createUndoSnapshot: () => undo,
        getState: () => ({ tasks: [{ id: "current" }] }),
        normalizeState: (state) => ({ ...state, normalized: true }),
        replaceState: (state) => calls.push(["replace", state]),
        render: () => calls.push(["render"]),
        saveState: (options) => calls.push(["save", options]),
        schemaVersion: 9,
        showToast: (message, options) => calls.push(["toast", message, options]),
        storage: {
          createImportSafetyBackup: (snapshot) => calls.push(["safety", snapshot]),
          loadBackup: () => ({ exportedAt: "2026-07-13T08:00:00.000Z", state: { tasks: [{ id: "backup" }] } }),
        },
        els: {},
      });

      await controller.restoreBackup();

      assert.deepEqual(calls[0], ["safety", undo]);
      assert.deepEqual(calls[1], ["replace", { tasks: [{ id: "backup" }], normalized: true }]);
      assert.deepEqual(calls[2], ["save", { skipBackup: true }]);
      assert.equal(calls[4][2].undo, undo);
    },
  },
  {
    name: "rejects unrelated JSON before replacing application data",
    async fn() {
      let replaced = false;
      let normalized = false;
      const messages = [];
      const importFile = {
        files: [{ text: async () => JSON.stringify({ unrelated: true }) }],
        value: "selected",
      };
      const controller = createImportExport({
        createUndoSnapshot: () => ({ state: "{}" }),
        normalizeState: () => { normalized = true; },
        replaceState: () => { replaced = true; },
        showToast: (message) => messages.push(message),
        storage: { createImportSafetyBackup: () => ({ ok: true }) },
        els: { importFile },
      });

      await controller.importData();

      assert.equal(normalized, false);
      assert.equal(replaced, false);
      assert.equal(importFile.value, "");
      assert.match(messages.at(-1), /JSON/);
    },
  },
  {
    name: "aborts import when the safety backup cannot be written",
    async fn() {
      let replaced = false;
      const importFile = {
        files: [{ text: async () => JSON.stringify({ tasks: [], habits: [], goals: [], categories: [] }) }],
        value: "selected",
      };
      const controller = createImportExport({
        createUndoSnapshot: () => ({ state: '{"tasks":[{"id":"safe"}]}' }),
        normalizeState: (state) => state,
        replaceState: () => { replaced = true; },
        showToast() {},
        storage: { createImportSafetyBackup: () => ({ ok: false }) },
        els: { importFile },
      });

      await controller.importData();
      assert.equal(replaced, false);
    },
  },
];
