const assert = require("node:assert/strict");
const {
  buildJournalMonth,
  restoreJournalRevision,
  searchJournalEntries,
  upsertJournalEntry,
} = require("../app/src/journal/journal-model.js");

module.exports = [
  {
    name: "keeps journal revisions and restores an older version",
    fn() {
      const created = upsertJournalEntry([], { date: "2026-07-25", text: "Первая версия" }, {
        createId: () => "journal",
        now: "2026-07-25T10:00:00.000Z",
      });
      const updated = upsertJournalEntry(created.entries, { date: "2026-07-25", text: "Вторая версия" }, {
        now: "2026-07-25T11:00:00.000Z",
      });
      assert.equal(updated.entry.revisions.length, 1);
      const restored = restoreJournalRevision(updated.entries, "2026-07-25", "2026-07-25T10:00:00.000Z", {
        now: "2026-07-25T11:00:05.000Z",
      });
      assert.equal(restored.entry.text, "Первая версия");
      assert.equal(restored.entry.revisions.some((revision) => revision.text === "Вторая версия"), true);
    },
  },
  {
    name: "builds journal month markers and searches a date range",
    fn() {
      const entries = [
        { id: "one", date: "2026-07-02", text: "Поездка за город", updatedAt: "2026-07-02T10:00:00.000Z" },
        { id: "two", date: "2026-07-20", text: "Рабочий день", updatedAt: "2026-07-20T10:00:00.000Z" },
      ];
      const month = buildJournalMonth(entries, "2026-07-25", "monday");
      assert.equal(month.days.length, 42);
      assert.equal(month.days.find((day) => day.date === "2026-07-02").hasEntry, true);
      assert.deepEqual(searchJournalEntries(entries, "поезд", {
        from: "2026-07-01",
        to: "2026-07-10",
      }).map((entry) => entry.id), ["one"]);
    },
  },
  {
    name: "keeps only twenty useful journal revisions",
    fn() {
      let entries = [];
      for (let index = 0; index < 25; index += 1) {
        entries = upsertJournalEntry(entries, {
          date: "2026-07-25",
          text: `Версия ${index}`,
        }, {
          createId: () => "journal",
          now: new Date(Date.UTC(2026, 6, 25, index, 0)).toISOString(),
        }).entries;
      }
      assert.equal(entries[0].revisions.length, 20);
    },
  },
];
