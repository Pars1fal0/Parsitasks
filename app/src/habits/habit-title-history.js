(function (global) {
  function normalizeHabitTitleHistory(value, options = {}) {
    const cleanText = options.cleanText || defaultCleanText;
    const fallbackTitle = cleanText(options.fallbackTitle) || "Привычка";
    const fallbackDate = normalizeDate(options.startDate) || "1970-01-01";
    const fallbackUpdatedAt = validTimestamp(options.updatedAt) || new Date(0).toISOString();
    const byDate = new Map();

    (Array.isArray(value) ? value : []).forEach((entry) => {
      const fromDate = normalizeDate(entry?.fromDate);
      const title = cleanText(entry?.title);
      if (!fromDate || !title) return;
      const normalized = {
        fromDate,
        title,
        updatedAt: validTimestamp(entry.updatedAt) || fallbackUpdatedAt,
      };
      const existing = byDate.get(fromDate);
      if (!existing || Date.parse(normalized.updatedAt) >= Date.parse(existing.updatedAt)) byDate.set(fromDate, normalized);
    });

    if (!byDate.size) {
      byDate.set(fallbackDate, { fromDate: fallbackDate, title: fallbackTitle, updatedAt: fallbackUpdatedAt });
    } else if (![...byDate.keys()].some((dateKey) => dateKey <= fallbackDate)) {
      byDate.set(fallbackDate, { fromDate: fallbackDate, title: fallbackTitle, updatedAt: fallbackUpdatedAt });
    }

    return [...byDate.values()].sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  }

  function habitTitleOnDate(habit, dateKey) {
    const history = normalizeHabitTitleHistory(habit?.titleHistory, {
      fallbackTitle: habit?.title,
      startDate: habit?.startDate,
      updatedAt: habit?.updatedAt || habit?.createdAt,
    });
    const targetDate = normalizeDate(dateKey) || "9999-12-31";
    return [...history].reverse().find((entry) => entry.fromDate <= targetDate)?.title || history[0]?.title || "Привычка";
  }

  function applyHabitTitleChange(habit, title, effectiveDate, options = {}) {
    const cleanText = options.cleanText || defaultCleanText;
    const nextTitle = cleanText(title);
    const fromDate = normalizeDate(effectiveDate);
    if (!nextTitle || !fromDate) return habit;
    const updatedAt = validTimestamp(options.updatedAt) || new Date().toISOString();
    const history = normalizeHabitTitleHistory(habit?.titleHistory, {
      cleanText,
      fallbackTitle: habit?.title,
      startDate: habit?.startDate || fromDate,
      updatedAt: habit?.updatedAt || habit?.createdAt,
    }).filter((entry) => entry.fromDate !== fromDate);
    history.push({ fromDate, title: nextTitle, updatedAt });
    history.sort((a, b) => a.fromDate.localeCompare(b.fromDate));
    return {
      ...habit,
      title: history.at(-1).title,
      titleHistory: history,
      updatedAt,
    };
  }

  function mergeHabitTitleHistory(localHabit, remoteHabit) {
    const local = normalizeHabitTitleHistory(localHabit?.titleHistory, {
      fallbackTitle: localHabit?.title,
      startDate: localHabit?.startDate,
      updatedAt: localHabit?.updatedAt || localHabit?.createdAt,
    });
    const remote = normalizeHabitTitleHistory(remoteHabit?.titleHistory, {
      fallbackTitle: remoteHabit?.title,
      startDate: remoteHabit?.startDate,
      updatedAt: remoteHabit?.updatedAt || remoteHabit?.createdAt,
    });
    return normalizeHabitTitleHistory([...local, ...remote], {
      fallbackTitle: remoteHabit?.title || localHabit?.title,
      startDate: remoteHabit?.startDate || localHabit?.startDate,
      updatedAt: remoteHabit?.updatedAt || localHabit?.updatedAt,
    });
  }

  function normalizeDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return "";
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return "";
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
  }

  function defaultCleanText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  const api = { applyHabitTitleChange, habitTitleOnDate, mergeHabitTitleHistory, normalizeHabitTitleHistory };
  global.RhythmHabitTitleHistory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
