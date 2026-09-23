(function (global) {
  function createTaskForm(ctx) {
    let editingOccurrenceDate = "";

    function saveTaskFromForm(event) {
      event.preventDefault();
      const undo = ctx.createUndoSnapshot();
      const id = ctx.els.taskId.value || ctx.createId();
      const existing = ctx.findTask(id);
      const scheduleMode = ctx.getTaskScheduleMode();
      const startTime = scheduleMode === "block" ? ctx.cleanTimeValue(ctx.els.taskStartTime.value) : "";
      const endTime = scheduleMode === "block" ? ctx.cleanTimeValue(ctx.els.taskEndTime.value) : "";
      const deadlineTime = ctx.cleanTimeValue(ctx.els.taskTime.value);
      const repeatUntil = ctx.els.taskRepeat.value === "none" ? "" : ctx.normalizeDateKey(ctx.els.taskRepeatUntil.value, "");
      if (scheduleMode === "block" && !ctx.isValidTimeBlock(startTime, endTime)) {
        ctx.showToast("Укажи корректный временной блок");
        return;
      }
      if (scheduleMode === "deadline" && !deadlineTime) {
        ctx.showToast("Укажи время дедлайна или выбери режим «Без времени»");
        ctx.els.taskTime.focus();
        return;
      }
      if (repeatUntil && repeatUntil < (ctx.els.taskDate.value || ctx.getActiveDate())) {
        ctx.showToast("Дата окончания повтора не может быть раньше начала");
        ctx.els.taskRepeatUntil.focus();
        return;
      }
      const task = {
        id,
        title: ctx.cleanText(ctx.els.taskTitle.value),
        date: ctx.els.taskDate.value || ctx.getActiveDate(),
        scheduleMode,
        startTime,
        endTime,
        time: scheduleMode === "block" ? endTime : scheduleMode === "none" ? "" : deadlineTime,
        categoryId: ctx.els.taskCategoryId.value,
        priority: ctx.els.taskPriority.value,
        repeat: ctx.els.taskRepeat.value,
        repeatUntil,
        customRepeat: ctx.els.taskRepeat.value === "custom" ? ctx.getCustomRepeatFromForm() : {},
        reminderOffset: scheduleMode === "none" ? "none" : ctx.els.taskReminder.value,
        completed: existing?.completed || {},
        acknowledgedOverdue: existing?.acknowledgedOverdue || {},
        excludedDates: existing?.excludedDates || {},
        notified: { ...(existing?.notified || {}) },
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const isRecurringEdit = Boolean(existing && existing.repeat !== "none" && !existing.sourceTaskId);
      const repeatEditScope = getRepeatEditScope();
      const notificationChanged = Boolean(existing && notificationScheduleChanged(existing, task));
      const savedTask = isRecurringEdit
        ? ctx.updateRecurringTask(existing, task, editingOccurrenceDate || ctx.getActiveDate(), repeatEditScope)
        : (ctx.upsertTask(task), task);
      if (notificationChanged) {
        clearStaleNotificationFlags(savedTask, {
          currentDate: editingOccurrenceDate || task.date,
          previousDate: existing.date,
          scope: isRecurringEdit ? repeatEditScope : "occurrence",
        });
      }
      ctx.setActiveDate(isRecurringEdit ? editingOccurrenceDate || ctx.getActiveDate() : savedTask.date);
      resetTaskForm({ open: false });
      ctx.saveState();
      ctx.render();
      ctx.showToast(existing ? "Задача обновлена" : "Задача создана", { undo });
      ctx.afterSave?.(savedTask, existing);
    }

    function fillTaskForm(task) {
      resetInlineCategory();
      ctx.els.taskFormPanel.classList.remove("is-collapsed");
      if (ctx.els.taskFormHeading) ctx.els.taskFormHeading.textContent = "Редактировать задачу";
      if (ctx.els.resetTaskForm) ctx.els.resetTaskForm.textContent = "Отмена";
      ctx.els.taskId.value = task.id;
      ctx.els.taskTitle.value = task.title;
      const isRecurringSeries = task.repeat !== "none" && !task.sourceTaskId;
      editingOccurrenceDate = isRecurringSeries ? ctx.getActiveDate() : task.date;
      ctx.els.taskDate.value = editingOccurrenceDate;
      ctx.els.taskDate.disabled = isRecurringSeries;
      ctx.els.taskTime.value = ctx.cleanTimeValue(task.time);
      ctx.setTaskScheduleMode(ctx.isTimeBlock(task) ? "block" : ctx.cleanTimeValue(task.time) ? "deadline" : "none");
      ctx.els.taskStartTime.value = ctx.cleanTimeValue(task.startTime);
      ctx.els.taskEndTime.value = ctx.cleanTimeValue(task.endTime);
      ctx.els.taskCategoryId.value = task.categoryId || "";
      ctx.els.taskPriority.value = task.priority || "medium";
      ctx.els.taskRepeat.value = task.repeat || "none";
      ctx.els.taskRepeatUntil.value = task.repeatUntil || "";
      ctx.setCustomRepeatForm(task.customRepeat);
      ctx.els.taskReminder.value = task.reminderOffset ?? (task.time ? "15" : "none");
      ctx.syncTaskScheduleMode();
      ctx.syncCustomRepeatPanel();
      ctx.syncTaskTimePresets();
      syncRepeatEditScope(isRecurringSeries, editingOccurrenceDate);
      ctx.markFormPristine?.(ctx.els.taskForm);
      ctx.els.taskTitle.focus();
    }

    function resetTaskForm(options = {}) {
      ctx.els.taskFormPanel.classList.toggle("is-collapsed", options.open === false);
      if (ctx.els.taskFormHeading) ctx.els.taskFormHeading.textContent = "Новая задача";
      if (ctx.els.resetTaskForm) ctx.els.resetTaskForm.textContent = "Очистить";
      ctx.els.taskForm.reset();
      resetInlineCategory();
      ctx.els.taskId.value = "";
      editingOccurrenceDate = "";
      ctx.els.taskDate.value = ctx.getActiveDate();
      ctx.els.taskDate.disabled = false;
      ctx.els.taskTime.value = "";
      ctx.setTaskScheduleMode("none");
      ctx.els.taskStartTime.value = "";
      ctx.els.taskEndTime.value = "";
      ctx.els.taskCategoryId.value = ctx.getDefaultCategoryId?.() || "";
      ctx.els.taskPriority.value = "medium";
      ctx.els.taskRepeat.value = "none";
      ctx.els.taskRepeatUntil.value = "";
      ctx.setCustomRepeatForm();
      ctx.syncCustomRepeatPanel();
      ctx.syncTaskScheduleMode();
      ctx.els.taskReminder.value = "none";
      ctx.syncTaskTimePresets();
      syncRepeatEditScope(false);
      ctx.markFormPristine?.(ctx.els.taskForm);
    }

    function resetInlineCategory() {
      const panel = ctx.els.taskForm.querySelector("#taskInlineCategory");
      const name = ctx.els.taskForm.querySelector("#taskInlineCategoryName");
      const color = ctx.els.taskForm.querySelector("#taskInlineCategoryColor");
      if (panel) panel.open = false;
      if (name) {
        name.value = "";
        name.setCustomValidity("");
      }
      if (color) color.value = "#00a78e";
    }

    function getRepeatEditScope() {
      return ctx.els.taskRepeatEditScope?.querySelector('input[name="taskRepeatEditScope"]:checked')?.value || "occurrence";
    }

    function syncRepeatEditScope(visible, dateKey = "") {
      if (!ctx.els.taskRepeatEditScope) return;
      ctx.els.taskRepeatEditScope.hidden = !visible;
      if (!visible) return;
      const occurrenceOption = ctx.els.taskRepeatEditScope.querySelector('input[value="occurrence"]');
      if (occurrenceOption) occurrenceOption.checked = true;
      updateRepeatEditHint("occurrence", dateKey);
    }

    function updateRepeatEditHint(scope = getRepeatEditScope(), dateKey = editingOccurrenceDate) {
      if (!ctx.els.taskRepeatEditHint) return;
      const dateLabel = formatDate(dateKey);
      if (scope === "following") {
        ctx.els.taskRepeatEditHint.textContent = `Новая версия серии начнется ${dateLabel}. Прошлые дни не изменятся.`;
      } else if (scope === "series") {
        ctx.els.taskRepeatEditHint.textContent = "Изменения применятся ко всей серии, включая будущие даты.";
      } else {
        ctx.els.taskRepeatEditHint.textContent = `Изменится только ${dateLabel}. Остальная серия останется прежней.`;
      }
    }

    function formatDate(dateKey) {
      const [year, month, day] = String(dateKey).split("-").map(Number);
      if (!year || !month || !day) return dateKey;
      return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(year, month - 1, day));
    }

    function notificationScheduleChanged(previous, next) {
      return ["date", "scheduleMode", "startTime", "endTime", "time", "reminderOffset"]
        .some((field) => String(previous?.[field] || "") !== String(next?.[field] || ""));
    }

    function clearStaleNotificationFlags(task, options = {}) {
      task.notified ||= {};
      if (options.scope === "series") {
        Object.keys(task.notified).forEach((dateKey) => {
          if (!options.currentDate || dateKey >= options.currentDate) delete task.notified[dateKey];
        });
        return;
      }
      delete task.notified[options.currentDate];
      delete task.notified[options.previousDate];
    }

    ctx.els.taskRepeatEditScope?.addEventListener("change", (event) => {
      if (event.target?.name === "taskRepeatEditScope") updateRepeatEditHint(event.target.value);
    });

    return { fillTaskForm, resetTaskForm, saveTaskFromForm };
  }

  const api = { createTaskForm };
  global.RhythmTaskForm = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
