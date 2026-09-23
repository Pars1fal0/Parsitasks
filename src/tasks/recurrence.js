(function (global) {
  const repeatLabels = {
    none: "Без повтора",
    daily: "Каждый день",
    every2days: "Каждые 2 дня",
    every3days: "Каждые 3 дня",
    weekdays: "Будни",
    weekends: "Выходные",
    weekly: "Еженедельно",
    monthly: "Ежемесячно",
    yearly: "Ежегодно",
    custom: "Настроенный повтор",
  };

  const validRepeats = new Set(Object.keys(repeatLabels));
  const weekdayLabels = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
  const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];

  function taskScheduledOn(task, dateKey) {
    if (task.repeat === "none") return task.date === dateKey;
    if (task.repeatUntil && dateKey > task.repeatUntil) return false;
    const date = parseDate(dateKey);
    const start = parseDate(task.date);
    if (date < start) return false;

    const diff = Math.floor((date - start) / 86400000);
    if (task.repeat === "daily") return true;
    if (task.repeat === "every2days") return diff % 2 === 0;
    if (task.repeat === "every3days") return diff % 3 === 0;
    if (task.repeat === "weekdays") {
      const day = date.getDay();
      return day !== 0 && day !== 6;
    }
    if (task.repeat === "weekends") {
      const day = date.getDay();
      return day === 0 || day === 6;
    }
    if (task.repeat === "weekly") return date.getDay() === start.getDay();
    if (task.repeat === "monthly") return date.getDate() === start.getDate();
    if (task.repeat === "yearly") {
      return date.getDate() === start.getDate() && date.getMonth() === start.getMonth();
    }
    if (task.repeat === "custom") return customRepeatScheduledOn(task.customRepeat, date, diff);
    return false;
  }

  function customRepeatScheduledOn(customRepeat, date, diff) {
    const custom = normalizeCustomRepeat(customRepeat);
    if (custom.type === "weekdays") return custom.weekdays.includes(date.getDay());
    if (custom.type === "monthDay") return date.getDate() === custom.day;
    if (custom.type === "interval") return diff % custom.every === 0;
    return false;
  }

  function normalizeRepeat(value) {
    return validRepeats.has(value) ? value : "none";
  }

  function normalizeCustomRepeat(value) {
    const source = value && typeof value === "object" ? value : {};
    const type = ["weekdays", "monthDay", "interval"].includes(source.type) ? source.type : "weekdays";

    if (type === "monthDay") {
      return {
        type,
        day: clampInteger(source.day, 1, 31, 1),
      };
    }

    if (type === "interval") {
      return {
        type,
        every: clampInteger(source.every, 1, 365, 2),
      };
    }

    const weekdays = Array.isArray(source.weekdays)
      ? [...new Set(source.weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [];

    return {
      type: "weekdays",
      weekdays: weekdays.length ? sortWeekdays(weekdays) : [1, 3, 5],
    };
  }

  function repeatLabel(taskOrRepeat, customRepeat) {
    const repeat = typeof taskOrRepeat === "string" ? taskOrRepeat : taskOrRepeat?.repeat;
    const custom = typeof taskOrRepeat === "string" ? customRepeat : taskOrRepeat?.customRepeat;
    if (repeat !== "custom") return repeatLabels[repeat] || repeatLabels.none;
    return customRepeatLabel(custom);
  }

  function customRepeatLabel(value) {
    const custom = normalizeCustomRepeat(value);
    if (custom.type === "monthDay") return `Каждое ${custom.day} число`;
    if (custom.type === "interval") return `Каждые ${custom.every} дн.`;
    return `По дням: ${sortWeekdays(custom.weekdays).map((day) => weekdayLabels[day]).join(", ")}`;
  }

  function sortWeekdays(days) {
    return [...days].sort((a, b) => weekdayOrder.indexOf(a) - weekdayOrder.indexOf(b));
  }

  function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isInteger(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function parseDate(dateKey) {
    const [year, month, day] = String(dateKey || "").split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  const api = {
    repeatLabels,
    customRepeatLabel,
    normalizeCustomRepeat,
    normalizeRepeat,
    repeatLabel,
    taskScheduledOn,
  };

  global.RhythmRecurrence = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
