const assert = require("node:assert/strict");
const { getFocusable } = require("../app/src/ui/form-dialog.js");

module.exports = [
  {
    name: "exports focusable lookup for shared task, habit, and goal dialogs",
    fn() {
      assert.equal(typeof getFocusable, "function");
    },
  },
];
