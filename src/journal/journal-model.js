(function (global) {
  const MAX_JOURNAL_LENGTH = 50000;
  const MAX_JOURNAL_REVISIONS = 20;

  function normalizeJournalEntries(value, options = {}) {
    const createId = options.createId || (() => `journal-${Date.now().toString(36)}`);
    const byDate = new Map();
    (Array.isArray(value) ? value : []).forEach((entry) => {
      const date = normalizeDateKey(entry?.date);
      if (!date) return;
      const createdAt = validTimestamp(entry?.createdAt) || new Date().toISOString();
      const updatedAt = validTimestamp(entry?.updatedAt) || createdAt;
      const normalized = {
        id: String(entry?.id || createId()),
        date,
        text: normalizeJournalText(entry?.text),
        revisions: normalizeRevisions(entry?.revisions),
        createdAt,
        updatedAt,
      };
      const current = byDate.get(date);
      if (!current || updatedAt >= current.updatedAt) byDate.set(date, normalized);
    });
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  function journalEntryForDate(entries, date) {
    const dateKey = normalizeDateKey(date);
    if (!dateKey) return null;
    return (Array.isArray(entries) ? entries : []).find((entry) => entry?.date === dateKey) || null;
  }

  function upsertJournalEntry(entries, input, options = {}) {
    const date = normalizeDateKey(input?.date);
    if (!date) throw new Error("Дата дневника должна быть в формате YYYY-MM-DD");
    const text = normalizeJournalText(input?.text);
    const now = validTimestamp(options.now) || new Date().toISOString();
    const createId = options.createId || (() => `journal-${Date.now().toString(36)}`);
    const next = normalizeJournalEntries(entries, { createId });
    const existing = journalEntryForDate(next, date);
    if (!existing && !text) return { changed: false, entries: next, entry: null };
    if (existing && existing.text === text) return { changed: false, entries: next, entry: existing };

    if (existing) {
      const previousAge = Date.parse(now) - Date.parse(existing.updatedAt || "");
      if (existing.text && (options.forceRevision || !existing.revisions?.length || previousAge >= 30000)) {
        existing.revisions = normalizeRevisions([
          ...(existing.revisions || []),
          { text: existing.text, savedAt: existing.updatedAt || now },
        ]);
      }
      existing.text = text;
      existing.updatedAt = now;
      return { changed: true, entries: next, entry: existing };
    }

    const entry = { id: createId(), date, text, revisions: [], createdAt: now, updatedAt: now };
    next.push(entry);
    next.sort((left, right) => left.date.localeCompare(right.date));
    return { changed: true, entries: next, entry };
  }

  function appendJournalText(current, addition) {
    const previous = normalizeJournalText(current);
    const next = normalizeJournalText(addition);
    if (!next) throw new Error("Текст записи не может быть пустым");
    return normalizeJournalText(previous ? `${previous}\n\n${next}` : next);
  }

  function normalizeJournalText(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim()
      .slice(0, MAX_JOURNAL_LENGTH);
  }

  function normalizeRevisions(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : [])
      .map((revision) => ({
        text: normalizeJournalText(revision?.text),
        savedAt: validTimestamp(revision?.savedAt) || "",
      }))
      .filter((revision) => {
        const key = `${revision.savedAt}\n${revision.text}`;
        if (!revision.text || !revision.savedAt || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => left.savedAt.localeCompare(right.savedAt))
      .slice(-MAX_JOURNAL_REVISIONS);
  }

  function restoreJournalRevision(entries, date, savedAt, options = {}) {
    const entry = journalEntryForDate(entries, date);
    const revision = entry?.revisions?.find((item) => item.savedAt === savedAt);
    if (!revision) return { changed: false, entries: normalizeJournalEntries(entries), entry };
    return upsertJournalEntry(entries, { date, text: revision.text }, { ...options, forceRevision: true });
  }

  function searchJournalEntries(entries, query, options = {}) {
    const search = String(query || "").trim().toLocaleLowerCase("ru-RU");
    const from = normalizeDateKey(options.from);
    const to = normalizeDateKey(options.to);
    return normalizeJournalEntries(entries)
      .filter((entry) => (!from || entry.date >= from) && (!to || entry.date <= to))
      .filter((entry) => !search || entry.text.toLocaleLowerCase("ru-RU").includes(search))
      .sort((left, right) => right.date.localeCompare(left.date));
  }

  function buildJournalMonth(entries, anchorDate, firstDay = "monday") {
    const anchor = parseDateKey(anchorDate) || new Date();
    const year = anchor.getUTCFullYear();
    const month = anchor.getUTCMonth();
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (first.getUTCDay() - (firstDay === "sunday" ? 0 : 1) + 7) % 7;
    const entryDates = new Set(normalizeJournalEntries(entries).filter((entry) => entry.text).map((entry) => entry.date));
    const days = [];
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(Date.UTC(year, month, 1 - offset + index));
      const dateKey = date.toISOString().slice(0, 10);
      days.push({
        date: dateKey,
        day: date.getUTCDate(),
        currentMonth: date.getUTCMonth() === month,
        hasEntry: entryDates.has(dateKey),
      });
    }
    return { month, year, days };
  }

  function journalEntriesForPeriod(entries, from, to) {
    return searchJournalEntries(entries, "", { from, to });
  }

  function parseDateKey(value) {
    const normalized = normalizeDateKey(value);
    return normalized ? new Date(`${normalized}T00:00:00.000Z`) : null;
  }

  function normalizeDateKey(value) {
    const text = String(value || "");
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return "";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return (
      date.getUTCFullYear() === Number(match[1])
      && date.getUTCMonth() === Number(match[2]) - 1
      && date.getUTCDate() === Number(match[3])
    ) ? text : "";
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
  }

  const api = {
    MAX_JOURNAL_LENGTH,
    MAX_JOURNAL_REVISIONS,
    appendJournalText,
    buildJournalMonth,
    journalEntriesForPeriod,
    journalEntryForDate,
    normalizeJournalEntries,
    normalizeJournalText,
    restoreJournalRevision,
    searchJournalEntries,
    upsertJournalEntry,
  };
  global.RhythmJournalModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
