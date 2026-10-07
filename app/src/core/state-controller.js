(function (global) {
  function createStateController(ctx) {
    let currentState = ctx.normalizeState(ctx.initialState);
    let persistedSnapshot = ctx.clone(currentState);
    let persistedRevision;

    function getState() {
      return currentState;
    }

    function replaceState(nextState) {
      currentState = ctx.normalizeState(nextState);
      return currentState;
    }

    function saveState(nextState = currentState, options = {}) {
      currentState = nextState;
      const owner = ctx.getOwner?.();
      const externallyChanged = !ctx.storage.getRevision || ctx.storage.getRevision() !== persistedRevision;
      const snapshot = !options.skipChangeTracking && externallyChanged ? ctx.storage.readSnapshot?.() : null;
      if (!options.skipChangeTracking && ctx.storage.getOwner && (snapshot?.owner ?? ctx.storage.getOwner()) !== owner) {
        throw new Error("Workspace changed in another tab");
      }
      if (!options.skipChangeTracking) ctx.trackChanges(persistedSnapshot, currentState);
      if (!options.skipChangeTracking && externallyChanged && ctx.mergeStates && ctx.storage.loadState) {
        const latest = snapshot ? snapshot.state : ctx.storage.loadState();
        const same = ctx.sameValue || ((a, b) => JSON.stringify(a) === JSON.stringify(b));
        if (latest && !same(latest, persistedSnapshot)) currentState = ctx.normalizeState(ctx.mergeStates(currentState, latest));
      }
      currentState = ctx.storage.saveState(currentState, {
        schemaVersion: ctx.schemaVersion,
        skipBackup: options.skipBackup,
        ...(ctx.getOwner ? { owner } : {}),
      });
      persistedSnapshot = ctx.clone(currentState);
      persistedRevision = ctx.storage.getSavedRevision?.();
      return currentState;
    }

    function receiveExternal(nextState) {
      if (!nextState || !ctx.mergeStates) return currentState;
      ctx.trackChanges(persistedSnapshot, currentState);
      currentState = ctx.normalizeState(ctx.mergeStates(currentState, nextState));
      persistedSnapshot = ctx.clone(currentState);
      persistedRevision = undefined;
      return currentState;
    }

    return { getState, replaceState, saveState, receiveExternal };
  }

  const api = { createStateController };
  global.RhythmStateController = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
