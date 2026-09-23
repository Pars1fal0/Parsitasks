(function (global) {
  function createCalendarDragController(ctx) {
    let draggedTaskId = "";
    let draggedTaskDate = "";
    let pointerDragTask = null;
    let suppressClickUntil = 0;

    function bindGlobalEvents() {
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", finishPointerDrag);
      document.addEventListener("pointercancel", cancelPointerDrag);
    }

    function setDraggedTask(taskId, dateKey) {
      draggedTaskId = taskId || "";
      draggedTaskDate = dateKey || "";
    }

    function attachTaskDropZone(element, dateKey) {
      element.addEventListener("dragover", (event) => {
        const transfer = getTransfer(event);
        if (!transfer.taskId || transfer.dateKey === dateKey) return;
        event.preventDefault();
        element.classList.add("is-drop-target");
        event.dataTransfer.dropEffect = "move";
      });
      element.addEventListener("dragleave", (event) => {
        if (!element.contains(event.relatedTarget)) element.classList.remove("is-drop-target");
      });
      element.addEventListener("drop", (event) => {
        event.preventDefault();
        element.classList.remove("is-drop-target");
        const transfer = getTransfer(event);
        if (!transfer.taskId || transfer.dateKey === dateKey) return;
        ctx.moveTaskToDate(transfer.taskId, transfer.dateKey, dateKey);
      });
    }

    function attachTaskChipDrag(chip) {
      chip.tabIndex = 0;
      chip.setAttribute("role", "button");
      chip.setAttribute("aria-keyshortcuts", "Enter Space Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown");
      chip.setAttribute("aria-label", `${chip.textContent.trim()}. Enter редактировать задачу. Alt и стрелки — перенести задачу по календарю.`);
      chip.addEventListener("click", (event) => {
        event.stopPropagation();
        if (Date.now() < suppressClickUntil) return;
        ctx.openDateTasks(chip.dataset.date, chip.dataset.taskId);
      });
      chip.addEventListener("keydown", (event) => handleChipKeydown(event, chip));
      chip.addEventListener("pointerdown", (event) => startPointerDrag(event, chip));
      chip.addEventListener("dragstart", (event) => {
        setDraggedTask(chip.dataset.taskId, chip.dataset.date);
        chip.classList.add("is-dragging");
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", chip.dataset.taskId);
        event.dataTransfer.setData("application/x-rhythm-task", JSON.stringify({ taskId: chip.dataset.taskId, dateKey: chip.dataset.date }));
      });
      chip.addEventListener("dragend", () => {
        suppressClickUntil = Date.now() + 350;
        chip.classList.remove("is-dragging");
        clearTaskDragState();
      });
    }

    function handleChipKeydown(event, chip) {
      event.stopPropagation();
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        ctx.openDateTasks(chip.dataset.date, chip.dataset.taskId);
        return;
      }
      if (!event.altKey) return;
      const offset = { ArrowDown: 7, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7 }[event.key];
      if (!offset || !chip.dataset.taskId || !chip.dataset.date) return;
      event.preventDefault();
      ctx.moveTaskToDate(chip.dataset.taskId, chip.dataset.date, ctx.addDays(chip.dataset.date, offset));
    }

    function getTransfer(event) {
      try {
        const raw = event.dataTransfer?.getData("application/x-rhythm-task");
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            taskId: String(parsed.taskId || ""),
            dateKey: ctx.normalizeDateKey(parsed.dateKey || draggedTaskDate || ctx.getActiveDate(), ""),
          };
        }
      } catch {
        // Fall through to the plain text drag payload.
      }
      return {
        taskId: event.dataTransfer?.getData("text/plain") || draggedTaskId || "",
        dateKey: ctx.normalizeDateKey(draggedTaskDate || ctx.getActiveDate(), ""),
      };
    }

    function clearTaskDragState() {
      draggedTaskId = "";
      draggedTaskDate = "";
      document.querySelectorAll(".task-item.is-drop-target, .calendar-drop-zone.is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
    }

    function startPointerDrag(event, chip) {
      if (event.button !== 0 || !chip.dataset.taskId || !chip.dataset.date) return;
      const isTouch = event.pointerType === "touch";
      pointerDragTask = {
        taskId: chip.dataset.taskId,
        dateKey: chip.dataset.date,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
        activated: !isTouch,
        longPressTimer: null,
        chip,
      };
      if (isTouch) {
        pointerDragTask.longPressTimer = global.setTimeout(() => {
          if (!pointerDragTask || pointerDragTask.chip !== chip) return;
          pointerDragTask.activated = true;
          global.navigator?.vibrate?.(12);
        }, 320);
      }
    }

    function handlePointerMove(event) {
      if (!pointerDragTask) return;
      const distance = Math.hypot(event.clientX - pointerDragTask.startX, event.clientY - pointerDragTask.startY);
      if (!pointerDragTask.activated) {
        if (distance > 8) {
          global.clearTimeout(pointerDragTask.longPressTimer);
          pointerDragTask = null;
        }
        return;
      }
      if (!pointerDragTask.dragging && distance < 8) return;
      event.preventDefault();
      pointerDragTask.dragging = true;
      pointerDragTask.chip.classList.add("is-dragging");
      document.querySelectorAll(".calendar-drop-zone.is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".calendar-drop-zone");
      if (target?.dataset.date && target.dataset.date !== pointerDragTask.dateKey) target.classList.add("is-drop-target");
    }

    function finishPointerDrag(event) {
      if (!pointerDragTask) return;
      const drag = pointerDragTask;
      if (drag.dragging) suppressClickUntil = Date.now() + 350;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".calendar-drop-zone");
      cancelPointerDrag();
      if (!drag.dragging || !target?.dataset.date || target.dataset.date === drag.dateKey) return;
      ctx.moveTaskToDate(drag.taskId, drag.dateKey, target.dataset.date);
    }

    function cancelPointerDrag() {
      global.clearTimeout(pointerDragTask?.longPressTimer);
      pointerDragTask?.chip?.classList.remove("is-dragging");
      pointerDragTask = null;
      document.querySelectorAll(".calendar-drop-zone.is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
    }

    return { attachTaskChipDrag, attachTaskDropZone, bindGlobalEvents, clearTaskDragState, setDraggedTask };
  }

  global.RhythmCalendarDragController = { createCalendarDragController };
  if (typeof module !== "undefined" && module.exports) module.exports = { createCalendarDragController };
})(typeof window !== "undefined" ? window : globalThis);
