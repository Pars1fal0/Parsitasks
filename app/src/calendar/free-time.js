export const DURATIONS = [15, 30, 45, 60, 90, 120];
export function minuteOf(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || "")) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
export function timeOf(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
export function normalizePlanning(value = {}) {
  value = value && typeof value === "object" ? value : {};
  const valid = minuteOf(value.start) !== null && minuteOf(value.end) > minuteOf(value.start);
  return { start: valid ? value.start : "08:00", end: valid ? value.end : "22:00", duration: DURATIONS.includes(Number(value.duration)) ? Number(value.duration) : 60,
    updatedAt: Number.isFinite(Date.parse(value.updatedAt || "")) ? value.updatedAt : "" };
}
export function freeIntervals(entries, start = 480, end = 1320) {
  const occupied = entries.filter((entry) => entry.isTimeBlock).map((entry) => [Math.max(start, entry.minutes), Math.min(end, entry.endMinutes)])
    .filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && to > from).sort((a, b) => a[0] - b[0]);
  const result = []; let cursor = start;
  for (const [from, to] of occupied) { if (from > cursor) result.push({ start: cursor, end: from }); cursor = Math.max(cursor, to); }
  if (cursor < end) result.push({ start: cursor, end });
  return result;
}
export function findFreeSlots(days, preferences, { today, nowMinute = 0, dueDate = "", dueTime = "" } = {}) {
  const { start, end, duration } = normalizePlanning(preferences), results = [];
  for (const day of days) {
    if (day.date < today || (dueDate && day.date > dueDate)) continue;
    const from = day.date === today ? Math.max(minuteOf(start), Math.ceil(nowMinute / 15) * 15) : minuteOf(start);
    const to = dueDate === day.date && minuteOf(dueTime) !== null ? Math.min(minuteOf(end), minuteOf(dueTime)) : minuteOf(end);
    for (const gap of freeIntervals(day.entries, from, to)) {
      const rounded = Math.ceil(gap.start / 15) * 15;
      if (gap.end - rounded >= duration) results.push({ date: day.date, start: rounded, end: rounded + duration, availableEnd: gap.end });
    }
  }
  return results;
}
