const assert = require("node:assert/strict");
const { createSaveStatus } = require("../app/src/sync/save-status.js");

module.exports = [
  { name: "offline status confirms local saving even after a cloud failure", fn() {
    const status = createSaveStatus({});
    const state = { online: false, remoteEnabled: true, syncStatus: { lastError: "network", pending: true } };
    assert.equal(status.getStateCode(state), "offline");
    assert.equal(status.getMessage(state), "Нет связи · сохранено на устройстве, синхронизируем позже");
    assert.equal(status.getMessage({ online: false }), "Нет связи · сохранено на устройстве");
    assert.equal(status.getStateCode({ ...state, localStorageError: "Full" }), "error");
  } },
  { name: "saving status distinguishes synchronized, queued and local-only data", fn() {
    const status = createSaveStatus({ formatTime: (time) => time, toTimeValue: () => "12:30" });
    const state = { remoteEnabled: true, remoteLastPushedAt: "2026-09-30T12:00:00Z", syncStatus: { pending: false } };
    assert.equal(status.getMessage(state), "Синхронизировано 12:30");
    assert.equal(status.getStateCode(state), "synced");
    assert.equal(status.getStateCode({ ...state, syncStatus: { pending: true } }), "pending");
    assert.equal(status.getMessage({}), "Сохранено на устройстве");
    assert.equal(status.getMessage({ ...state, syncStatus: { lastError: "network" } }), "Сохранено на устройстве · не удалось синхронизировать");
  } },
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
        "Сохранено на устройстве · ожидает синхронизации",
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
