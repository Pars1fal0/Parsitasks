const assert = require("node:assert/strict");
const { createImportExport } = require("../app/src/settings/import-export.js");

module.exports = [
  {
    name: "export preserves unknown fields from a newer local workspace instead of serializing the older normalized view",
    async fn() {
      const originalDocument = global.document;
      const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
      let downloaded;
      const future = { schemaVersion: 10, tasks: [], unknownFutureFeature: { keep: true } };
      try {
        global.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
        URL.createObjectURL = (blob) => { downloaded = blob; return "blob:synthetic"; };
        URL.revokeObjectURL = () => {};
        const controller = createImportExport({
          schemaVersion: 9, getState: () => ({ schemaVersion: 9, tasks: [] }),
          storage: { getUnsupportedState: () => future, createBackup: ({ payload }) => {
            assert.equal(payload.state, future); return { ok: false };
          } },
          toDateKey: () => "2026-10-07", showToast() {},
        });
        controller.exportData();
        const payload = JSON.parse(await downloaded.text());
        assert.equal(payload.schemaVersion, 10);
        assert.equal(payload.state.unknownFutureFeature.keep, true);
      } finally { global.document = originalDocument; URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl; }
    },
  },
  {
    name: "newer or malformed schemas and oversized imports never reach normalization or confirmation",
    async fn() {
      for (const input of [
        { schemaVersion: 10, state: { tasks: [] } },
        { schemaVersion: 9, state: { schemaVersion: 10, tasks: [] } },
        { schemaVersion: "9", tasks: [] },
        { schemaVersion: 0, tasks: [] },
        { schemaVersion: 1.5, tasks: [] },
        { tasks: [], oversized: true },
      ]) {
        const messages = [];
        const file = { size: input.oversized ? 17 * 1024 * 1024 : 10, text: async () => JSON.stringify(input) };
        const controller = createImportExport({
          schemaVersion: 9,
          normalizeState() { assert.fail("must not normalize incompatible imports"); },
          confirmAction() { assert.fail("must not confirm incompatible imports"); },
          showToast: (message) => messages.push(message),
          els: { importFile: { files: [file], value: "selected" } },
        });
        await controller.importData();
        assert.equal(messages.length, 1);
        if (input.oversized) assert.match(messages[0], /16 МБ/);
        else if (input.schemaVersion === 10 || input.state?.schemaVersion === 10) assert.match(messages[0], /более новой/);
      }
    },
  },
  {
    name: "same-account edits made while confirming import or backup restoration are preserved",
    async fn() {
      for (const action of ["importData", "restoreBackup"]) {
        const state = { tasks: [{ id: "original" }] }; const messages = [];
        const controller = createImportExport({
          getUserId: () => "account",
          getState: () => state,
          normalizeState: (value) => value,
          confirmAction: async () => { state.tasks.push({ id: "new-edit" }); return true; },
          replaceState() { assert.fail("must preserve intervening edits"); },
          showToast: (message) => messages.push(message),
          storage: { loadBackup: () => ({ state: { tasks: [{ id: "backup" }] } }) },
          els: { importFile: { files: [{ text: async () => JSON.stringify({ tasks: [] }) }], value: "selected" } },
        });
        await controller[action]();
        assert.deepEqual(state.tasks.map((task) => task.id), ["original", "new-edit"]);
        assert.match(messages.at(-1), /Данные изменились/);
      }
    },
  },
  {
    name: "backup restore checks schema compatibility and supplies the active owner to storage",
    async fn() {
      const messages = [];
      const controller = createImportExport({
        getUserId: () => "active-account",
        schemaVersion: 9,
        confirmAction() { assert.fail("newer backups must not be confirmed"); },
        showToast: (message) => messages.push(message),
        storage: { loadBackup: (options) => {
          assert.equal(options.owner, "active-account");
          return { state: { schemaVersion: 10, tasks: [] } };
        } },
      });
      await controller.restoreBackup();
      assert.match(messages[0], /более новой/);
    },
  },
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
    name: "imports note-only JSON through the normal state pipeline",
    async fn() {
      let imported = null;
      const note = { id: "note-1", title: "Расписание", body: "Аудитория 501" };
      const importFile = {
        files: [{ text: async () => JSON.stringify({ app: "Parsitasks", state: { notes: [note] } }) }],
        value: "selected",
      };
      const controller = createImportExport({
        confirmAction: async (preview) => {
          assert.match(preview.message, /будут заменены/);
          assert.deepEqual(preview.details.find((row) => row.label === "заметок"), { label: "заметок", value: 1 });
          return true;
        },
        createUndoSnapshot: () => ({ state: "{}" }),
        normalizeState: (state) => state,
        replaceState: (state) => { imported = state; },
        saveState() {},
        render() {},
        showToast() {},
        storage: { createImportSafetyBackup: () => ({ ok: true }) },
        els: { importFile },
      });

      await controller.importData();
      assert.deepEqual(imported.notes, [note]);
      assert.equal(importFile.value, "");
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
        confirmAction: async () => true,
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
