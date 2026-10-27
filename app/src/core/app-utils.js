function createAppUtils(options = {}) {
  const getFirstDayOfWeek = options.getFirstDayOfWeek || (() => "monday");
  const getTimeFormat = options.getTimeFormat || (() => "24");
  const getTimeZone = options.getTimeZone || (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  let clockZone;
  let clockFormatter;

  function clockParts(date = new Date()) {
    const zone = getTimeZone();
    if (!clockFormatter || clockZone !== zone) {
      clockFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
      clockZone = zone;
    }
    return Object.fromEntries(clockFormatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  }

  function todayKey(date = new Date()) {
    const p = clockParts(date);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  }

  function nowInTimeZone(date = new Date()) {
    const p = clockParts(date);
    return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, date.getMilliseconds());
  }

  function dateAtTime(dateKey, time) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const target = Date.UTC(year, month - 1, day, hour, minute);
    let instant = target;
    const seen = new Set();
    for (let attempt = 0; attempt < 4; attempt++) {
      const p = clockParts(new Date(instant));
      const delta = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      if (!delta) break;
      const next = instant + delta;
      // A missing DST wall time moves forward across the gap, never before the requested time.
      if (seen.has(next)) return new Date(Math.max(instant, next));
      seen.add(instant);
      instant = next;
    }
    return new Date(instant);
  }

  function cleanText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function cleanTimeValue(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
    if (!match) return "";
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function timeToMinutes(value) {
    const time = cleanTimeValue(value);
    if (!time) return NaN;
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function minutesToTime(value) {
    const minutes = Math.max(0, Math.min(23 * 60 + 59, Number(value) || 0));
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function formatTime(value) {
    const time = cleanTimeValue(value);
    if (!time || getTimeFormat() === "24") return time;
    const [hours, minutes] = time.split(":").map(Number);
    return new Intl.DateTimeFormat("ru-RU", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(2000, 0, 1, hours, minutes));
  }

  function toDateKey(date) {
    const safeDate = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
    return `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, "0")}-${String(safeDate.getDate()).padStart(2, "0")}`;
  }

  function normalizeDateKey(value, fallback = todayKey()) {
    const dateKey = String(value || "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!match) return fallback;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? dateKey : fallback;
  }

  function parseDate(dateKey) {
    const [year, month, day] = normalizeDateKey(dateKey).split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function addDays(dateKey, days) {
    const date = parseDate(dateKey);
    date.setDate(date.getDate() + days);
    return toDateKey(date);
  }

  function firstDayIndex() {
    return getFirstDayOfWeek() === "sunday" ? 0 : 1;
  }

  function getWeekDates(dateKey) {
    const date = parseDate(dateKey);
    date.setDate(date.getDate() - ((date.getDay() - firstDayIndex() + 7) % 7));
    return Array.from({ length: 7 }, (_, index) => addDays(toDateKey(date), index));
  }

  function getMonthCalendarDates(dateKey) {
    const date = parseDate(dateKey);
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    first.setDate(first.getDate() - ((first.getDay() - firstDayIndex() + 7) % 7));
    return Array.from({ length: 42 }, (_, index) => addDays(toDateKey(first), index));
  }

  function formatDate(dateKey, options) {
    return new Intl.DateTimeFormat("ru-RU", options).format(parseDate(dateKey));
  }

  function createId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function randomCategoryColor() {
    const colors = ["#00a78e", "#5967d8", "#ef6a4b", "#e7b84a", "#8b5cf6", "#0ea5e9"];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  return {
    addDays,
    cleanText,
    cleanTimeValue,
    createId,
    todayKey,
    nowInTimeZone,
    dateAtTime,
    escapeHtml: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    firstDayIndex,
    formatLongDate: (key) => formatDate(key, { weekday: "long", day: "numeric", month: "long" }),
    formatMonthLabel: (key) => formatDate(key, { month: "long", year: "numeric" }),
    formatShortDate: (key) => formatDate(key, { day: "numeric", month: "short" }),
    formatTime,
    formatWeekday: (key) => formatDate(key, { weekday: "short", day: "numeric" }),
    getMonthCalendarDates,
    getWeekDates,
    heatAlpha: (percent) => (percent <= 0 ? "0" : percent < 35 ? "0.5" : percent < 70 ? "0.75" : percent < 100 ? "0.95" : "1"),
    minutesToTime,
    normalizeDateKey,
    parseDate,
    randomCategoryColor,
    sanitizeColor: (value) => (/^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim() : ""),
    timeToMinutes,
    toDateKey,
    toTimeValue: (date) => {
      const safeDate = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
      const p = clockParts(safeDate);
      return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
    },
  };
}

const api = { createAppUtils };

export { createAppUtils };
export default api;
