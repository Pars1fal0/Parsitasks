const assert = require("node:assert/strict");
const { installDom } = require("./dom-test-utils.cjs");
const { readText, writeText } = require("../src/journal/journal-editor.js");

module.exports = [
  {
    name: "round-trips journal headings and bold text without storing HTML",
    fn() {
      const document = installDom();
      const editor = document.createElement("div");
      writeText(editor, "# Итог дня\n\nПолучилось **закрыть задачу**\n## Завтра");

      assert.deepEqual(editor.children.map((node) => node.tagName), ["H1", "P", "P", "H2"]);
      assert.equal(editor.querySelector("strong").textContent, "закрыть задачу");
      assert.equal(readText(editor), "# Итог дня\n\nПолучилось **закрыть задачу**\n## Завтра");
    },
  },
  {
    name: "keeps the legacy textarea journal adapter working",
    fn() {
      const document = installDom();
      const textarea = document.createElement("textarea");
      writeText(textarea, "Обычная запись");
      assert.equal(readText(textarea), "Обычная запись");
    },
  },
];
