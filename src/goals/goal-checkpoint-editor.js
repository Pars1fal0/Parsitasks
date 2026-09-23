(function (global) {
  function createGoalCheckpointEditor(ctx) {
    let steps = [];
    let draggedId = "";

    function setSteps(value = []) {
      steps = value.map((step) => ({ id: step.id || ctx.createId(), title: clean(step.title), done: step.done === true })).filter((step) => step.title);
      ctx.els.goalCheckpointInput.value = "";
      render();
    }

    function getSteps() {
      commitPending(false);
      return steps.map((step) => ({ ...step }));
    }

    function focus() {
      ctx.els.goalCheckpointInput.focus();
    }

    function addFromInput() {
      return commitPending(true);
    }

    function commitPending(shouldFocus) {
      const title = clean(ctx.els.goalCheckpointInput.value);
      if (!title) {
        if (shouldFocus) focus();
        return false;
      }
      const step = { id: ctx.createId(), title, done: false };
      steps.push(step);
      ctx.els.goalCheckpointInput.value = "";
      render();
      if (shouldFocus) focus();
      return true;
    }

    function removeStep(stepId) {
      steps = steps.filter((step) => step.id !== stepId);
      render();
      focus();
    }

    function renameStep(stepId, value) {
      const step = steps.find((item) => item.id === stepId);
      if (step) step.title = clean(value);
    }

    function reorderStep(sourceId, targetId) {
      const next = moveCheckpoint(steps, sourceId, targetId);
      if (next === steps) return false;
      steps = next;
      render();
      return true;
    }

    function moveStepBy(stepId, offset) {
      const index = steps.findIndex((step) => step.id === stepId);
      const target = steps[index + offset];
      if (index < 0 || !target) return false;
      return reorderStep(stepId, target.id);
    }

    function render() {
      ctx.els.goalCheckpointList.replaceChildren();
      steps.forEach((step, index) => ctx.els.goalCheckpointList.appendChild(createRow(step, index)));
      ctx.els.goalCheckpointEmpty.hidden = steps.length > 0;
      ctx.els.goalCheckpointList.setAttribute("aria-label", steps.length ? `Чекпоинты: ${steps.length}` : "Чекпоинты не добавлены");
    }

    function createRow(step, index) {
      const row = document.createElement("div");
      const grip = document.createElement("button");
      const input = document.createElement("input");
      const remove = document.createElement("button");
      row.className = "goal-checkpoint-row";
      row.dataset.stepId = step.id;

      grip.className = "goal-checkpoint-grip";
      grip.type = "button";
      grip.draggable = true;
      grip.title = "Перетащить или переместить стрелками";
      grip.setAttribute("aria-label", `Изменить порядок чекпоинта ${step.title}`);
      grip.appendChild(createIcon("grip"));
      grip.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        if (moveStepBy(step.id, event.key === "ArrowUp" ? -1 : 1)) {
          ctx.els.goalCheckpointList.querySelector(`[data-step-id="${step.id}"] .goal-checkpoint-grip`)?.focus();
        }
      });
      grip.addEventListener("pointerdown", (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        const startY = event.clientY;
        let targetId = "";
        let moved = false;
        grip.setPointerCapture?.(event.pointerId);
        row.classList.add("is-dragging");
        const onMove = (moveEvent) => {
          moveEvent.preventDefault();
          moved = moved || Math.abs(moveEvent.clientY - startY) > 5;
          if (!moved || typeof document.elementFromPoint !== "function") return;
          const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest?.(".goal-checkpoint-row");
          ctx.els.goalCheckpointList.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
          targetId = target && target !== row ? target.dataset.stepId || "" : "";
          if (targetId) target.classList.add("is-drop-target");
        };
        const cleanup = (finishEvent) => {
          grip.releasePointerCapture?.(finishEvent.pointerId);
          global.removeEventListener("pointermove", onMove);
          global.removeEventListener("pointerup", finish);
          global.removeEventListener("pointercancel", cancel);
          row.classList.remove("is-dragging");
          ctx.els.goalCheckpointList.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
        };
        const finish = (finishEvent) => {
          cleanup(finishEvent);
          if (moved && targetId) reorderStep(step.id, targetId);
        };
        const cancel = (cancelEvent) => cleanup(cancelEvent);
        global.addEventListener("pointermove", onMove, { passive: false });
        global.addEventListener("pointerup", finish);
        global.addEventListener("pointercancel", cancel);
      });

      input.type = "text";
      input.maxLength = 120;
      input.value = step.title;
      input.setAttribute("aria-label", `Чекпоинт ${index + 1}`);
      input.addEventListener("input", () => renameStep(step.id, input.value));
      input.addEventListener("blur", () => {
        if (clean(input.value)) return;
        removeStep(step.id);
      });

      remove.className = "icon-button subtle goal-checkpoint-remove";
      remove.type = "button";
      remove.title = "Удалить чекпоинт";
      remove.setAttribute("aria-label", `Удалить чекпоинт ${step.title}`);
      remove.appendChild(createIcon("trash"));
      remove.addEventListener("click", () => removeStep(step.id));

      row.addEventListener("dragstart", (event) => {
        draggedId = step.id;
        row.classList.add("is-dragging");
        event.dataTransfer?.setData("text/plain", step.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragover", (event) => {
        if (!draggedId || draggedId === step.id) return;
        event.preventDefault();
        row.classList.add("is-drop-target");
      });
      row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        row.classList.remove("is-drop-target");
        reorderStep(draggedId || event.dataTransfer?.getData("text/plain"), step.id);
      });
      row.addEventListener("dragend", () => {
        draggedId = "";
        row.classList.remove("is-dragging");
        ctx.els.goalCheckpointList.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
      });

      row.append(grip, input, remove);
      return row;
    }

    ctx.els.addGoalCheckpoint.addEventListener("click", addFromInput);
    ctx.els.goalCheckpointInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addFromInput();
    });
    setSteps();

    return { addFromInput, focus, getSteps, setSteps };
  }

  function moveCheckpoint(steps, sourceId, targetId) {
    const from = steps.findIndex((step) => step.id === sourceId);
    const to = steps.findIndex((step) => step.id === targetId);
    if (from < 0 || to < 0 || from === to) return steps;
    const next = steps.map((step) => ({ ...step }));
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  }

  function clean(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function createIcon(name) {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    icon.classList.add("ui-icon");
    use.setAttribute("href", `#icon-${name}`);
    icon.appendChild(use);
    return icon;
  }

  const api = { createGoalCheckpointEditor, moveCheckpoint };
  global.RhythmGoalCheckpointEditor = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
