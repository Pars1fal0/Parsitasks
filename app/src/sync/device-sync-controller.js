(function (global) {
  function createDeviceSyncController(config = {}) {
    const host = config.global || global;
    const documentRef = config.document || host.document;
    const intervalMs = Math.max(5_000, Number(config.intervalMs) || 30_000);
    let intervalId = null;
    let running = false;

    async function syncNow(runOptions = {}) {
      if (!runOptions.force && documentRef?.visibilityState === "hidden") return { changed: false, skipped: "hidden" };
      if (host.navigator?.onLine === false) return { changed: false, skipped: "offline" };
      await config.ensureFreshSession?.();
      return config.syncLatest?.({ silent: runOptions.silent !== false }) || { changed: false };
    }

    function handleVisibilityChange() {
      if (documentRef?.visibilityState === "visible") syncNow();
    }

    function handleFocus() {
      syncNow();
    }

    async function handleOnline() {
      const result = await syncNow({ force: true });
      config.onOnline?.(result);
    }

    function start() {
      if (running) return Promise.resolve({ changed: false, skipped: "running" });
      running = true;
      documentRef?.addEventListener?.("visibilitychange", handleVisibilityChange);
      host.addEventListener?.("focus", handleFocus);
      host.addEventListener?.("online", handleOnline);
      intervalId = host.setInterval?.(() => syncNow(), intervalMs) || null;
      return syncNow({ force: true });
    }

    function stop() {
      if (!running) return;
      running = false;
      documentRef?.removeEventListener?.("visibilitychange", handleVisibilityChange);
      host.removeEventListener?.("focus", handleFocus);
      host.removeEventListener?.("online", handleOnline);
      if (intervalId) host.clearInterval?.(intervalId);
      intervalId = null;
    }

    return { start, stop, syncNow };
  }

  const api = { createDeviceSyncController };
  global.RhythmDeviceSyncController = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
