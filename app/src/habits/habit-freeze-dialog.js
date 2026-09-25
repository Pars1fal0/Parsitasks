(function (global) {
  function createHabitFreezeDialog(ctx) {
    const dialog = ctx.els.habitFreezeDialog;
    const form = ctx.els.habitFreezeForm;
    const list = ctx.els.habitFreezeList;
    const start = ctx.els.habitFreezeStart;
    const end = ctx.els.habitFreezeEnd;
    const reason = ctx.els.habitFreezeReason;
    const customReason = ctx.els.habitFreezeCustomReason;
    const modeInputs = [...form.querySelectorAll('input[name="habitFreezeMode"]')];
    const endField = ctx.els.habitFreezeEndField;
    const message = ctx.els.habitFreezeMessage;
    let operation = "freeze";

    function open(habitId = "", nextOperation = "freeze") {
      operation = nextOperation;
      form.reset();
      start.value = ctx.getActiveDate();
      end.value = start.value;
      message.textContent = "";
      ctx.els.habitFreezeHeading.textContent = operation === "unfreeze" ? "Снять заморозку" : "Заморозить привычки";
      ctx.els.habitFreezeSubmit.textContent = operation === "unfreeze" ? "Снять заморозку" : "Заморозить";
      ctx.els.habitFreezeReasonField.hidden = operation === "unfreeze";
      ctx.els.habitFreezeCustomReasonField.hidden = true;
      list.replaceChildren();
      ctx.getState().habits.forEach((habit) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        const title = document.createElement("span");
        label.className = "habit-freeze-choice";
        input.type = "checkbox";
        input.value = habit.id;
        input.checked = habit.id === habitId;
        title.textContent = ctx.habitTitleOnDate(habit, start.value) || habit.title;
        label.append(input, title);
        list.appendChild(label);
      });
      if (habitId && operation === "freeze") {
        const savedReason = ctx.getState().habits.find((habit) => habit.id === habitId)?.freezeDays?.[start.value]?.reason || "";
        if (["", "Болезнь", "Поездка", "Личные обстоятельства"].includes(savedReason)) reason.value = savedReason;
        else { reason.value = "custom"; customReason.value = savedReason; }
      }
      updateReason();
      updateMode();
      updateCurrentReason();
      dialog.showModal();
      if (!habitId) list.querySelector("input")?.focus();
    }

    function updateMode() {
      endField.hidden = modeInputs.find((input) => input.checked)?.value !== "period";
      ctx.els.habitFreezeStartLabel.textContent = endField.hidden ? "Дата" : "С";
      end.required = !endField.hidden;
      if (end.value < start.value) end.value = start.value;
      end.min = start.value;
    }

    function updateTitles() {
      list.querySelectorAll(".habit-freeze-choice").forEach((label) => {
        const habit = ctx.getState().habits.find((item) => item.id === label.querySelector("input")?.value);
        if (habit) label.querySelector("span").textContent = ctx.habitTitleOnDate(habit, start.value) || habit.title;
      });
    }

    function updateCurrentReason() {
      const selectedId = list.querySelector("input:checked")?.value;
      const savedReason = ctx.getState().habits.find((habit) => habit.id === selectedId)?.freezeDays?.[start.value]?.reason;
      const visible = operation === "unfreeze" && Boolean(savedReason);
      ctx.els.habitFreezeCurrentReason.hidden = !visible;
      ctx.els.habitFreezeCurrentReason.textContent = visible ? `Причина: ${savedReason}` : "";
    }

    function updateReason() {
      ctx.els.habitFreezeCustomReasonField.hidden = operation === "unfreeze" || reason.value !== "custom";
      customReason.required = !ctx.els.habitFreezeCustomReasonField.hidden;
    }

    modeInputs.forEach((input) => input.addEventListener("change", updateMode));
    reason.addEventListener("change", updateReason);
    start.addEventListener("change", () => { updateMode(); updateTitles(); updateCurrentReason(); });
    list.addEventListener("change", updateCurrentReason);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const selected = [...list.querySelectorAll("input:checked")].map((input) => input.value);
      if (!selected.length) {
        message.textContent = "Выберите хотя бы одну привычку";
        return;
      }
      let dates;
      try {
        dates = global.RhythmHabitFreeze.datesBetween(start.value, endField.hidden ? start.value : end.value);
      } catch (error) {
        message.textContent = error.message;
        return;
      }
      const changes = [];
      const chosenReason = reason.value === "custom" ? customReason.value.trim() : reason.value;
      let skippedCompleted = 0;
      selected.forEach((id) => {
        const habit = ctx.getState().habits.find((item) => item.id === id);
        if (!habit) return;
        dates.forEach((dateKey) => {
          if (dateKey < habit.startDate) return;
          const status = ctx.habitStatusOnDate(habit, dateKey);
          if (status === "not-due") return;
          if (operation === "freeze") {
            if (status === "complete") { skippedCompleted += 1; return; }
            if (status === "frozen" && (habit.freezeDays[dateKey].reason || "") === chosenReason) return;
          } else if (status !== "frozen") return;
          changes.push({ habit, dateKey });
        });
      });
      if (!changes.length) {
        message.textContent = operation === "freeze" ? "Для выбранных дат новых заморозок нет" : "В выбранные даты нет заморозок";
        return;
      }
      const undo = ctx.createUndoSnapshot();
      const now = new Date().toISOString();
      changes.forEach(({ habit, dateKey }) => global.RhythmHabitFreeze.setFrozen(habit, dateKey, operation === "freeze", chosenReason, now));
      ctx.saveState();
      ctx.render();
      dialog.close();
      const action = operation === "freeze" ? "Заморожено" : "Разморожено";
      ctx.showToast(`${action}: ${changes.length}${skippedCompleted ? ` · выполненные дни пропущены: ${skippedCompleted}` : ""}`, { undo });
    });
    ctx.els.habitFreezeCancel.addEventListener("click", () => dialog.close());

    return { open };
  }

  const api = { createHabitFreezeDialog };
  global.RhythmHabitFreezeDialog = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
