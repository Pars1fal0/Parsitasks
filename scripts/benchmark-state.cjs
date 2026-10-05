const { performance } = require("node:perf_hooks");
const { createMemoryStorage } = require("../tests/test-utils.cjs");
const { createLocalStorageAdapter } = require("../app/src/core/storage.js");
const { createStateController } = require("../app/src/core/state-controller.js");
const documentState = require("../app/src/core/document-state.js");
const metadata = require("../app/src/sync/sync-metadata.js");
const { mergeStates } = require("../app/src/core/state-merge.js");

// Synthetic data only. Disk, real browser quota and network latency are not measured.
for (const count of [100, 1000, 5000]) {
  const tasks = Array.from({ length: count }, (_, index) => ({ id: `task-${index}`, title: `Synthetic task ${index}`, date: "2026-10-05", repeat: "none", completed: {}, createdAt: "2026-10-05T00:00:00.000Z" }));
  const storage = createLocalStorageAdapter({ storage: createMemoryStorage(), schemaVersion: documentState.SCHEMA_VERSION });
  storage.saveState(documentState.normalizeState({ tasks }), { owner: "", skipBackup: true });
  const tracker = metadata.createSyncMetadataTracker();
  const controller = createStateController({ initialState: storage.loadState(), normalizeState: documentState.normalizeState,
    schemaVersion: documentState.SCHEMA_VERSION, storage, clone: metadata.clone, mergeStates, sameValue: metadata.sameValue,
    getOwner: () => "", trackChanges: tracker.trackChanges });
  const samples = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    controller.getState().tasks[0].title = `Changed ${attempt}`;
    const started = performance.now(); controller.saveState(undefined, { skipBackup: true });
    if (attempt > 1) samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ tasks: count, bytes: storage.getDiagnostics().bytes, medianMs: +samples[Math.floor(samples.length / 2)].toFixed(2), maxMs: +samples.at(-1).toFixed(2), backend: "memory, not browser storage" }));
}
