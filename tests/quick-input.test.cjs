const assert = require("node:assert/strict");
const { cleanText, normalizeDateKey, quickInput, toDateKey, toTimeValue } = require("./test-utils.cjs");

module.exports = [
  {
    name: "preserves ordinary nouns instead of interpreting them as a time",
    fn() {
      for (const title of ["Спланировать день", "Подготовить вечер встречи", "Написать рассказ про ночь", "Встретить утро", "Повторить конспект через 1 день"]) {
        const parsed = quickInput.parseQuickTaskInput(title, { activeDate: "2026-10-01", now: new Date(2026, 9, 1, 10), cleanText, normalizeDateKey, toDateKey });
        assert.equal(parsed.title, title.includes("через") ? "Повторить конспект" : title);
        assert.equal(parsed.time, "");
        assert.equal(parsed.scheduleMode, "none");
        if (title.includes("через")) assert.equal(parsed.date, "2026-10-02");
      }
    },
  },
  {
    name: "still recognizes explicit adverbs of time",
    fn() {
      for (const [word, time] of [["утром", "09:00"], ["днём", "14:00"], ["вечером", "18:00"], ["ночью", "22:00"]]) {
        const parsed = quickInput.parseQuickTaskInput(`Позвонить ${word}`, { activeDate: "2026-10-01" });
        assert.equal(parsed.title, "Позвонить");
        assert.equal(parsed.time, time);
      }
    },
  },
  {
    name: "parses date, time word, category, and priority",
    fn() {
      const parsed = quickInput.parseQuickTaskInput("Позвонить врачу 2026-07-15 вечером #здоровье !high", {
        activeDate: "2026-06-26",
        cleanText,
        getOrCreateCategory: () => "cat-health",
        normalizeCategoryName: (value) => cleanText(value).replace(/^./, (char) => char.toLocaleUpperCase("ru-RU")),
        normalizeDateKey,
        toDateKey,
        toTimeValue,
      });

      assert.equal(parsed.title, "Позвонить врачу");
      assert.equal(parsed.date, "2026-07-15");
      assert.equal(parsed.time, "18:00");
      assert.equal(parsed.categoryId, "cat-health");
      assert.equal(parsed.categoryName, "Здоровье");
      assert.equal(parsed.priority, "high");
    },
  },
  {
    name: "parses relative time without losing the title",
    fn() {
      const parsed = quickInput.parseQuickTaskInput("Сдать отчет через 2 часа !low", {
        activeDate: "2026-06-26",
        cleanText,
        normalizeDateKey,
        toDateKey,
        toTimeValue,
      });

      assert.equal(parsed.title, "Сдать отчет");
      assert.match(parsed.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(parsed.time, /^\d{2}:\d{2}$/);
      assert.equal(parsed.priority, "low");
    },
  },
  {
    name: "parses time range as a scheduled block",
    fn() {
      const parsed = quickInput.parseQuickTaskInput("Созвон завтра 14:00-15:30 #работа", {
        activeDate: "2026-06-26",
        cleanText,
        getOrCreateCategory: () => "cat-work",
        normalizeCategoryName: (value) => cleanText(value),
        normalizeDateKey,
        toDateKey,
        toTimeValue,
      });

      assert.equal(parsed.title, "Созвон");
      assert.equal(parsed.scheduleMode, "block");
      assert.equal(parsed.startTime, "14:00");
      assert.equal(parsed.endTime, "15:30");
      assert.equal(parsed.time, "15:30");
      assert.equal(parsed.categoryId, "cat-work");
    },
  },
  {
    name: "keeps quick tasks without a time unscheduled",
    fn() {
      const parsed = quickInput.parseQuickTaskInput("Купить продукты завтра", {
        activeDate: "2026-07-13",
        cleanText,
        normalizeDateKey,
        toDateKey,
        toTimeValue,
      });

      assert.equal(parsed.time, "");
      assert.equal(parsed.scheduleMode, "none");
    },
  },
  {
    name: "keeps an unknown priority visible and reports it",
    fn() {
      const parsed = quickInput.parseQuickTaskInput("Проверить отчёт !hgh", {
        activeDate: "2026-07-19",
        cleanText,
        normalizeDateKey,
        now: new Date(2026, 6, 19, 10, 0),
        toDateKey,
        toTimeValue,
      });

      assert.equal(parsed.title, "Проверить отчёт !hgh");
      assert.equal(parsed.priority, "medium");
      assert.equal(parsed.warnings.length, 1);
    },
  },
  {
    name: "rolls an implicit past calendar date into the next year",
    fn() {
      const parsed = quickInput.parseQuickTaskInput("Продлить подписку 10.01", {
        activeDate: "2026-07-19",
        cleanText,
        normalizeDateKey,
        now: new Date(2026, 6, 19, 10, 0),
        toDateKey,
        toTimeValue,
      });

      assert.equal(parsed.date, "2027-01-10");
      assert.equal(parsed.title, "Продлить подписку");
    },
  },
];
