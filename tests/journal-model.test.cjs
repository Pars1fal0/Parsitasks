const assert = require("node:assert/strict");
const {
  appendJournalText,
  journalEntryForDate,
  normalizeJournalEntries,
  upsertJournalEntry,
} = require("../src/journal/journal-model.js");

module.exports = [
  {
    name: "keeps one newest journal entry per day and preserves paragraphs",
    fn() {
      const entries = normalizeJournalEntries([
        { id: "old", date: "2026-07-25", text: "Старая запись", updatedAt: "2026-07-25T10:00:00.000Z" },
        { id: "new", date: "2026-07-25", text: "Первый абзац\r\n\r\nВторой", updatedAt: "2026-07-25T11:00:00.000Z" },
        { id: "bad", date: "not-a-date", text: "Не попадёт" },
      ]);

      assert.equal(entries.length, 1);
      assert.equal(entries[0].id, "new");
      assert.equal(entries[0].text, "Первый абзац\n\nВторой");
    },
  },
  {
    name: "creates and updates one journal entry for a date",
    fn() {
      const created = upsertJournalEntry([], { date: "2026-07-25", text: "Сегодня был релиз" }, {
        createId: () => "entry-1",
        now: "2026-07-25T10:00:00.000Z",
      });
      const updated = upsertJournalEntry(created.entries, { date: "2026-07-25", text: "Сегодня был хороший релиз" }, {
        createId: () => "unused",
        now: "2026-07-25T11:00:00.000Z",
      });

      assert.equal(updated.entries.length, 1);
      assert.equal(updated.entry.id, "entry-1");
      assert.equal(journalEntryForDate(updated.entries, "2026-07-25").text, "Сегодня был хороший релиз");
    },
  },
  {
    name: "appends a journal paragraph without replacing existing text",
    fn() {
      assert.equal(
        appendJournalText("Утром закончил задачу.", "Вечером встретился с друзьями."),
        "Утром закончил задачу.\n\nВечером встретился с друзьями.",
      );
    },
  },
];
