const assert = require("node:assert/strict");
const notesModel = require("../app/src/notes/notes-model.js");
const { createStateNormalizer } = require("./test-utils.cjs");
const { mergeStates } = require("../app/src/core/state-merge.js");
const { searchWorkspace } = require("../app/src/ui/global-search.js");

const early = "2026-09-28T10:00:00.000Z";
const late = "2026-09-29T10:00:00.000Z";

module.exports = [
  {
    name: "normalizes important notes without changing dated journal entries",
    fn() {
      const state = createStateNormalizer().normalizeState({
        journalEntries: [{ id: "day", date: "2026-09-29", text: "Личная запись" }],
        notes: [
          { id: "note", title: "  Экзамен   по математике ", body: "Первый пункт\r\nВторой пункт", pinned: true, subjectId: "subject", taskId: "task", updatedAt: early },
          { id: "note", title: "Новая версия", body: "Другое", updatedAt: late },
          { id: "empty", title: " ", body: " " },
        ],
      });
      assert.equal(state.journalEntries[0].text, "Личная запись");
      assert.equal(state.notes.length, 1);
      assert.equal(state.notes[0].title, "Новая версия");
      assert.equal(state.notes[0].updatedAt, late);
    },
  },
  {
    name: "lists pinned notes first and searches text and related subject",
    fn() {
      const notes = [
        { id: "ordinary", title: "Справка", body: "Кабинет 5", updatedAt: late },
        { id: "pinned", title: "Формулы", body: "Производные", pinned: true, subjectId: "math", updatedAt: early },
      ];
      assert.deepEqual(notesModel.listNotes(notes).map((note) => note.id), ["pinned", "ordinary"]);
      assert.deepEqual(notesModel.listNotes(notes, { query: "математика", subjects: [{ id: "math", name: "Математика" }] }).map((note) => note.id), ["pinned"]);
      assert.deepEqual(notesModel.listNotes(notes, { subjectId: "none" }).map((note) => note.id), ["ordinary"]);
    },
  },
  {
    name: "merges independent note edits and does not resurrect deleted notes",
    fn() {
      const local = {
        notes: [{ id: "note", title: "Формулы", body: "Локальный текст", pinned: false, updatedAt: early }],
        syncMeta: { entityFields: { notes: { note: { body: late } } } },
      };
      const remote = {
        notes: [{ id: "note", title: "Формулы", body: "Старый текст", pinned: true, updatedAt: late }],
        syncMeta: { entityFields: { notes: { note: { pinned: late } } } },
      };
      const merged = mergeStates(local, remote);
      assert.equal(merged.notes[0].body, "Локальный текст");
      assert.equal(merged.notes[0].pinned, true);
      const deleted = mergeStates({ ...local, notes: [], tombstones: { notes: { note: late } } }, remote);
      assert.equal(deleted.notes.length, 0);
    },
  },
  {
    name: "finds linked notes in global search",
    fn() {
      const results = searchWorkspace({
        studySubjects: [{ id: "math", name: "Математика" }],
        notes: [{ id: "note", title: "Формулы", body: "", subjectId: "math", taskId: "" }],
      }, "математика");
      assert.equal(results.length, 1);
      assert.equal(results[0].type, "note");
      assert.equal(results[0].view, "journal");
    },
  },
];
