(function (global) {
  function createAppUtils(options = {}) {
    const getFirstDayOfWeek = options.getFirstDayOfWeek || (() => "monday");
    const getTimeFormat = options.getTimeFormat || (() => "24");

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

    function normalizeDateKey(value, fallback = toDateKey(new Date())) {
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
      if (global.crypto?.randomUUID) return global.crypto.randomUUID();
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
      escapeHtml: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
      firstDayIndex,
      formatLongDate: (key) => formatDate(key, { weekday: "long", day: "numeric", month: "long" }),
      formatMonthLabel: (key) => formatDate(key, { month: "long", year: "numeric" }),
      formatShortDate: (key) => formatDate(key, { day: "numeric", month: "short" }),
      formatTime,
      formatWeekday: (key) => formatDate(key, { weekday: "short", day: "numeric" }),
      getMonthCalendarDates,
      getWeekDates,
      heatAlpha: (percent) => (percent <= 0 ? "0.08" : percent < 35 ? "0.24" : percent < 70 ? "0.48" : percent < 100 ? "0.72" : "1"),
      minutesToTime,
      normalizeDateKey,
      parseDate,
      randomCategoryColor,
      sanitizeColor: (value) => (/^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim() : ""),
      timeToMinutes,
      toDateKey,
      toTimeValue: (date) => {
        const safeDate = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
        return `${String(safeDate.getHours()).padStart(2, "0")}:${String(safeDate.getMinutes()).padStart(2, "0")}`;
      },
    };
  }

  const api = { createAppUtils };
  global.RhythmAppUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
