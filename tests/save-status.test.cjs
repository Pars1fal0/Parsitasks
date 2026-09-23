const assert = require("node:assert/strict");
const { createSaveStatus } = require("../src/sync/save-status.js");

module.exports = [
  {
    name: "prioritizes local storage failures and pending cloud work",
    fn() {
      const status = createSaveStatus({
        formatTime: (value) => value,
        toTimeValue: () => "12:30",
      });

      assert.equal(
        status.getMessage({
          localStorageError: "Хранилище заполнено",
          remoteEnabled: true,
          syncStatus: { pending: true },
        }),
        "Хранилище заполнено",
      );
      assert.equal(
        status.getMessage({ remoteEnabled: true, syncStatus: { pending: true } }),
        "Ожидает синхронизации",
      );
    },
  },
  {
    name: "explains clock skew without exposing a technical error",
    fn() {
      const status = createSaveStatus({});
      assert.equal(status.describeRemoteError({ code: "clock-skew" }), "проверь дату и время на устройстве");
    },
  },
];
