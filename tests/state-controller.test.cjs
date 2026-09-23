const assert = require("node:assert/strict");
const { createStateController } = require("../app/src/core/state-controller.js");

module.exports = [
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
