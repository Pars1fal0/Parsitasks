const assert = require("node:assert/strict");
const { moveCheckpoint } = require("../app/src/goals/goal-checkpoint-editor.js");

module.exports = [
  {
    name: "moves a goal checkpoint down without mutating the original list",
    fn() {
      const source = [
        { id: "design", title: "Дизайн", done: true },
        { id: "build", title: "Верстка", done: false },
        { id: "deploy", title: "Деплой", done: false },
      ];
      const moved = moveCheckpoint(source, "design", "build");

      assert.deepEqual(moved.map((step) => step.id), ["build", "design", "deploy"]);
      assert.deepEqual(source.map((step) => step.id), ["design", "build", "deploy"]);
      assert.equal(moved[1].done, true);
    },
  },
  {
    name: "moves a goal checkpoint up and ignores invalid moves",
    fn() {
      const source = [{ id: "a" }, { id: "b" }, { id: "c" }];
      assert.deepEqual(moveCheckpoint(source, "c", "b").map((step) => step.id), ["a", "c", "b"]);
      assert.equal(moveCheckpoint(source, "missing", "b"), source);
      assert.equal(moveCheckpoint(source, "a", "a"), source);
    },
  },
];
