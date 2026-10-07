const assert = require("node:assert/strict");
const { createStateController } = require("../app/src/core/state-controller.js");

module.exports = [
  {
    name: "unchanged storage revisions avoid reparsing and comparing the entire persisted document",
    fn() {
      let revision = "initial";
      let savedRevision;
      let reads = 0;
      const controller = createStateController({
        initialState: { value: 1 }, normalizeState: (v) => v, clone: structuredClone,
        getOwner: () => "a", trackChanges() {}, mergeStates: (a, b) => ({ ...a, ...b }),
        storage: { getRevision: () => revision, getSavedRevision: () => savedRevision, getOwner: () => "a",
          readSnapshot: () => { reads++; return { owner: "a", state: { value: 3 } }; },
          loadState: () => ({ value: 3 }), saveState: (v) => { revision += "x"; savedRevision = revision; return v; } },
      });
      controller.saveState({ value: 2 }, { skipChangeTracking: true });
      controller.saveState({ value: 2 });
      assert.equal(reads, 0);
      revision = "other tab";
      assert.equal(controller.saveState({ value: 2 }).value, 3);
      assert.equal(reads, 1);
    },
  },
  {
    name: "a foreign write immediately after saving is not cached as our own revision",
    fn() {
      let revision = "initial";
      let savedRevision;
      let reads = 0;
      const controller = createStateController({
        initialState: { value: 1 }, normalizeState: (v) => v, clone: structuredClone,
        getOwner: () => "a", trackChanges() {}, mergeStates: (a, b) => ({ ...a, ...b }),
        storage: { getRevision: () => revision, getSavedRevision: () => savedRevision, getOwner: () => "a",
          readSnapshot: () => { reads++; return { owner: "a", state: { remote: true } }; }, loadState: () => ({ remote: true }),
          saveState: (v) => { savedRevision = "our write"; revision = "foreign write"; return v; } },
      });
      controller.saveState({ value: 2 }, { skipChangeTracking: true });
      assert.deepEqual(controller.saveState({ value: 3 }), { value: 3, remote: true });
      assert.equal(reads, 1);
    },
  },
  {
    name: "normalizes replacements and tracks persisted state changes",
    fn() {
      const tracked = [];
      const saved = [];
      const controller = createStateController({
        clone: (value) => structuredClone(value),
        initialState: { value: 1 },
        normalizeState: (value) => ({ value: Number(value?.value) || 0 }),
        schemaVersion: 12,
        storage: {
          saveState(state, options) {
            saved.push({ state: structuredClone(state), options });
            return structuredClone(state);
          },
        },
        trackChanges: (previous, next) => tracked.push([previous.value, next.value]),
      });

      const replacement = controller.replaceState({ value: "2" });
      assert.equal(replacement.value, 2);
      controller.saveState(replacement, { skipBackup: true });
      assert.deepEqual(tracked, [[1, 2]]);
      assert.equal(saved[0].options.schemaVersion, 12);
      assert.equal(saved[0].options.skipBackup, true);
    },
  },
  {
    name: "keeps the latest state in memory when browser storage is full",
    fn() {
      const controller = createStateController({
        clone: (value) => structuredClone(value),
        initialState: { value: 1 },
        normalizeState: (value) => value,
        schemaVersion: 12,
        storage: {
          saveState() {
            throw new DOMException("Quota exceeded", "QuotaExceededError");
          },
        },
        trackChanges() {},
      });
      const next = { value: 2 };

      assert.throws(() => controller.saveState(next), /Quota exceeded/);
      assert.deepEqual(controller.getState(), next);
    },
  },
];
