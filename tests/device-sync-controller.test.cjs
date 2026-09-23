const assert = require("node:assert/strict");
const { createDeviceSyncController } = require("../src/sync/device-sync-controller.js");

module.exports = [
  {
    name: "checks another device periodically and when the app becomes visible",
    async fn() {
      const documentListeners = {};
      const hostListeners = {};
      let intervalCallback = null;
      let syncCount = 0;
      const document = {
        visibilityState: "visible",
        addEventListener: (name, listener) => { documentListeners[name] = listener; },
        removeEventListener: (name) => { delete documentListeners[name]; },
      };
      const host = {
        navigator: { onLine: true },
        addEventListener: (name, listener) => { hostListeners[name] = listener; },
        removeEventListener: (name) => { delete hostListeners[name]; },
        setInterval: (callback) => { intervalCallback = callback; return 1; },
        clearInterval() {},
      };
      const controller = createDeviceSyncController({
        document,
        global: host,
        ensureFreshSession: async () => null,
        syncLatest: async () => { syncCount += 1; return { changed: false }; },
      });

      controller.start();
      await Promise.resolve();
      await Promise.resolve();
      intervalCallback();
      documentListeners.visibilitychange();
      hostListeners.focus();
      await Promise.resolve();
      await Promise.resolve();

      assert.equal(syncCount, 4);
      controller.stop();
      assert.equal(documentListeners.visibilitychange, undefined);
      assert.equal(hostListeners.focus, undefined);
    },
  },
  {
    name: "does not poll while the app is hidden or offline",
    async fn() {
      let syncCount = 0;
      const document = { visibilityState: "hidden" };
      const host = { navigator: { onLine: true } };
      const controller = createDeviceSyncController({
        document,
        global: host,
        syncLatest: async () => { syncCount += 1; },
      });

      assert.equal((await controller.syncNow()).skipped, "hidden");
      document.visibilityState = "visible";
      host.navigator.onLine = false;
      assert.equal((await controller.syncNow()).skipped, "offline");
      assert.equal(syncCount, 0);
    },
  },
];
