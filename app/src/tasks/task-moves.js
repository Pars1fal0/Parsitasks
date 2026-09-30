(function (global) {
  function postponeTask({ state, task, sourceDateKey, targetDateKey, options = {}, helpers = {} }) {
    const shouldClearTime = shouldClearTimeForToday(task, targetDateKey, options, helpers);

    if (task.repeat === "none") {
      moveSingleTask(state, task, sourceDateKey, targetDateKey, { clearTime: shouldClearTime });
    } else {
      moveRecurringOccurrence(state, task, sourceDateKey, targetDateKey, { clearTime: shouldClearTime }, helpers);
    }

    return { targetDate: targetDateKey };
  }

  function moveSingleTask(state, task, sourceDateKey, targetDateKey, options = {}) {
    sourceDateKey ||= task.deferredFromDate || "";
    const wasDone = task.completed?.[sourceDateKey] === true;
    task.completed = task.completed || {};
    task.notified = task.notified || {};
    task.date = targetDateKey;
    task.deferredFromDate = "";
    global.RhythmTaskChecklist?.moveDate(task, sourceDateKey, targetDateKey);
    if (options.clearTime) {
      task.time = "";
      task.scheduleMode = "none";
      task.startTime = "";
      task.endTime = "";
    }
    delete task.completed?.[sourceDateKey];
    delete task.acknowledgedOverdue?.[sourceDateKey];
    delete task.notified?.[sourceDateKey];
    removeTaskFromOrder(state, task.id, sourceDateKey);
    if (wasDone) task.completed[targetDateKey] = true;
    task.updatedAt = new Date().toISOString();
  }

  function moveRecurringOccurrence(state, task, sourceDateKey, targetDateKey, options = {}, helpers = {}) {
    const wasDone = task.completed?.[sourceDateKey] === true;
    task.excludedDates = task.excludedDates || {};
    task.excludedDates[sourceDateKey] = true;
    delete task.completed?.[sourceDateKey];
    delete task.acknowledgedOverdue?.[sourceDateKey];
    delete task.notified?.[sourceDateKey];
    removeTaskFromOrder(state, task.id, sourceDateKey);
    task.updatedAt = new Date().toISOString();

    const targetHasNaturalOccurrence = targetDateKey !== sourceDateKey && helpers.taskScheduledOn?.(task, targetDateKey);
    if (targetHasNaturalOccurrence && !options.clearTime) {
      delete task.excludedDates[targetDateKey];
      if (wasDone) (task.completed ||= {})[targetDateKey] = true;
      global.RhythmTaskChecklist?.moveDate(task, sourceDateKey, targetDateKey);
      return;
    }
    if (targetHasNaturalOccurrence) task.excludedDates[targetDateKey] = true;

    state.tasks.push({
      id: helpers.createId?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      title: task.title,
      date: targetDateKey,
      time: options.clearTime ? "" : task.time,
      scheduleMode: options.clearTime ? "none" : task.scheduleMode || (task.time ? "deadline" : "none"),
      startTime: options.clearTime ? "" : task.startTime || "",
      endTime: options.clearTime ? "" : task.endTime || "",
      categoryId: task.categoryId,
      priority: task.priority,
      repeat: "none",
      sourceTaskId: task.id,
      movedFromDate: sourceDateKey,
      customRepeat: {},
      reminderOffset: task.reminderOffset,
      checklist: clone(task.checklist || []),
      checklistLogs: { [targetDateKey]: clone(task.checklistLogs?.[sourceDateKey] || {}) },
      completed: wasDone ? { [targetDateKey]: true } : {},
      acknowledgedOverdue: {},
      excludedDates: {},
      notified: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  function shouldClearTimeForToday(task, targetDateKey, options = {}, helpers = {}) {
    if (!options.clearPastTimeToday) return false;
    if (targetDateKey !== helpers.toDateKey?.(new Date())) return false;
    return Boolean(helpers.cleanTimeValue?.(task.time));
  }

  function moveTasksToDate({ state, entries = [], targetDateKey, helpers = {} }) {
    const date = new Date(`${targetDateKey}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDateKey || "") || !Number.isFinite(date.getTime())
      || date.toISOString().slice(0, 10) !== targetDateKey) return { moved: 0, skipped: entries.length };
    const seen = new Set();
    let moved = 0;
    let skipped = 0;
    entries.forEach(({ taskId, dateKey }) => {
      const key = `${taskId}:${dateKey || "later"}`;
      const task = state.tasks.find((item) => item.id === taskId);
      if (seen.has(key) || !task || dateKey === targetDateKey
        || (task.date && (!helpers.taskScheduledOn?.(task, dateKey) || task.excludedDates?.[dateKey] === true))) {
        skipped += 1;
        return;
      }
      seen.add(key);
      postponeTask({ state, task, sourceDateKey: dateKey, targetDateKey,
        options: { clearPastTimeToday: true }, helpers });
      moved += 1;
    });
    return { moved, skipped };
  }

  function removeTaskFromOrder(state, taskId, dateKey) {
    if (!Array.isArray(state.taskOrder?.[dateKey])) return;
    state.taskOrder[dateKey] = state.taskOrder[dateKey].filter((id) => id !== taskId);
  }

  function updateRecurringTaskSchedule({ state, task, dateKey, schedule, scope, helpers = {} }) {
    if (task.repeat === "none") {
      applyTaskSchedule(task, schedule);
      return task;
    }
    if (scope === "occurrence") return createScheduledOccurrence(state, task, dateKey, schedule, helpers);
    if (scope === "following") return splitRecurringSeries(state, task, dateKey, schedule, helpers);
    return null;
  }

  function updateRecurringTaskDetails({ state, task, dateKey, editedTask, scope, helpers = {} }) {
    if (task.repeat === "none") {
      applyEditableTaskFields(task, editedTask);
      task.date = editedTask.date;
      task.updatedAt = new Date().toISOString();
      return task;
    }

    if (scope === "occurrence") return createEditedOccurrence(state, task, dateKey, editedTask, helpers);
    if (scope === "following") return splitEditedRecurringSeries(state, task, dateKey, editedTask, helpers);

    applyEditableTaskFields(task, editedTask);
    task.updatedAt = new Date().toISOString();
    return task;
  }

  function moveRecurringSeriesFollowing({ state, task, sourceDateKey, targetDateKey, helpers = {} }) {
    if (!task || task.repeat === "none" || !sourceDateKey || !targetDateKey || targetDateKey <= sourceDateKey) return null;
    const nextSeries = splitEditedRecurringSeries(state, task, sourceDateKey, task, helpers);
    if (!nextSeries) return null;
    nextSeries.date = targetDateKey;
    nextSeries.completed = {};
    nextSeries.acknowledgedOverdue = {};
    nextSeries.excludedDates = {};
    nextSeries.notified = {};
    nextSeries.checklistLogs = {};
    nextSeries.updatedAt = new Date().toISOString();
    return nextSeries;
  }

  function createEditedOccurrence(state, task, dateKey, editedTask, helpers = {}) {
    const now = new Date().toISOString();
    const completed = task.completed?.[dateKey] === true ? { [dateKey]: true } : {};
    task.excludedDates ||= {};
    task.excludedDates[dateKey] = true;
    delete task.completed?.[dateKey];
    delete task.acknowledgedOverdue?.[dateKey];
    delete task.notified?.[dateKey];
    task.updatedAt = now;

    const occurrence = {
      ...copyEditableTaskFields(editedTask),
      id: helpers.createId?.() || createFallbackId(),
      date: dateKey,
      repeat: "none",
      repeatUntil: "",
      customRepeat: {},
      sourceTaskId: task.id,
      movedFromDate: dateKey,
      completed,
      checklistLogs: { [dateKey]: clone(task.checklistLogs?.[dateKey] || {}) },
      acknowledgedOverdue: {},
      excludedDates: {},
      notified: {},
      createdAt: now,
      updatedAt: now,
    };
    state.tasks.push(occurrence);
    replaceTaskInOrder(state, dateKey, task.id, occurrence.id);
    return occurrence;
  }

  function splitEditedRecurringSeries(state, task, dateKey, editedTask, helpers = {}) {
    if (dateKey <= task.date) {
      applyEditableTaskFields(task, editedTask);
      task.updatedAt = new Date().toISOString();
      return task;
    }

    const now = new Date().toISOString();
    const nextSeries = {
      ...copyEditableTaskFields(editedTask),
      id: helpers.createId?.() || createFallbackId(),
      date: dateKey,
      sourceTaskId: "",
      movedFromDate: "",
      completed: takeFlagsFrom(task, "completed", dateKey),
      checklistLogs: takeFlagsFrom(task, "checklistLogs", dateKey),
      acknowledgedOverdue: takeFlagsFrom(task, "acknowledgedOverdue", dateKey),
      excludedDates: takeFlagsFrom(task, "excludedDates", dateKey),
      notified: takeFlagsFrom(task, "notified", dateKey),
      createdAt: now,
      updatedAt: now,
    };

    task.repeatUntil = previousDateKey(dateKey);
    task.updatedAt = now;
    state.tasks.push(nextSeries);
    Object.keys(state.taskOrder || {}).forEach((orderDate) => {
      if (orderDate >= dateKey) replaceTaskInOrder(state, orderDate, task.id, nextSeries.id);
    });
    return nextSeries;
  }

  function createScheduledOccurrence(state, task, dateKey, schedule, helpers = {}) {
    const now = new Date().toISOString();
    const completed = task.completed?.[dateKey] === true ? { [dateKey]: true } : {};
    task.excludedDates ||= {};
    task.excludedDates[dateKey] = true;
    delete task.completed?.[dateKey];
    delete task.acknowledgedOverdue?.[dateKey];
    delete task.notified?.[dateKey];
    task.updatedAt = now;

    const occurrence = {
      ...copyTaskIdentity(task),
      id: helpers.createId?.() || createFallbackId(),
      date: dateKey,
      repeat: "none",
      repeatUntil: "",
      customRepeat: {},
      sourceTaskId: task.id,
      movedFromDate: dateKey,
      completed,
      checklistLogs: { [dateKey]: clone(task.checklistLogs?.[dateKey] || {}) },
      acknowledgedOverdue: {},
      excludedDates: {},
      notified: {},
      createdAt: now,
      updatedAt: now,
    };
    applyTaskSchedule(occurrence, schedule);
    state.tasks.push(occurrence);
    replaceTaskInOrder(state, dateKey, task.id, occurrence.id);
    return occurrence;
  }

  function splitRecurringSeries(state, task, dateKey, schedule, helpers = {}) {
    if (dateKey <= task.date) {
      applyTaskSchedule(task, schedule);
      task.updatedAt = new Date().toISOString();
      return task;
    }

    const now = new Date().toISOString();
    const originalRepeatUntil = task.repeatUntil || "";
    const nextSeries = {
      ...copyTaskIdentity(task),
      id: helpers.createId?.() || createFallbackId(),
      date: dateKey,
      repeat: task.repeat,
      repeatUntil: originalRepeatUntil,
      customRepeat: clone(task.customRepeat || {}),
      sourceTaskId: "",
      movedFromDate: "",
      completed: takeFlagsFrom(task, "completed", dateKey),
      checklistLogs: takeFlagsFrom(task, "checklistLogs", dateKey),
      acknowledgedOverdue: takeFlagsFrom(task, "acknowledgedOverdue", dateKey),
      excludedDates: takeFlagsFrom(task, "excludedDates", dateKey),
      notified: takeFlagsFrom(task, "notified", dateKey),
      createdAt: now,
      updatedAt: now,
    };
    applyTaskSchedule(nextSeries, schedule);

    task.repeatUntil = previousDateKey(dateKey);
    task.updatedAt = now;
    state.tasks.push(nextSeries);
    Object.keys(state.taskOrder || {}).forEach((orderDate) => {
      if (orderDate >= dateKey) replaceTaskInOrder(state, orderDate, task.id, nextSeries.id);
    });
    return nextSeries;
  }

  function copyTaskIdentity(task) {
    return {
      title: task.title,
      time: task.time || "",
      scheduleMode: task.scheduleMode || (task.time ? "deadline" : "none"),
      startTime: task.startTime || "",
      endTime: task.endTime || "",
      categoryId: task.categoryId || "",
      priority: task.priority || "medium",
      reminderOffset: task.reminderOffset || "none",
      checklist: clone(task.checklist || []),
    };
  }

  function copyEditableTaskFields(task) {
    return {
      ...copyTaskIdentity(task),
      repeat: task.repeat || "none",
      repeatUntil: task.repeat === "none" ? "" : task.repeatUntil || "",
      customRepeat: task.repeat === "custom" ? clone(task.customRepeat || {}) : {},
    };
  }

  function applyEditableTaskFields(task, editedTask) {
    Object.assign(task, copyEditableTaskFields(editedTask));
  }

  function applyTaskSchedule(task, schedule = {}) {
    task.scheduleMode = schedule.scheduleMode === "block" ? "block" : schedule.time ? "deadline" : "none";
    task.startTime = task.scheduleMode === "block" ? schedule.startTime || "" : "";
    task.endTime = task.scheduleMode === "block" ? schedule.endTime || "" : "";
    task.time = task.scheduleMode === "block" ? task.endTime : schedule.time || "";
  }

  function takeFlagsFrom(task, field, fromDate) {
    const future = {};
    Object.entries(task[field] || {}).forEach(([dateKey, value]) => {
      if (dateKey >= fromDate) {
        future[dateKey] = value;
        delete task[field][dateKey];
      }
    });
    return future;
  }

  function replaceTaskInOrder(state, dateKey, sourceId, replacementId) {
    if (!Array.isArray(state.taskOrder?.[dateKey])) return;
    state.taskOrder[dateKey] = state.taskOrder[dateKey].map((id) => (id === sourceId ? replacementId : id));
  }

  function previousDateKey(dateKey) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    const date = new Date(year, month - 1, day - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createFallbackId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  const api = {
    moveTasksToDate,
    moveRecurringSeriesFollowing,
    moveRecurringOccurrence,
    moveSingleTask,
    postponeTask,
    removeTaskFromOrder,
    shouldClearTimeForToday,
    updateRecurringTaskDetails,
    updateRecurringTaskSchedule,
  };

  global.RhythmTaskMoves = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
