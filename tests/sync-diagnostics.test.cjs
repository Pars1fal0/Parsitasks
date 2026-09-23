const assert = require("node:assert/strict");
const { installDom } = require("./dom-test-utils.cjs");
const { createSyncDiagnostics, latestIsoDate } = require("../app/src/sync/sync-diagnostics.js");

module.exports = [
  {
    name: "renders actionable device sync diagnostics without innerHTML",
    fn() {
      const document = installDom();
      const container = document.createElement("div");
      const controller = createSyncDiagnostics({
        container,
        describeError: (error) => error.message,
        formatDate: (value) => value.slice(0, 10),
        getSnapshot: () => ({
          accountLabel: "user@example.com",
          authenticated: true,
          enabled: true,
          inFlight: false,
          lastError: "",
          lastPulledAt: "2026-07-25T09:00:00.000Z",
          lastPushedAt: "2026-07-25T10:00:00.000Z",
          online: true,
          pending: true,
          projectConfigured: true,
        }),
      });

      controller.render();

      assert.match(container.textContent, /user@example\.com/);
      assert.match(container.textContent, /Ожидают отправки/);
      assert.match(container.textContent, /2026-07-25/);
      assert.equal(container.children.length, 6);
    },
  },
  {
    name: "shows the latest connection check result",
    fn() {
      const document = installDom();
      const container = document.createElement("div");
      const controller = createSyncDiagnostics({
        container,
        describeError: (error) => error.message,
        formatDate: () => "сейчас",
        getSnapshot: () => ({
          authenticated: true,
          enabled: true,
          online: true,
          pending: false,
          projectConfigured: true,
        }),
      });

      controller.setConnectionResult({ found: false, ok: true });

      assert.match(container.textContent, /облако пока пустое/);
      assert.match(container.textContent, /сейчас/);
    },
  },
  {
    name: "selects the latest valid synchronization timestamp",
    fn() {
      assert.equal(
        latestIsoDate("bad", "2026-07-25T09:00:00.000Z", "2026-07-25T10:00:00.000Z"),
        "2026-07-25T10:00:00.000Z",
      );
    },
  },
];
