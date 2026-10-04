(function (global) {
  function createHabitForm(ctx) {
    const saveError = ctx.els.habitForm.querySelector(".form-save-error");
    function saveHabitFromForm(event) {
      event.preventDefault();
      const title = ctx.cleanText(ctx.els.habitTitle.value);
      if (!title) {
        ctx.showToast("Укажи название привычки");
        ctx.els.habitTitle.focus();
        return false;
      }
      const undo = ctx.createUndoSnapshot();
      const id = ctx.els.habitId.value || ctx.createId();
      const existing = ctx.findHabit(id);
      const type = ctx.els.habitType.value;
      const now = new Date().toISOString();
      let habit = {
        id,
        title: existing?.title || title,
        titleHistory: existing?.titleHistory || [],
        type,
        repeat: ctx.normalizeHabitRepeat(ctx.els.habitRepeat.value),
        weeklyTarget: Number(ctx.els.habitForm.querySelector("#habitWeeklyTarget").value) || 3,
        reminderTime: ctx.cleanTimeValue(ctx.els.habitForm.querySelector("#habitReminderTime").value),
        notified: { ...(existing?.notified || {}) },
        customRepeat: ctx.els.habitRepeat.value === "custom" ? ctx.getHabitCustomRepeatFromForm() : {},
        startDate: existing?.startDate || ctx.getActiveDate(),
        unit: ctx.cleanText(ctx.els.habitUnit.value),
        goal: type === "number" ? Math.max(1, Number(ctx.els.habitGoal.value || 1)) : 1,
        numberStep: Number(ctx.els.habitForm.querySelector("#habitNumberStep").value) || 0,
        logs: existing?.logs || {},
        freezeDays: existing?.freezeDays || {},
        availabilityHistory: existing?.availabilityHistory || [],
        configHistory: existing?.configHistory || [],
        archived: existing?.archived === true,
        archivedAt: existing?.archivedAt || "",
        archivedFromDate: existing?.archivedFromDate || "",
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      habit = ctx.applyHabitConfigChange
        ? ctx.applyHabitConfigChange(
            habit,
            {
              type,
              repeat: ctx.normalizeHabitRepeat(ctx.els.habitRepeat.value),
              weeklyTarget: habit.weeklyTarget,
              customRepeat: ctx.els.habitRepeat.value === "custom" ? ctx.getHabitCustomRepeatFromForm() : {},
              unit: ctx.cleanText(ctx.els.habitUnit.value),
              goal: type === "number" ? Math.max(1, Number(ctx.els.habitGoal.value || 1)) : 1,
              numberStep: habit.numberStep,
            },
            ctx.getActiveDate(),
            { normalizeCustomRepeat: ctx.normalizeCustomRepeat, normalizeRepeat: ctx.normalizeHabitRepeat, updatedAt: now },
          )
        : habit;
      habit = ctx.applyHabitTitleChange
        ? ctx.applyHabitTitleChange(habit, title, ctx.getActiveDate(), { cleanText: ctx.cleanText, updatedAt: now })
        : { ...habit, title };

      if (existing && existing.reminderTime !== habit.reminderTime) habit.notified = {};
      ctx.upsertHabit(habit);
      if (ctx.saveState() === false) {
        ctx.restoreState(undo);
        ctx.render();
        if (saveError) saveError.textContent = "Не удалось сохранить. Введённые данные оставлены — попробуйте ещё раз.";
        return false;
      }
      resetHabitForm({ open: false });
      ctx.render();
      ctx.showToast(existing ? "Привычка обновлена" : "Привычка создана", { undo });
    }

    function fillHabitForm(habit) {
      if (saveError) saveError.textContent = "";
      const effectiveConfig = ctx.habitConfigOnDate?.(habit, ctx.getActiveDate()) || habit;
      ctx.els.habitFormPanel.classList.remove("is-collapsed");
      if (ctx.els.habitFormHeading) ctx.els.habitFormHeading.textContent = "Редактировать привычку";
      ctx.els.habitForm.querySelector('button[type="submit"]').textContent = "Сохранить";
      if (ctx.els.resetHabitForm) ctx.els.resetHabitForm.textContent = "Отмена";
      ctx.els.habitId.value = habit.id;
      ctx.els.habitTitle.value = ctx.habitTitleOnDate?.(habit, ctx.getActiveDate()) || habit.title;
      ctx.els.habitType.value = effectiveConfig.type;
      ctx.syncHabitTypeFields();
      ctx.els.habitRepeat.value = ctx.normalizeHabitRepeat(effectiveConfig.repeat);
      ctx.els.habitForm.querySelector("#habitWeeklyTarget").value = effectiveConfig.weeklyTarget || 3;
      ctx.els.habitForm.querySelector("#habitReminderTime").value = habit.reminderTime || "";
      ctx.els.habitForm.querySelector("#habitExtraFields").open = Boolean(habit.reminderTime);
      ctx.setHabitCustomRepeatForm(effectiveConfig.customRepeat);
      ctx.syncHabitCustomRepeatPanel();
      ctx.els.habitUnit.value = effectiveConfig.unit || "";
      ctx.els.habitGoal.value = effectiveConfig.goal || "";
      ctx.els.habitForm.querySelector("#habitNumberStep").value = effectiveConfig.numberStep || "";
      ctx.markFormPristine?.(ctx.els.habitForm);
      ctx.els.habitTitle.focus();
    }

    function resetHabitForm(options = {}) {
      if (saveError) saveError.textContent = "";
      ctx.els.habitFormPanel.classList.toggle("is-collapsed", options.open === false);
      if (ctx.els.habitFormHeading) ctx.els.habitFormHeading.textContent = "Новая привычка";
      ctx.els.habitForm.querySelector('button[type="submit"]').textContent = "Создать";
      ctx.els.habitForm.querySelector("#habitExtraFields").open = false;
      if (ctx.els.resetHabitForm) ctx.els.resetHabitForm.textContent = "Очистить";
      ctx.els.habitForm.reset();
      ctx.els.habitId.value = "";
      ctx.els.habitType.value = "check";
      ctx.syncHabitTypeFields();
      ctx.els.habitRepeat.value = "daily";
      ctx.setHabitCustomRepeatForm();
      ctx.syncHabitCustomRepeatPanel();
      ctx.markFormPristine?.(ctx.els.habitForm);
    }

    return { fillHabitForm, resetHabitForm, saveHabitFromForm };
  }

  const api = { createHabitForm };
  global.RhythmHabitForm = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
