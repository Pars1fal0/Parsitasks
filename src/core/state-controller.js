(function (global) {
  function createStateController(ctx) {
    let currentState = ctx.normalizeState(ctx.initialState);
    let persistedSnapshot = ctx.clone(currentState);

    function getState() {
      return currentState;
    }

    function replaceState(nextState) {
      currentState = ctx.normalizeState(nextState);
      return currentState;
    }

    function saveState(nextState = currentState, options = {}) {
      currentState = nextState;
      if (!options.skipChangeTracking) ctx.trackChanges(persistedSnapshot, currentState);
      currentState = ctx.storage.saveState(currentState, {
        schemaVersion: ctx.schemaVersion,
        skipBackup: options.skipBackup,
      });
      persistedSnapshot = ctx.clone(currentState);
      return currentState;
    }

    return { getState, replaceState, saveState };
  }

  const api = { createStateController };
  global.RhythmStateController = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
