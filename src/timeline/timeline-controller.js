(function (global) {
  const taskMovesApi = global.RhythmTaskMoves || (typeof require !== "undefined" ? require("../tasks/task-moves.js") : null);
  const TIMELINE_LAST_MINUTE = 23 * 60 + 45;

  function createTimelineController(ctx) {
    function deleteTask(taskId) {
      const task = ctx.findTask(taskId);
      if (!task) return false;
      if (task.sourceTaskId && ctx.confirmAction) return deleteMovedReplacement(task);
      if (task.repeat !== "none" && ctx.confirmAction) {
        return deleteRecurringTask(task);
      }
      const undo = ctx.createUndoSnapshot();
      ctx.deleteTask(taskId);
      commit(ctx.messages.deleted, undo);
      return true;
    }

    async function deleteMovedReplacement(task) {
      const choice = await ctx.confirmAction({
        title: "Удалить перенесенную задачу?",
        message: "Можно вернуть исходный повтор на этот день или оставить день исключенным из серии.",
        secondaryLabel: "Вернуть повтор",
        confirmLabel: "Оставить день пустым",
        tone: "danger",
      });
      if (!choice) return false;
      const undo = ctx.createUndoSnapshot();
      ctx.deleteMovedReplacement(task.id, { restoreSourceOccurrence: choice === "secondary" });
      commit(choice === "secondary" ? "Исходный повтор возвращен" : ctx.messages.deleted, undo);
      return true;
    }

    async function deleteRecurringTask(task) {
      const dateKey = ctx.getActiveDate();
      const scope = await ctx.confirmAction({
        title: "Удалить повторяющуюся задачу?",
        message: `Выбери, убрать только ${ctx.formatLongDate(dateKey)} или завершить серию с этого дня. Прошлая история сохранится.`,
        secondaryLabel: "Только этот день",
        confirmLabel: "Этот и будущие",
        tone: "danger",
      });
      if (scope === "secondary") {
        ctx.excludeTaskDate(task, dateKey);
        return true;
      }
      if (scope === true) {
        ctx.stopTaskSeries(task, dateKey);
        return true;
      }
      return false;
    }

    function toggleTaskDone(taskId) {
      const task = ctx.findTask(taskId);
      if (!task) return false;
      const activeDate = ctx.getActiveDate();
      const undo = ctx.createUndoSnapshot();
      const done = ctx.isTaskDone(task, activeDate);
      task.completed = task.completed || {};
      task.completed[activeDate] = !done;
      task.updatedAt = new Date().toISOString();
      commit(done ? ctx.messages.active : ctx.messages.done, undo);
      return true;
    }

    function duplicateTask(taskId) {
      const task = ctx.findTask(taskId);
      if (!task) return null;
      if (task.repeat !== "none" && ctx.confirmAction) return chooseDuplicateScope(task);
      return createDuplicate(task, { wholeSeries: false });
    }

    async function chooseDuplicateScope(task) {
      const choice = await ctx.confirmAction({
        title: "Дублировать повторяющуюся задачу?",
        message: "Создать разовую копию выбранного дня или вторую повторяющуюся серию?",
        secondaryLabel: "Только этот день",
        confirmLabel: "Всю серию",
      });
      if (!choice) return null;
      return createDuplicate(task, { wholeSeries: choice === true });
    }

    function createDuplicate(task, options = {}) {
      const activeDate = ctx.getActiveDate();
      const undo = ctx.createUndoSnapshot();
      const source = cloneTask(task);
      const duplicate = {
        ...source,
        id: ctx.createId(),
        title: `${task.title} ${ctx.messages.copySuffix}`,
        date: options.wholeSeries ? task.date : activeDate,
        repeat: options.wholeSeries ? task.repeat : "none",
        repeatUntil: options.wholeSeries ? task.repeatUntil || "" : "",
        customRepeat: options.wholeSeries ? cloneTask(task.customRepeat || {}) : {},
        sourceTaskId: "",
        movedFromDate: "",
        completed: {},
        acknowledgedOverdue: {},
        excludedDates: {},
        notified: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      ctx.getState().tasks.push(duplicate);
      ctx.getState().taskOrder[activeDate] = ctx.getOrderedTasksForDate(activeDate).map((item) => item.id);
      const sourceIndex = ctx.getState().taskOrder[activeDate].indexOf(task.id);
      if (sourceIndex >= 0) {
        ctx.getState().taskOrder[activeDate] = ctx.getState().taskOrder[activeDate].filter((id) => id !== duplicate.id);
        ctx.getState().taskOrder[activeDate].splice(sourceIndex + 1, 0, duplicate.id);
      }

      commit(ctx.messages.duplicated, undo);
      return duplicate;
    }

    function moveTaskTime(taskId, targetTime) {
      return updateTaskTime(taskId, targetTime, ctx.messages.timeUpdated);
    }

    function shiftTaskTime(taskId, offsetMinutes) {
      const task = ctx.findTask(taskId);
      if (!task) return false;
      const currentMinutes = ctx.timeToMinutes(ctx.taskSortTime(task));
      if (!Number.isFinite(currentMinutes)) return false;
      const blockDuration = ctx.isTimeBlock(task)
        ? Math.max(15, ctx.timeToMinutes(task.endTime) - ctx.timeToMinutes(task.startTime))
        : 0;
      const nextMinutes = Math.max(0, Math.min(TIMELINE_LAST_MINUTE - blockDuration, currentMinutes + offsetMinutes));
      const nextTime = ctx.minutesToTime(nextMinutes);
      return updateTaskTime(taskId, nextTime, `${ctx.messages.movedTo} ${ctx.formatTime(nextTime)}`);
    }

    function setTaskTime(taskId, targetTime) {
      return updateTaskTime(taskId, targetTime, `${ctx.messages.movedTo} ${ctx.formatTime(targetTime)}`);
    }

    function clearTaskTime(taskId) {
      const task = ctx.findTask(taskId);
      if (!task || (!ctx.isTimeBlock(task) && !ctx.cleanTimeValue(task.time))) return false;
      const schedule = { scheduleMode: "none", startTime: "", endTime: "", time: "" };
      if (task.repeat !== "none" && !task.sourceTaskId) {
        return updateRecurringSchedule(task, schedule, "Задача теперь без времени");
      }

      const undo = ctx.createUndoSnapshot();
      applySchedule(task, schedule);
      task.reminderOffset = "none";
      clearNotification(task, ctx.getActiveDate());
      task.updatedAt = new Date().toISOString();
      commit("Задача теперь без времени", undo);
      return true;
    }

    function updateTaskTime(taskId, targetTime, message) {
      const task = ctx.findTask(taskId);
      const nextTime = ctx.cleanTimeValue(targetTime);
      if (!task || !nextTime || ctx.taskSortTime(task) === nextTime) return false;

      const schedule = scheduleAtTime(task, nextTime, ctx);
      if (task.repeat !== "none" && !task.sourceTaskId) {
        return updateRecurringSchedule(task, schedule, message || ctx.messages.timeUpdated);
      }

      const undo = ctx.createUndoSnapshot();
      applySchedule(task, schedule);
      clearNotification(task, ctx.getActiveDate());
      task.updatedAt = new Date().toISOString();
      commit(message || ctx.messages.timeUpdated, undo);
      return true;
    }

    function scheduleAtTime(task, nextTime, helpers) {
      if (ctx.isTimeBlock(task)) {
        const duration = helpers.timeToMinutes(task.endTime) - helpers.timeToMinutes(task.startTime);
        const nextStart = helpers.timeToMinutes(nextTime);
        const nextEnd = Math.min(TIMELINE_LAST_MINUTE, nextStart + duration);
        const endTime = helpers.minutesToTime(nextEnd);
        return {
          scheduleMode: "block",
          startTime: helpers.minutesToTime(Math.max(0, nextEnd - duration)),
          endTime,
          time: endTime,
        };
      }
      if (!helpers.cleanTimeValue(task.time)) {
        const nextStart = helpers.timeToMinutes(nextTime);
        const nextEnd = Math.min(TIMELINE_LAST_MINUTE, nextStart + 60);
        const endTime = helpers.minutesToTime(nextEnd);
        return {
          scheduleMode: "block",
          startTime: helpers.minutesToTime(Math.max(0, nextEnd - 60)),
          endTime,
          time: endTime,
        };
      }
      return { scheduleMode: "deadline", startTime: "", endTime: "", time: nextTime };
    }

    function resizeTaskBlockTime(taskId, startTime, endTime) {
      const task = ctx.findTask(taskId);
      if (!task || !ctx.isValidTimeBlock(startTime, endTime)) return false;
      const nextStart = ctx.cleanTimeValue(startTime);
      const nextEnd = ctx.cleanTimeValue(endTime);
      if (task.startTime === nextStart && task.endTime === nextEnd) return false;

      const schedule = { scheduleMode: "block", startTime: nextStart, endTime: nextEnd, time: nextEnd };
      if (task.repeat !== "none" && !task.sourceTaskId) {
        return updateRecurringSchedule(task, schedule, `${ctx.messages.blockUpdated}: ${nextStart}–${nextEnd}`);
      }

      const undo = ctx.createUndoSnapshot();
      applySchedule(task, schedule);
      clearNotification(task, ctx.getActiveDate());
      task.updatedAt = new Date().toISOString();
      commit(`${ctx.messages.blockUpdated}: ${ctx.formatTaskWindow(task)}`, undo);
      return true;
    }

    async function updateRecurringSchedule(task, schedule, message) {
      const choice = await ctx.confirmAction({
        title: "Изменить расписание повтора?",
        message: `Выбери, применить изменение только к ${ctx.formatLongDate(ctx.getActiveDate())} или к этой дате и всем последующим повторениям. Прошлые дни не изменятся.`,
        secondaryLabel: "Только этот день",
        confirmLabel: "Этот и последующие",
      });
      if (!choice) return false;

      const undo = ctx.createUndoSnapshot();
      const updatedTask = taskMovesApi.updateRecurringTaskSchedule({
        state: ctx.getState(),
        task,
        dateKey: ctx.getActiveDate(),
        schedule,
        scope: choice === "secondary" ? "occurrence" : "following",
        helpers: { createId: ctx.createId },
      });
      if (!updatedTask) return false;
      if (!schedule.time) updatedTask.reminderOffset = "none";
      clearNotification(updatedTask, ctx.getActiveDate());
      commit(message, undo);
      return true;
    }

    function createTaskAtTime(startTime, endTime) {
      ctx.resetTaskForm();
      ctx.openFloatingTaskForm();
      ctx.setTaskScheduleMode("block");
      ctx.els.taskDate.value = ctx.getActiveDate();
      ctx.els.taskStartTime.value = ctx.cleanTimeValue(startTime);
      ctx.els.taskEndTime.value = ctx.cleanTimeValue(endTime);
      ctx.els.taskTime.value = "";
      ctx.els.taskReminder.value = "15";
      ctx.syncTaskScheduleMode();
      ctx.syncTaskTimePresets();
      ctx.els.taskFormPanel.classList.remove("is-collapsed");
      ctx.els.taskTitle.focus();
      return true;
    }

    function commit(message, undo) {
      ctx.saveState();
      ctx.render();
      ctx.showToast(message, { undo });
    }

    return {
      createTaskAtTime,
      clearTaskTime,
      deleteTask,
      duplicateTask,
      moveTaskTime,
      resizeTaskBlockTime,
      setTaskTime,
      shiftTaskTime,
      toggleTaskDone,
      updateTaskTime,
    };
  }

  function clearNotification(task, dateKey) {
    if (task.notified) delete task.notified[dateKey];
  }

  function applySchedule(task, schedule) {
    task.scheduleMode = schedule.scheduleMode;
    task.startTime = schedule.startTime;
    task.endTime = schedule.endTime;
    task.time = schedule.time;
  }

  function cloneTask(task) {
    if (typeof structuredClone === "function") return structuredClone(task);
    return JSON.parse(JSON.stringify(task));
  }

  const api = { createTimelineController };
  global.RhythmTimelineController = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
