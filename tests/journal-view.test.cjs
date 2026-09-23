const assert = require("node:assert/strict");
const { installDom } = require("./dom-test-utils.cjs");
const { createJournalView } = require("../src/journal/journal-view.js");
const journalModel = require("../src/journal/journal-model.js");

module.exports = [
  {
    name: "renders calendar and autosaves the selected daily journal entry",
    fn() {
      const document = installDom();
      document.activeElement = null;
      const els = {};
      [
        "journalCalendarGrid", "journalCalendarTitle", "journalCount", "journalDate",
        "journalHistoryCount", "journalHistoryList", "journalNextMonth", "journalPrevMonth",
        "journalPrompt", "journalSearch", "journalSearchFrom", "journalSearchResults",
        "journalSearchTo", "journalStatus", "journalText", "journalWeekdays",
      ].forEach((key) => {
        els[key] = document.createElement(key.includes("Text") || key.includes("Search") ? "input" : "div");
      });
      let saved = null;
      const entries = [{
        id: "one",
        date: "2026-07-25",
        text: "Начало дня",
        revisions: [],
        updatedAt: "2026-07-25T10:00:00.000Z",
      }];
      const view = createJournalView({
        buildMonth: journalModel.buildJournalMonth,
        els,
        formatDateTime: () => "25 июля, 12:30",
        formatLongDate: () => "суббота, 25 июля",
        formatTime: () => "12:30",
        getActiveDate: () => "2026-07-25",
        getEntries: () => entries,
        getEntry: () => entries[0],
        getFirstDayOfWeek: () => "monday",
        maxLength: 50000,
        searchEntries: journalModel.searchJournalEntries,
        setActiveDate: () => {},
        saveEntry: (date, text) => {
          saved = { date, text };
          return { changed: true, entry: { date, text, revisions: [], updatedAt: "2026-07-25T12:30:00.000Z" } };
        },
      });

      view.bindEvents();
      view.render();
      assert.equal(els.journalText.value, "Начало дня");
      assert.equal(els.journalCalendarGrid.children.length, 42);

      els.journalText.value = "Полная запись дня";
      els.journalText.dispatchEvent({ type: "input" });
      view.flush();

      assert.deepEqual(saved, { date: "2026-07-25", text: "Полная запись дня" });
      assert.match(els.journalStatus.textContent, /12:30/);
      assert.match(els.journalCount.textContent, /^17/);
    },
  },
];
