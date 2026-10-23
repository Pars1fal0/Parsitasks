const assert = require("node:assert/strict");
const { createImportExport } = require("../app/src/settings/import-export.js");
const { MAX_WORKSPACE_BYTES } = require("../app/src/core/workspace-limits.js");

module.exports = [
  { name: "an oversized normalized document is rejected before import confirmation or safety-backup writes", async fn() {
    const messages = [];
    const controller = createImportExport({
      getState: () => ({ tasks: [] }), normalizeState: (state) => state,
      confirmAction: () => assert.fail("must not confirm an unsynchronizable document"),
      replaceState: () => assert.fail("must not replace current data"), showToast: (message) => messages.push(message),
      els: { importFile: { files: [{ text: async () => JSON.stringify({ tasks: [], text: "x".repeat(MAX_WORKSPACE_BYTES) }) }], value: "selected" } },
    });
    await controller.importData(); assert.match(messages[0], /больше 4 МиБ/);
  } },
  { name: "late import completion and errors cannot overwrite a newer import or clear its file selection", async fn() {
    for (const rejectOld of [false, true]) {
      let finish, fail, state = { tasks: [] };
      const messages = [], input = { files: [{ text: () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }) }], value: "old" };
      const controller = createImportExport({
        getState: () => state, normalizeState: (value) => value, confirmAction: async () => true,
        createUndoSnapshot: () => ({ state: JSON.stringify(state) }), replaceState: (value) => { state = value; },
        storage: { createImportSafetyBackup: () => ({ ok: true }) }, saveState: () => true, render() {},
        showToast: (message) => messages.push(message), els: { importFile: input },
      });
      const old = controller.importData();
      input.files = [{ text: async () => JSON.stringify({ tasks: [{ id: "new" }] }) }];
      input.value = "new"; await controller.importData();
      input.value = "next-selection";
      if (rejectOld) fail(new Error("old file failed")); else finish(JSON.stringify({ tasks: [{ id: "old" }] }));
      await old;
      assert.equal(state.tasks[0].id, "new"); assert.equal(input.value, "next-selection"); assert.equal(messages.length, 1);
    }
  } },
  { name: "same-user logout and login invalidates a pending import by session generation", async fn() {
    let account = "one:1", finish;
    const controller = createImportExport({
      getUserId: () => "one", getAccountKey: () => account,
      normalizeState: () => assert.fail("stale file must not be processed"),
      showToast: () => assert.fail("stale import must not report a result"),
      els: { importFile: { files: [{ text: () => new Promise((resolve) => { finish = resolve; }) }], value: "new-owner-selection" } },
    });
    const pending = controller.importData(); account = "one:2";
    finish(JSON.stringify({ tasks: [] })); await pending;
  } },
  { name: "late desktop backup and information responses cannot update the replacement account UI", async fn() {
    const previousWindow = global.window;
    try {
      for (const action of ["syncDesktopBackup", "updateFileBackupStatus"]) {
        let account = "one:1", finish;
        global.window = { rhythmDesktop: {
          writeFileBackup: () => new Promise((resolve) => { finish = resolve; }),
          getFileBackupInfo: () => new Promise((resolve) => { finish = resolve; }),
        } };
        const status = { hidden: true, textContent: "Previous" };
        const controller = createImportExport({ getAccountKey: () => account, getState: () => ({ tasks: [] }),
          els: { fileBackupStatus: status, openBackupFolderButton: { hidden: true } } });
        const pending = controller[action](); account = "two:2"; status.textContent = "Replacement";
        finish({ ok: true, latest: { mtimeMs: Date.now() } }); await pending;
        assert.equal(status.textContent, "Replacement");
      }
    } finally { global.window = previousWindow; }
  } },
];
