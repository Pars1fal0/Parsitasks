const assert = require("node:assert/strict");
const { installDom } = require("./dom-test-utils.cjs");
const { createRemoteDataController, snapshotSummaryParts, summarizeSnapshotState } = require("../src/sync/remote-data-controller.js");

module.exports = [
  {
    name: "describes cloud snapshots with useful entity counts",
    fn() {
      assert.deepEqual(
        snapshotSummaryParts({ boardItems: 3, goals: 2, habits: 4, nutritionMeals: 7, tasks: 12 }),
        ["12 задач", "4 привычек", "2 целей", "3 элементов доски", "7 блюд"],
      );
      assert.deepEqual(snapshotSummaryParts(), []);
      assert.deepEqual(
        summarizeSnapshotState({
          goals: [{ title: "Запустить проект" }],
          habits: [{ title: "Читать" }],
          tasks: [{ title: "Проверить сборку" }, { title: "Опубликовать" }],
          boardItems: [{ type: "text", text: "Идея продукта" }],
        }),
        {
          counts: { boardItems: 1, goals: 1, habits: 1, journalEntries: 0, nutritionMeals: 0, tasks: 2 },
          examples: ["Проверить сборку", "Опубликовать", "Читать"],
        },
      );
    },
  },
  {
    name: "previews a selected cloud snapshot before restoration",
    async fn() {
      const document = installDom();
      const select = document.createElement("select");
      select.value = "9";
      const preview = document.createElement("div");
      const controller = createRemoteDataController({
        describeError: (error) => error.message,
        els: {
          remoteSnapshotPreview: preview,
          remoteSnapshotSelect: select,
        },
        formatDate: () => "25 июля",
        getConfig: () => ({}),
        isReady: () => true,
        remoteSync: {
          getSnapshot: async () => ({
            snapshot: {
              created_at: "2026-07-25T10:00:00.000Z",
              state: {
                goals: [{ title: "Цель" }],
                habits: [{ title: "Привычка" }],
                tasks: [{ title: "Задача" }],
              },
            },
          }),
        },
      });

      await controller.previewSelectedSnapshot();

      assert.equal(preview.hidden, false);
      assert.match(preview.textContent, /1 задач/);
      assert.match(preview.textContent, /Задача, Привычка, Цель/);
    },
  },
  {
    name: "restoring a cloud snapshot creates a safety backup and exposes undo",
    async fn() {
      const document = installDom();
      const select = document.createElement("select");
      select.value = "7";
      const restoreButton = document.createElement("button");
      const status = document.createElement("p");
      const undo = { state: "before" };
      const calls = { restored: null, saved: null, toast: null };
      const controller = createRemoteDataController({
        afterSnapshotRestored: (result) => {
          calls.restored = result;
        },
        confirmAction: async () => true,
        createImportSafetyBackup: () => ({ ok: true }),
        createUndoSnapshot: () => undo,
        els: {
          remoteAccountDeleteButton: document.createElement("button"),
          remoteSnapshotRestoreButton: restoreButton,
          remoteSnapshotSelect: select,
          remoteSnapshotsLoadButton: document.createElement("button"),
          remoteSnapshotsStatus: status,
        },
        formatDate: () => "date",
        getConfig: () => ({}),
        getState: () => ({ tasks: [{ id: "before" }] }),
        isReady: () => true,
        remoteSync: {
          listSnapshots: async () => ({ snapshots: [] }),
          restoreSnapshot: async () => ({
            saved: { row: { updated_at: "2026-07-25T12:00:00.000Z" } },
            snapshot: { state: { tasks: [{ id: "after" }] } },
          }),
        },
        render() {},
        replaceState() {},
        saveState: (options) => {
          calls.saved = options;
        },
        showToast: (message, options) => {
          calls.toast = { message, options };
        },
      });

      await controller.restoreSelectedSnapshot();
      assert.deepEqual(calls.saved, { skipBackup: true, skipRemote: true });
      assert.equal(calls.restored.saved.row.updated_at, "2026-07-25T12:00:00.000Z");
      assert.equal(calls.toast.message, "Облачная версия восстановлена");
      assert.equal(calls.toast.options.undo, undo);
    },
  },
];
