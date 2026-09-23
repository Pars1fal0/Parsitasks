const assert = require("node:assert/strict");
const { habitNumberStep } = require("../app/src/habits/habits-view.js");

module.exports = [
  {
    name: "scales a numeric habit step to its target",
    fn() {
      assert.equal(habitNumberStep({ goal: 8 }), 1);
      assert.equal(habitNumberStep({ goal: 100 }), 5);
      assert.equal(habitNumberStep({ goal: 500 }), 50);
      assert.equal(habitNumberStep({ goal: 2000 }), 100);
    },
  },
];
