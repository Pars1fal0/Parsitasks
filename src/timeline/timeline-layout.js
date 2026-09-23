(function (global) {
  const TIMELINE_HOUR_HEIGHT = 96;
  const TIMELINE_SLOT_MINUTES = 15;
  const DEFAULT_BLOCK_MINUTES = 60;
  const TIMELINE_LAST_MINUTE = 23 * 60 + 45;

  function buildTimelineModel({ activeDate, formatTime, getCategory, isTaskDone, now = new Date(), priorityLabels, tasks, todayKey }) {
    const timedTasks = [];
    const unscheduledTasks = [];
    const resolvedTodayKey = todayKey || dateKeyFromDate(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    tasks.forEach((task) => {
      const block = parseTaskBlock(task);
      const minutes = Number.isFinite(block.start) ? block.start : parseTimeToMinutes(task.time);
      const endMinutes = Number.isFinite(block.end) ? block.end : Number.isFinite(minutes) ? minutes + 30 : minutes;
      const visualDuration = Number.isFinite(minutes) ? Math.max(TIMELINE_SLOT_MINUTES, endMinutes - minutes) : NaN;
      const category = getCategory(task.categoryId);
      const done = isTaskDone(task, activeDate);
      const entry = {
        categoryColor: category?.color || "",
        columnCount: 1,
        columnIndex: 0,
        done,
        endMinutes,
        hour: Number.isFinite(minutes) ? Math.floor(minutes / 60) : null,
        isOverdue: Number.isFinite(endMinutes) && !done && isTaskTimeOverdue(activeDate, endMinutes, resolvedTodayKey, currentMinutes),
        isTimeBlock: Number.isFinite(block.start) && Number.isFinite(block.end),
        metaLabel: category?.name || priorityLabels[task.priority] || "Задача",
        minutes,
        task,
        timeLabel:
          Number.isFinite(block.start) && Number.isFinite(block.end)
            ? `${formatTime(task.startTime)}-${formatTime(task.endTime)}`
            : Number.isFinite(minutes)
              ? formatTime(task.time)
              : "",
        title: task.title,
        visualDuration,
      };

      if (Number.isFinite(minutes)) timedTasks.push(entry);
      else unscheduledTasks.push(entry);
    });

    timedTasks.sort((a, b) => a.minutes - b.minutes || priorityRank(a.task.priority) - priorityRank(b.task.priority) || a.title.localeCompare(b.title));
    assignTimelineColumns(timedTasks);
    unscheduledTasks.sort((a, b) => priorityRank(a.task.priority) - priorityRank(b.task.priority) || a.title.localeCompare(b.title));

    const currentHour = activeDate === resolvedTodayKey ? Math.floor(currentMinutes / 60) : null;
    const startHour = 0;
    const endHour = 23;
    const hourRows = [];

    for (let hour = startHour; hour <= endHour; hour += 1) {
      hourRows.push({
        hour,
        label: formatTime(`${String(hour).padStart(2, "0")}:00`),
        tasks: timedTasks.filter((entry) => entry.hour === hour),
      });
    }

    return {
      hourRows,
      nowLine:
        Number.isFinite(currentHour) && currentHour >= startHour && currentHour <= endHour
          ? {
              hour: currentHour,
              offsetPercent: Math.round(((currentMinutes % 60) / 60) * 100),
            }
          : null,
      timedTasks,
      unscheduledTasks,
    };
  }

  function getSlotHeight(slot) {
    return Math.max(60, slot?.clientHeight || TIMELINE_HOUR_HEIGHT);
  }

  function snapMinutes(value) {
    return Math.round(value / TIMELINE_SLOT_MINUTES) * TIMELINE_SLOT_MINUTES;
  }

  function minutesToPx(minutes, hourHeight = TIMELINE_HOUR_HEIGHT) {
    return (minutes / 60) * hourHeight;
  }

  function minuteOffsetToPx(minutes, hourHeight = TIMELINE_HOUR_HEIGHT) {
    return minutesToPx(minutes % 60, hourHeight);
  }

  function parseTimeToMinutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
    if (!match) return NaN;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return NaN;
    return hours * 60 + minutes;
  }

  function formatHourMinute(hour, minute = 0) {
    const safeHour = Math.max(0, Math.min(23, Number(hour) || 0));
    const safeMinute = Math.max(0, Math.min(59, Number(minute) || 0));
    return `${String(safeHour).padStart(2, "0")}:${String(safeMinute).padStart(2, "0")}`;
  }

  function formatBlockLabel(start, end) {
    return `${formatHourMinute(Math.floor(start / 60), start % 60)}-${formatHourMinute(Math.floor(end / 60), end % 60)}`;
  }

  function nextBlockTimes(start, end, edge, delta) {
    if (edge === "start") {
      const nextStart = Math.max(0, Math.min(end - TIMELINE_SLOT_MINUTES, start + delta));
      return { start: nextStart, end };
    }
    const nextEnd = Math.max(start + TIMELINE_SLOT_MINUTES, Math.min(TIMELINE_LAST_MINUTE, end + delta));
    return { start, end: nextEnd };
  }

  function parseTaskBlock(task) {
    if (task?.scheduleMode !== "block") return { start: NaN, end: NaN };
    const start = parseTimeToMinutes(task.startTime);
    const end = parseTimeToMinutes(task.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { start: NaN, end: NaN };
    return { start, end };
  }

  function assignTimelineColumns(entries) {
    let cluster = [];
    let clusterEnd = -Infinity;

    entries.forEach((entry) => {
      const start = entry.minutes;
      const end = entryLayoutEnd(entry);
      if (!cluster.length || start < clusterEnd) {
        cluster.push(entry);
        clusterEnd = Math.max(clusterEnd, end);
        return;
      }
      assignClusterColumns(cluster);
      cluster = [entry];
      clusterEnd = end;
    });

    if (cluster.length) assignClusterColumns(cluster);
  }

  function assignClusterColumns(cluster) {
    const columns = [];
    cluster.forEach((entry) => {
      const start = entry.minutes;
      const end = entryLayoutEnd(entry);
      let columnIndex = columns.findIndex((columnEnd) => columnEnd <= start);
      if (columnIndex === -1) {
        columnIndex = columns.length;
        columns.push(end);
      } else {
        columns[columnIndex] = end;
      }
      entry.columnIndex = columnIndex;
    });

    const columnCount = Math.max(1, columns.length);
    cluster.forEach((entry) => {
      entry.columnCount = columnCount;
    });
  }

  function entryLayoutEnd(entry) {
    return Math.min(24 * 60, entry.minutes + Math.max(TIMELINE_SLOT_MINUTES, entry.visualDuration || TIMELINE_SLOT_MINUTES));
  }

  function priorityRank(priority) {
    return { high: 0, medium: 1, low: 2 }[priority] ?? 1;
  }

  function isTaskTimeOverdue(activeDate, minutes, todayKey, currentMinutes) {
    if (activeDate < todayKey) return true;
    if (activeDate > todayKey) return false;
    return minutes < currentMinutes;
  }

  function dateKeyFromDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const api = {
    DEFAULT_BLOCK_MINUTES,
    TIMELINE_HOUR_HEIGHT,
    TIMELINE_LAST_MINUTE,
    TIMELINE_SLOT_MINUTES,
    buildTimelineModel,
    formatBlockLabel,
    formatHourMinute,
    getSlotHeight,
    minuteOffsetToPx,
    minutesToPx,
    nextBlockTimes,
    parseTaskBlock,
    parseTimeToMinutes,
    snapMinutes,
  };

  global.RhythmTimelineLayout = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
