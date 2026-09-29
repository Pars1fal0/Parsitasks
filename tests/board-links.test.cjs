const assert = require("node:assert/strict");
const links = require("../app/src/board/board-links.js");
const model = require("../app/src/board/board-model.js");

module.exports = [
  {
    name: "board link cards store only source references and reject invalid types",
    fn() {
      const item = model.createLinkItem({ sourceType: "task", sourceId: "task-1" }, {
        createId: () => "board-1", now: "2026-09-29T12:00:00.000Z",
      });
      assert.equal(item.type, "link");
      assert.equal(item.sourceType, "task");
      assert.equal(item.sourceId, "task-1");
      assert.equal(item.text, "");
      assert.equal(item.width, 300);
      assert.equal(item.backgroundColor, "#e8f5f0");
      assert.equal(model.normalizeItem({ type: "link", sourceType: "remote", sourceId: "x" }), null);
      assert.equal(model.normalizeItem({ type: "link", sourceType: "task", sourceId: "" }), null);
      assert.equal(model.normalizeItem({ type: "link", sourceType: "task", sourceId: "x", backgroundColor: "#000000" }).backgroundColor, "#e8f5f0");
      assert.equal(Object.hasOwn(model.createTextItem(), "sourceId"), false);
    },
  },
  {
    name: "board cards reflect live task state and missing sources",
    fn() {
      const state = { tasks: [{ id: "task-1", title: "Доклад", date: "2026-09-28", completed: {} }] };
      const item = { sourceType: "task", sourceId: "task-1" };
      assert.equal(links.resolve(item, state, "2026-09-29").tone, "overdue");
      state.tasks[0].completed["2026-09-28"] = true;
      assert.equal(links.resolve(item, state, "2026-09-29").status, "Выполнена");
      state.tasks = [];
      assert.equal(links.resolve(item, state, "2026-09-29").missing, true);
    },
  },
  {
    name: "board source search filters already linked objects without duplicating content",
    fn() {
      const state = {
        tasks: [{ id: "task-1", title: "Доклад", date: "2026-09-29" }],
        notes: [{ id: "note-1", title: "Тезисы", body: "Краткий конспект" }],
        goals: [], studySubjects: [], studyFiles: [],
      };
      assert.deepEqual(links.list(state, { query: "тезисы" }).map((item) => item.id), ["note-1"]);
      assert.deepEqual(links.list(state, { type: "task", linked: ["task:task-1"] }), []);
      assert.deepEqual(links.list(state, { type: "note" }).map((item) => item.type), ["note"]);
    },
  },
  {
    name: "recurring task cards do not stay completed after an earlier occurrence",
    fn() {
      const state = { tasks: [{ id: "repeat-1", title: "Практика", date: "2026-09-01", repeat: "daily", completed: { "2026-09-28": true } }] };
      const item = { sourceType: "task", sourceId: "repeat-1" };
      assert.equal(links.resolve(item, state, "2026-09-29").status, "Повторяется");
      state.tasks[0].completed["2026-09-29"] = true;
      assert.equal(links.resolve(item, state, "2026-09-29").status, "Сегодня выполнена");
    },
  },
];
