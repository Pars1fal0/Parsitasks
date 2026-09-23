(function (global) {
  const TIME_WORDS = {
    утром: "09:00",
    утро: "09:00",
    днем: "14:00",
    днём: "14:00",
    день: "14:00",
    вечером: "18:00",
    вечер: "18:00",
    ночью: "22:00",
    ночь: "22:00",
  };

  const MONTHS = {
    января: 1,
    февраля: 2,
    марта: 3,
    апреля: 4,
    мая: 5,
    июня: 6,
    июля: 7,
    августа: 8,
    сентября: 9,
    октября: 10,
    ноября: 11,
    декабря: 12,
  };

  const WEEKDAYS = {
    пн: 1,
    понедельник: 1,
    вт: 2,
    вторник: 2,
    ср: 3,
    среда: 3,
    среду: 3,
    чт: 4,
    четверг: 4,
    пт: 5,
    пятница: 5,
    пятницу: 5,
    сб: 6,
    суббота: 6,
    субботу: 6,
    вс: 0,
    воскресенье: 0,
  };

  const defaultCleanText = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

  function parseQuickTaskInput(value, context = {}) {
    const cleanText = context.cleanText || defaultCleanText;
    let text = cleanText(value);
    const parsed = {
      title: "",
      date: context.activeDate || fallbackDateKey(new Date()),
      time: "",
      scheduleMode: "deadline",
      startTime: "",
      endTime: "",
      categoryId: "",
      categoryName: "",
      priority: "medium",
      warnings: [],
    };

    text = extractQuickTimeRange(text, parsed);
    text = extractQuickTime(text, parsed);
    text = extractQuickTimeWord(text, parsed);
    text = extractQuickPriority(text, parsed);
    text = extractQuickCategory(text, parsed, context);
    text = extractRelativeDateTime(text, parsed, context);
    text = extractQuickDate(text, parsed, context);
    parsed.title = cleanText(text);
    if (parsed.scheduleMode !== "block") parsed.scheduleMode = parsed.time ? "deadline" : "none";

    return parsed;
  }

  function extractQuickTime(text, parsed) {
    if (parsed.scheduleMode === "block") return text;
    return text.replace(/(^|\s)([01]?\d|2[0-3])([:.])([0-5]\d)(?=\s|$)/, (_match, prefix, hours, separator, minutes) => {
      if (separator === "." && Number(hours) >= 1 && Number(minutes) >= 1 && Number(minutes) <= 12) return _match;
      parsed.time = `${String(Number(hours)).padStart(2, "0")}:${minutes}`;
      return prefix;
    });
  }

  function extractQuickTimeRange(text, parsed) {
    return text.replace(
      /(^|\s)([01]?\d|2[0-3])[:.]([0-5]\d)\s*[-–—]\s*([01]?\d|2[0-3])[:.]([0-5]\d)(?=\s|$)/,
      (_match, prefix, startHours, startMinutes, endHours, endMinutes) => {
        const startTime = `${String(Number(startHours)).padStart(2, "0")}:${startMinutes}`;
        const endTime = `${String(Number(endHours)).padStart(2, "0")}:${endMinutes}`;
        if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
          parsed.warnings.push("Временной блок должен заканчиваться позже, чем начинается");
          return _match;
        }
        parsed.scheduleMode = "block";
        parsed.startTime = startTime;
        parsed.endTime = endTime;
        parsed.time = endTime;
        return prefix;
      },
    );
  }

  function extractQuickTimeWord(text, parsed) {
    if (parsed.scheduleMode === "block") return text;
    return text.replace(
      /(^|\s)(утром|утро|днем|днём|день|вечером|вечер|ночью|ночь)(?=\s|$)/i,
      (_match, prefix, value) => {
        if (!parsed.time) parsed.time = TIME_WORDS[value.toLowerCase()] || "";
        return prefix;
      },
    );
  }

  function extractQuickPriority(text, parsed) {
    return text.replace(/(^|\s)!([\p{L}\d_-]+)/u, (_match, prefix, value) => {
      const priority = quickPriorityValue(value);
      if (!priority) {
        parsed.warnings.push(`Неизвестный приоритет: !${value}`);
        return _match;
      }
      parsed.priority = priority;
      return prefix;
    });
  }

function extractQuickCategory(text, parsed, context) {
  return text.replace(/(^|\s)#([\p{L}\d_-]+)/u, (_match, prefix, value) => {
      parsed.categoryName = context.normalizeCategoryName?.(value) || defaultCleanText(String(value || "").replaceAll("_", " "));
      parsed.categoryId = context.getOrCreateCategory?.(value) || "";
      return prefix;
    });
}

  function extractRelativeDateTime(text, parsed, context) {
    return text.replace(
      /(^|\s)через\s+(\d+)\s*(минут(?:у|ы)?|мин|час(?:а|ов)?|ч|д(?:ень|ня|ней)?|недел(?:ю|и|ь)|нед)(?=\s|$)/i,
      (_match, prefix, amountValue, unitValue) => {
        const amount = Number(amountValue);
        if (!Number.isFinite(amount) || amount <= 0) return prefix;
        const target = resolveNow(context);
        const unit = unitValue.toLowerCase();

        if (unit.startsWith("мин")) {
          target.setMinutes(target.getMinutes() + amount);
          parsed.date = toDateKey(target, context);
          parsed.time = toTimeValue(target, context);
        } else if (unit === "ч" || unit.startsWith("час")) {
          target.setHours(target.getHours() + amount);
          parsed.date = toDateKey(target, context);
          parsed.time = toTimeValue(target, context);
        } else if (unit.startsWith("д") || unit.startsWith("нед")) {
          target.setDate(target.getDate() + amount * (unit.startsWith("нед") ? 7 : 1));
          parsed.date = toDateKey(target, context);
        }

        return prefix;
      },
    );
  }

  function extractQuickDate(text, parsed, context) {
    const base = resolveNow(context);
    const keywordPatterns = [
      { pattern: /(^|\s)(сегодня)(?=\s|$)/i, days: 0 },
      { pattern: /(^|\s)(завтра)(?=\s|$)/i, days: 1 },
      { pattern: /(^|\s)(послезавтра)(?=\s|$)/i, days: 2 },
      { pattern: /(^|\s)(через\s+неделю|на\s+следующей\s+неделе|на\s+следующую\s+неделю)(?=\s|$)/i, days: 7 },
    ];

    for (const item of keywordPatterns) {
      if (item.pattern.test(text)) {
        const target = new Date(base);
        target.setDate(base.getDate() + item.days);
        parsed.date = toDateKey(target, context);
        return text.replace(item.pattern, "$1");
      }
    }

    const nextWeekdayMatch = /(^|\s)(?:в\s+)?следующ(?:ий|ую|ее)\s+(понедельник|пн|вторник|вт|среду|среда|ср|четверг|чт|пятницу|пятница|пт|субботу|суббота|сб|воскресенье|вс)(?=\s|$)/i.exec(text);
    if (nextWeekdayMatch) {
      parsed.date = nextWeekdayDate(nextWeekdayMatch[2], base, context, { skipCurrentWeek: true });
      return text.replace(nextWeekdayMatch[0], nextWeekdayMatch[1]);
    }

    const isoMatch = /(^|\s)(\d{4}-\d{2}-\d{2})(?=\s|$)/.exec(text);
    if (isoMatch) {
      const date = normalizeDateKey(isoMatch[2], "", context);
      if (date) {
        parsed.date = date;
        return text.replace(isoMatch[0], isoMatch[1]);
      }
    }

    const shortDateMatch = /(^|\s)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s|$)/.exec(text);
    if (shortDateMatch) {
      const day = Number(shortDateMatch[2]);
      const month = Number(shortDateMatch[3]);
      const yearPart = shortDateMatch[4];
      let year = yearPart ? Number(yearPart.length === 2 ? `20${yearPart}` : yearPart) : base.getFullYear();
      let date = normalizeDateKey(
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        "",
        context,
      );
      if (date && !yearPart && date < toDateKey(base, context)) {
        year += 1;
        date = normalizeDateKey(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, "", context);
      }
      if (date) {
        parsed.date = date;
        return text.replace(shortDateMatch[0], shortDateMatch[1]);
      }
    }

    const monthNameMatch = /(^|\s)(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{2,4}))?(?=\s|$)/i.exec(text);
    if (monthNameMatch) {
      const day = Number(monthNameMatch[2]);
      const month = MONTHS[monthNameMatch[3].toLowerCase()] || 0;
      const yearPart = monthNameMatch[4];
      let year = yearPart ? Number(yearPart.length === 2 ? `20${yearPart}` : yearPart) : base.getFullYear();
      let date = normalizeDateKey(
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        "",
        context,
      );
      if (date && !yearPart && date < toDateKey(base, context)) {
        year += 1;
        date = normalizeDateKey(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, "", context);
      }
      if (date) {
        parsed.date = date;
        return text.replace(monthNameMatch[0], monthNameMatch[1]);
      }
    }

    const weekdayMatch = /(^|\s)(?:в\s+)?(понедельник|пн|вторник|вт|среду|среда|ср|четверг|чт|пятницу|пятница|пт|субботу|суббота|сб|воскресенье|вс)(?=\s|$)/i.exec(text);
    if (weekdayMatch) {
      parsed.date = nextWeekdayDate(weekdayMatch[2], base, context);
      return text.replace(weekdayMatch[0], weekdayMatch[1]);
    }

    return text;
  }

  function quickPriorityValue(value) {
    const normalized = String(value || "").toLowerCase();
    if (["high", "hi", "важно", "важный", "высокий", "срочно", "urgent"].includes(normalized)) return "high";
    if (["low", "низкий", "низко", "потом"].includes(normalized)) return "low";
    if (["medium", "med", "normal", "\u0441\u0440\u0435\u0434\u043d\u0438\u0439", "\u043e\u0431\u044b\u0447\u043d\u043e"].includes(normalized)) return "medium";
    return "";
  }

  function nextWeekdayDate(value, base, context, options = {}) {
    const targetDay = WEEKDAYS[String(value || "").toLowerCase()];
    if (!Number.isInteger(targetDay)) return toDateKey(base, context);
    const target = new Date(base);
    const diff = (targetDay - target.getDay() + 7) % 7 || 7;
    const extraWeek = options.skipCurrentWeek && diff < 7 ? 7 : 0;
    target.setDate(base.getDate() + diff + extraWeek);
    return toDateKey(target, context);
  }

  function normalizeDateKey(value, fallback, context) {
    return context.normalizeDateKey?.(value, fallback) ?? fallbackDateKey(new Date(value || Date.now()));
  }

  function toDateKey(date, context) {
    return context.toDateKey?.(date) ?? fallbackDateKey(date);
  }

  function toTimeValue(date, context) {
    if (context.toTimeValue) return context.toTimeValue(date);
    const safeDate = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
    return `${String(safeDate.getHours()).padStart(2, "0")}:${String(safeDate.getMinutes()).padStart(2, "0")}`;
  }

  function timeToMinutes(value) {
    const [hours, minutes] = String(value || "").split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return NaN;
    return hours * 60 + minutes;
  }

  function fallbackDateKey(date) {
    const safeDate = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
    return `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, "0")}-${String(safeDate.getDate()).padStart(2, "0")}`;
  }

  function resolveNow(context = {}) {
    const value = typeof context.now === "function" ? context.now() : context.now;
    const date = value ? new Date(value) : new Date();
    return Number.isFinite(date.getTime()) ? date : new Date();
  }

  const api = { parseQuickTaskInput };
  global.RhythmQuickInput = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
