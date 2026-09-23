(function (global) {
  function createHabitsView(ctx) {
    let draggedHabitId = "";

    function renderHabits() {
      const activeDate = ctx.getActiveDate();
      const habits = ctx.habitsForDate(activeDate);
      ctx.els.habitList.replaceChildren();
      habits.forEach((habit) => ctx.els.habitList.appendChild(createHabitNode(habit)));
      ctx.els.habitEmpty.textContent = ctx.getState().habits.length
        ? "На выбранный день привычек по расписанию нет."
        : "Добавь первую привычку.";
      ctx.els.habitEmpty.classList.toggle("is-visible", habits.length === 0);
      renderHabitArchive();
    }

    function createHabitNode(habit) {
      const activeDate = ctx.getActiveDate();
      const node = ctx.els.habitTemplate.content.firstElementChild.cloneNode(true);
      const title = node.querySelector("h3");
      const streak = node.querySelector(".habit-streak");
      const control = node.querySelector(".habit-control");
      const habitTitle = ctx.habitTitleOnDate?.(habit, activeDate) || habit.title;
      const habitConfig = ctx.habitConfigOnDate?.(habit, activeDate) || habit;

      node.draggable = true;
      node.dataset.habitId = habit.id;
      node.setAttribute("aria-grabbed", "false");
      node.querySelector(".habit-drag-handle")?.setAttribute("title", "Перетащить привычку");
      title.textContent = habitTitle;
      streak.textContent = habitSubtitle(habit);
      attachHabitDrag(node, habit);
      const dragHandle = node.querySelector(".habit-drag-handle");
      dragHandle?.setAttribute("title", "Перетащить привычку или переместить стрелками");
      dragHandle?.setAttribute("aria-label", `Переместить привычку ${habitTitle}. Стрелки вверх и вниз меняют порядок`);
      attachHabitAccessibleMove(node, habit, dragHandle, habitTitle);

      if (habitConfig.type === "number") {
        const current = Number(habit.logs[activeDate] || 0);
        const goal = Number(habitConfig.goal || 1);
        const percent = Math.min(100, Math.round((current / goal) * 100));

        const row = document.createElement("div");
        const decrement = document.createElement("button");
        const input = document.createElement("input");
        const increment = document.createElement("button");
        const value = document.createElement("span");
        const track = document.createElement("div");
        const fill = document.createElement("div");

        row.className = "habit-number-row";
        decrement.type = "button";
        decrement.className = "habit-stepper";
        decrement.textContent = "-";
        decrement.setAttribute("aria-label", `Уменьшить ${habitTitle}`);
        input.type = "number";
        input.min = "0";
        const step = habitNumberStep(habitConfig);
        input.step = "any";
        input.value = String(current);
        input.setAttribute("aria-label", habitTitle);
        increment.type = "button";
        increment.className = "habit-stepper";
        increment.textContent = "+";
        increment.setAttribute("aria-label", `Увеличить ${habitTitle}`);
        value.textContent = `${current} / ${goal} ${habitConfig.unit || ""}`;
        track.className = "progress-track";
        track.setAttribute("aria-hidden", "true");
        fill.className = "progress-fill";
        fill.style.width = `${percent}%`;
        track.appendChild(fill);
        row.append(decrement, input, increment, value);
        control.replaceChildren(row, track);

        const updateValue = (nextRawValue) => {
          const parsedValue = Number(nextRawValue || 0);
          if (!Number.isFinite(parsedValue)) return;
          const nextValue = Math.max(0, Math.round(parsedValue * 1000) / 1000);
          if (nextValue === Number(habit.logs[activeDate] || 0)) {
            input.value = String(nextValue);
            return;
          }
          const undo = ctx.createUndoSnapshot();
          if (nextValue > 0) {
            habit.logs[activeDate] = nextValue;
          } else {
            delete habit.logs[activeDate];
          }
          habit.updatedAt = new Date().toISOString();
          ctx.saveState();
          ctx.renderDailyPulse();
          ctx.renderOverviewIfActive?.();
          node.querySelector(".habit-streak").textContent = habitSubtitle(habit);
          const loggedValue = Number(habit.logs[activeDate] || 0);
          const nextPercent = Math.min(100, Math.round((loggedValue / goal) * 100));
          fill.style.width = `${nextPercent}%`;
          value.textContent = `${loggedValue} / ${goal} ${habitConfig.unit || ""}`;
          input.value = String(loggedValue);
          ctx.showToast(`${habitTitle}: ${loggedValue} ${habitConfig.unit || ""}`.trim(), { undo });
        };

        input.addEventListener("change", (event) => {
          if (input.validity.badInput) return;
          updateValue(event.target.value);
        });
        decrement.addEventListener("click", () => updateValue(Number(input.value || 0) - step));
        increment.addEventListener("click", () => updateValue(Number(input.value || 0) + step));
        const quickAdds = document.createElement("div");
        quickAdds.className = "habit-quick-adds";
        quickAdds.setAttribute("role", "group");
        quickAdds.setAttribute("aria-label", `Быстрые отметки: ${habitTitle}`);
        const unit = (habitConfig.unit || "").trim().toLocaleLowerCase("ru-RU");
        const amounts = ["мл", "ml"].includes(unit) ? [250, 500]
          : ["л", "l"].includes(unit) ? [0.25, 0.5]
          : ["мин", "мин.", "минут"].includes(unit) ? [5, 15]
          : [...new Set([step, Math.min(goal, step * 5)])].filter((amount) => amount > 0);
        amounts.forEach((amount) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ghost-button compact-button";
          button.textContent = `+${amount.toLocaleString("ru-RU")} ${habitConfig.unit || ""}`.trim();
          button.addEventListener("click", () => updateValue(Number(habit.logs[activeDate] || 0) + amount));
          quickAdds.appendChild(button);
        });
        control.appendChild(quickAdds);
      } else {
        const done = habit.logs[activeDate] === true;
        const row = document.createElement("div");
        row.className = "habit-check-row";

        const button = document.createElement("button");
        button.type = "button";
        button.className = `check-button${done ? " is-checked" : ""}`;
        button.setAttribute("aria-label", `Отметить ${habitTitle}`);

        const label = document.createElement("span");
        label.textContent = done ? "Выполнено" : "Не отмечено";

        button.addEventListener("click", () => {
          const undo = ctx.createUndoSnapshot();
          habit.logs[activeDate] = !done;
          habit.updatedAt = new Date().toISOString();
          ctx.saveState();
          ctx.render();
          ctx.showToast(done ? "Отметка снята" : "Привычка отмечена", { undo });
        });

        row.append(button, label);
        control.append(row);
      }

      node.querySelector(".edit-habit").addEventListener("click", () => ctx.fillHabitForm(habit));
      node.querySelector(".archive-habit")?.addEventListener("click", () => {
        const undo = ctx.createUndoSnapshot();
        Object.assign(habit, ctx.applyHabitAvailabilityChange(habit, false, activeDate));
        ctx.saveState();
        ctx.render();
        ctx.showToast("Привычка приостановлена", { undo });
      });
      node.querySelector(".delete-habit").addEventListener("click", async () => {
        const confirmed = await ctx.confirmAction({
          confirmLabel: "Удалить",
          message: `Удалить привычку «${habitTitle}» вместе со всей историей отметок?`,
          tone: "danger",
          title: "Удалить привычку?",
        });
        if (!confirmed) return;
        const undo = ctx.createUndoSnapshot();
        ctx.deleteHabit(habit.id);
        ctx.saveState();
        ctx.render();
        ctx.showToast("Привычка удалена", { undo });
      });
      node.querySelectorAll(".habit-more-menu button").forEach((button) => {
        button.addEventListener("click", () => button.closest("details")?.removeAttribute("open"));
      });

      return node;
    }

    function renderHabitArchive() {
      if (!ctx.els.habitArchivePanel) return;
      const archived = ctx.getState().habits.filter((habit) => habit.archived === true);
      ctx.els.habitArchivePanel.hidden = archived.length === 0;
      ctx.els.habitArchiveCount.textContent = String(archived.length);
      ctx.els.habitArchiveList.replaceChildren();
      archived.forEach((habit) => {
        const row = document.createElement("article");
        const title = document.createElement("strong");
        const actions = document.createElement("div");
        const restore = createArchiveButton("Вернуть");
        const remove = createArchiveButton("Удалить", true);
        row.className = "habit-archive-item";
        title.textContent = habit.title;
        restore.addEventListener("click", () => {
          const undo = ctx.createUndoSnapshot();
          Object.assign(habit, ctx.applyHabitAvailabilityChange(habit, true, ctx.getActiveDate()));
          ctx.saveState();
          ctx.render();
          ctx.showToast("Привычка снова активна", { undo });
        });
        remove.addEventListener("click", async () => {
          const confirmed = await ctx.confirmAction({
            confirmLabel: "Удалить",
            message: `Удалить привычку «${habit.title}» вместе со всей историей отметок?`,
            tone: "danger",
            title: "Удалить привычку навсегда?",
          });
          if (!confirmed) return;
          const undo = ctx.createUndoSnapshot();
          ctx.deleteHabit(habit.id);
          ctx.saveState();
          ctx.render();
          ctx.showToast("Привычка удалена", { undo });
        });
        actions.append(restore, remove);
        row.append(title, actions);
        ctx.els.habitArchiveList.appendChild(row);
      });
    }

    function createArchiveButton(label, danger = false) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `ghost-button compact-button${danger ? " danger-button" : ""}`;
      button.textContent = label;
      return button;
    }

    function attachHabitDrag(node, habit) {
      node.addEventListener("dragstart", (event) => {
        const isHandleDrag = Boolean(event.target.closest(".habit-drag-handle"));
        if (!isHandleDrag && event.target.closest("input, button, textarea, select")) {
          event.preventDefault();
          return;
        }
        draggedHabitId = habit.id;
        node.classList.add("is-dragging");
        node.setAttribute("aria-grabbed", "true");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", habit.id);
        event.dataTransfer.setData("application/x-rhythm-habit", habit.id);
      });
      node.addEventListener("dragend", () => {
        draggedHabitId = "";
        node.classList.remove("is-dragging");
        node.setAttribute("aria-grabbed", "false");
        clearHabitDropTargets();
      });
      node.addEventListener("dragover", (event) => {
        const sourceId = readHabitDragId(event);
        if (!sourceId || sourceId === habit.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        node.classList.add("is-drop-target");
      });
      node.addEventListener("dragleave", (event) => {
        if (!node.contains(event.relatedTarget)) node.classList.remove("is-drop-target");
      });
      node.addEventListener("drop", (event) => {
        event.preventDefault();
        const sourceId = readHabitDragId(event);
        clearHabitDropTargets();
        if (!sourceId || sourceId === habit.id) return;
        const undo = ctx.createUndoSnapshot();
        ctx.reorderHabit(sourceId, habit.id);
        ctx.saveState();
        ctx.render();
        ctx.showToast("Порядок привычек обновлен", { undo });
      });
    }

    function readHabitDragId(event) {
      return event.dataTransfer?.getData("application/x-rhythm-habit") || event.dataTransfer?.getData("text/plain") || draggedHabitId;
    }

    function attachHabitAccessibleMove(node, habit, handle, habitTitle = habit.title) {
      if (!handle) return;
      handle.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        const items = [...ctx.els.habitList.querySelectorAll(".habit-item")];
        const index = items.indexOf(node);
        const target = items[index + (event.key === "ArrowUp" ? -1 : 1)];
        if (!target?.dataset.habitId) return;
        event.preventDefault();
        commitHabitReorder(habit.id, target.dataset.habitId, habitTitle);
      });

      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        const startY = event.clientY;
        let targetId = "";
        let moved = false;
        handle.setPointerCapture?.(event.pointerId);
        node.classList.add("is-dragging");
        node.setAttribute("aria-grabbed", "true");

        const onMove = (moveEvent) => {
          moveEvent.preventDefault();
          moved = moved || Math.abs(moveEvent.clientY - startY) > 5;
          if (!moved || typeof document.elementFromPoint !== "function") return;
          const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest?.(".habit-item");
          clearHabitDropTargets();
          if (!target || target === node) {
            targetId = "";
            return;
          }
          targetId = target.dataset.habitId || "";
          target.classList.add("is-drop-target");
        };

        const cleanup = (finishEvent) => {
          handle.releasePointerCapture?.(finishEvent.pointerId);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", cancel);
          node.classList.remove("is-dragging");
          node.setAttribute("aria-grabbed", "false");
          clearHabitDropTargets();
        };
        const finish = (finishEvent) => {
          cleanup(finishEvent);
          if (moved && targetId) commitHabitReorder(habit.id, targetId, habitTitle);
        };
        const cancel = (cancelEvent) => {
          targetId = "";
          cleanup(cancelEvent);
        };

        window.addEventListener("pointermove", onMove, { passive: false });
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", cancel);
      });
    }

    function commitHabitReorder(sourceId, targetId, title = "") {
      if (!sourceId || !targetId || sourceId === targetId) return;
      const undo = ctx.createUndoSnapshot();
      ctx.reorderHabit(sourceId, targetId);
      ctx.saveState();
      ctx.render();
      ctx.showToast(title ? `${title}: порядок обновлен` : "Порядок привычек обновлен", { undo });
    }

    function clearHabitDropTargets() {
      ctx.els.habitList.querySelectorAll(".habit-item.is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
    }

    function habitSubtitle(habit) {
      const effective = ctx.habitConfigOnDate?.(habit, ctx.getActiveDate()) || habit;
      const repeat = ctx.formatHabitRepeat({ ...habit, ...effective });
      return `Серия: ${ctx.habitStreak(habit, ctx.getActiveDate())} дн. · ${repeat}`;
    }

    return {
      createHabitNode,
      habitSubtitle,
      renderHabits,
    };
  }

  function habitNumberStep(habit) {
    const goal = Math.max(1, Number(habit?.goal || 1));
    if (goal <= 20) return 1;
    if (goal <= 100) return 5;
    if (goal <= 1000) return 50;
    return 100;
  }

  const api = { createHabitsView, habitNumberStep };
  global.RhythmHabitsView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
