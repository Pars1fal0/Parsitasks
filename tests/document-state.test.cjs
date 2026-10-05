const assert = require("node:assert/strict");
const documentState = require("../app/src/core/document-state.js");

module.exports = [
  {
    name: "empty document uses schema 26 and the client normalizer shape",
    fn() {
      const empty = documentState.createEmptyState();
      const normalized = documentState.normalizeState(null);

      assert.equal(documentState.SCHEMA_VERSION, 26);
      assert.equal(empty.schemaVersion, 26);
      assert.deepEqual(Object.keys(empty).sort(), Object.keys(normalized).sort());
      assert.ok(Array.isArray(empty.notes));
      assert.ok(Array.isArray(empty.boardItems));
      assert.equal(typeof empty.studyWeekCycle, "object");
      assert.deepEqual(empty.tombstones.notes, {});
      assert.deepEqual(empty.tombstones.boardItems, {});
      assert.deepEqual(Object.keys(empty.tombstones).sort(), Object.keys(normalized.tombstones).sort());

      empty.tasks.push({ id: "local" });
      assert.equal(documentState.createEmptyState().tasks.length, 0);
    },
  },
  {
    name: "existing documents keep their version and records while missing collections are added",
    fn() {
      const task = { id: "a", title: "Keep" };
      const tasks = [task];
      const state = {
        schemaVersion: 12,
        tasks,
        syncMeta: { entityFields: { tasks: { a: { title: "2026-01-01T00:00:00.000Z" } } }, taskOrder: { "2026-01-01": "stamp" } },
      };

      const result = documentState.ensureDocumentShape(state);

      assert.equal(result, state);
      assert.equal(result.schemaVersion, 12);
      assert.equal(result.tasks, tasks);
      assert.equal(task.checklist, undefined);
      assert.deepEqual(result.notes, []);
      assert.deepEqual(result.boardItems, []);
      assert.equal(typeof result.studyWeekCycle.anchorParity, "string");
      assert.deepEqual(result.tombstones.notes, {});
      assert.deepEqual(result.tombstones.boardItems, {});
      assert.equal(result.syncMeta.taskOrder["2026-01-01"], "stamp");
      assert.deepEqual(result.syncMeta.entityFields.tasks.a, { title: "2026-01-01T00:00:00.000Z" });
      assert.deepEqual(result.syncMeta.entityFields.notes, {});
    },
  },
  {
    name: "a missing schema version becomes 26 and a non-object becomes an empty document",
    fn() {
      const partial = { tasks: [{ id: "a" }] };
      assert.equal(documentState.ensureDocumentShape(partial).schemaVersion, 26);
      assert.equal(partial.tasks[0].id, "a");

      const empty = documentState.ensureDocumentShape(null);
      assert.equal(empty.schemaVersion, 26);
      assert.ok(Array.isArray(empty.notes));
      assert.notEqual(empty, documentState.ensureDocumentShape(null));
    },
  },
];
