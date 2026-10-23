export function normalizeFocusSessions(value) {
  const records = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 200 || !/^\d{4}-\d{2}-\d{2}$/.test(item.date || "")) continue;
    const date = new Date(`${item.date}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== item.date) continue;
    const minutes = Math.floor(Number(item.minutes)), count = Math.floor(Number(item.count));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440 || !Number.isFinite(count) || count < 0 || count > 1440 || (!minutes && !count)) continue;
    const record = { id: item.id, date: item.date, minutes, count, taskId: String(item.taskId || "").slice(0, 160) };
    const previous = records.get(record.id);
    if (!previous || record.minutes > previous.minutes || (record.minutes === previous.minutes && (record.count > previous.count || (record.count === previous.count && JSON.stringify(record) > JSON.stringify(previous))))) records.set(record.id, record);
  }
  return [...records.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function mergeFocusSessions(local, remote) {
  return normalizeFocusSessions([...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])]);
}

export function focusStats(records, date) {
  return normalizeFocusSessions(records).filter((item) => item.date === date)
    .reduce((total, item) => ({ count: total.count + item.count, minutes: total.minutes + item.minutes }), { count: 0, minutes: 0 });
}
