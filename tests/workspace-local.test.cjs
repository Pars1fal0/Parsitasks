const assert = require("node:assert/strict");
const { createMemoryStorage } = require("./test-utils.cjs");
const { createWorkspaceLocal, captureForm, restoreForm } = require("../app/src/core/workspace-local.js");

module.exports = [
  {
    name: "persists workspace data and isolates accounts",
    fn() {
      const storage = createMemoryStorage();
      let user = "first";
      const local = createWorkspaceLocal({ storage, getUserId: () => user });
      local.write("draft", { title: "Homework" });
      local.write("shopping:2026-12-28", { rice: 100 });
      assert.deepEqual(createWorkspaceLocal({ storage, getUserId: () => user }).read("draft"), { title: "Homework" });
      user = "second";
      assert.equal(local.read("draft"), null);
      assert.deepEqual(local.read("shopping:2026-12-28", {}), {});
      user = "first";
      assert.deepEqual(local.read("shopping:2026-12-28"), { rice: 100 });
      local.remove("draft");
      assert.equal(local.read("draft"), null);
    },
  },
  {
    name: "reports failed writes without claiming persistence",
    fn() {
      let errors = 0;
      const local = createWorkspaceLocal({ storage: { getItem: () => "invalid json", setItem: () => { throw new Error("quota"); } },
        onError: () => { errors += 1; } });
      assert.deepEqual(local.read("shopping", {}), {});
      assert.equal(local.write("draft", []), false);
      assert.equal(local.write("draft", []), false);
      assert.equal(errors, 1);
    },
  },
  {
    name: "restores text and individual checkbox selections without files",
    fn() {
      const field = (name, value, type = "text") => ({ tagName: "INPUT", name, value, type, checked: false, getAttribute: () => "" });
      const form = { elements: [field("title", "My draft"), field("fileId", "one", "checkbox"), field("fileId", "two", "checkbox"), field("upload", "secret", "file")] };
      form.elements[2].checked = true;
      const saved = captureForm(form);
      assert.equal(saved.length, 3);
      form.elements[0].value = "";
      form.elements[1].checked = true;
      form.elements[2].checked = false;
      restoreForm(form, saved);
      assert.equal(form.elements[0].value, "My draft");
      assert.equal(form.elements[1].checked, false);
      assert.equal(form.elements[2].checked, true);
    },
  },
];
