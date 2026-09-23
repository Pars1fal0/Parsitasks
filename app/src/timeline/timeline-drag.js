(function (global) {
  function createTimelineDrag({ ctx, formatHourMinute, minuteFromPointer, taskDragMime }) {
    let pointerHint = null;
    let unscheduledTarget = null;

    function attachUnscheduledDrag(card, entry) {
      let pointerCandidate = false;
      card.draggable = true;
      card.setAttribute("aria-grabbed", "false");
      card.addEventListener("dragstart", (event) => {
        if (pointerCandidate && event.isTrusted) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", entry.task.id);
        event.dataTransfer.setData(taskDragMime, JSON.stringify({
          categoryColor: entry.categoryColor || "",
          taskId: entry.task.id,
          title: entry.title || entry.task.title || "",
        }));
        card.classList.add("is-dragging");
        card.setAttribute("aria-grabbed", "true");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging");
        card.setAttribute("aria-grabbed", "false");
        hidePointerHint();
        removeAllDropPreviews();
        card.dataset.suppressClick = "true";
        window.setTimeout(() => {
          delete card.dataset.suppressClick;
        }, 0);
      });
      card.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest(".timeline-menu-button, .timeline-task-menu")) return;
        pointerCandidate = true;
        startPointerDrag(event, card, entry, () => {
          pointerCandidate = false;
        });
      });
    }

    function startPointerDrag(event, card, entry, onFinish) {
      const startX = event.clientX;
      const startY = event.clientY;
      const isTouch = event.pointerType === "touch";
      let active = false;
      let cancelled = false;
      let currentSlot = null;
      let currentMinutes = NaN;
      let longPressTimer = null;

      const activate = () => {
        if (active || cancelled) return;
        active = true;
        card.setPointerCapture?.(event.pointerId);
        card.classList.add("is-dragging", "is-pointer-dragging");
        card.setAttribute("aria-grabbed", "true");
        card.setAttribute("data-drag-label", "Перетащи на время");
        if (isTouch) global.navigator?.vibrate?.(12);
      };

      if (isTouch) longPressTimer = global.setTimeout(activate, 320);

      const onMove = (moveEvent) => {
        const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (!active && !isTouch && distance > 5) activate();
        if (!active) {
          if (isTouch && distance > 8) {
            cancelled = true;
            global.clearTimeout(longPressTimer);
          }
          return;
        }
        moveEvent.preventDefault();
        autoScrollViewport(moveEvent);
        const slot = slotFromPointer(moveEvent);
        if (slot !== currentSlot) {
          clearPointerDropTarget(currentSlot);
          currentSlot = slot;
        }
        if (!currentSlot) {
          currentMinutes = NaN;
          card.setAttribute("data-drag-label", "Перетащи на время");
          hidePointerHint();
          return;
        }
        const hour = Number(currentSlot.dataset.hour);
        currentMinutes = minuteFromPointer(moveEvent, currentSlot, hour);
        const label = formatMinutes(currentMinutes);
        currentSlot.classList.add("is-drop-target");
        updateDropPreview(currentSlot, currentMinutes, label, entry);
        card.setAttribute("data-drag-label", label);
        showPointerHint(label, moveEvent);
      };

      const onUp = (upEvent) => {
        global.clearTimeout(longPressTimer);
        const shouldMove = active && currentSlot && Number.isFinite(currentMinutes);
        cleanup(upEvent);
        if (!shouldMove) return;
        card.dataset.suppressClick = "true";
        global.setTimeout(() => delete card.dataset.suppressClick, 0);
        ctx.moveTaskTime(entry.task.id, formatMinutes(currentMinutes));
      };

      const onCancel = (cancelEvent) => {
        cancelled = true;
        global.clearTimeout(longPressTimer);
        cleanup(cancelEvent);
      };

      const cleanup = (nextEvent) => {
        if (active) card.releasePointerCapture?.(nextEvent?.pointerId);
        global.removeEventListener("pointermove", onMove);
        global.removeEventListener("pointerup", onUp);
        global.removeEventListener("pointercancel", onCancel);
        clearPointerDropTarget(currentSlot);
        card.classList.remove("is-dragging", "is-pointer-dragging");
        card.setAttribute("aria-grabbed", "false");
        card.removeAttribute("data-drag-label");
        hidePointerHint();
        onFinish?.();
      };

      global.addEventListener("pointermove", onMove, { passive: false });
      global.addEventListener("pointerup", onUp);
      global.addEventListener("pointercancel", onCancel);
    }

    function slotFromPointer(event) {
      return document.elementFromPoint?.(event.clientX, event.clientY)?.closest?.(".timeline-hour-slot") || null;
    }

    function clearPointerDropTarget(slot) {
      slot?.classList.remove("is-drop-target");
      if (slot) removeDropPreview(slot);
    }

    function autoScrollViewport(event) {
      const edge = 72;
      const viewportHeight = global.innerHeight || document.documentElement?.clientHeight || 0;
      if (event.clientY < edge) global.scrollBy?.({ top: -18, behavior: "auto" });
      else if (viewportHeight && event.clientY > viewportHeight - edge) global.scrollBy?.({ top: 18, behavior: "auto" });
    }

    function attachDropZone(slot, hour) {
      if (!ctx.moveTaskTime) return;

      slot.addEventListener("dragover", (event) => {
        const dragData = readDragData(event.dataTransfer);
        if (!dragData) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const minutes = minuteFromPointer(event, slot, hour);
        const label = formatMinutes(minutes);
        slot.classList.add("is-drop-target");
        updateDropPreview(slot, minutes, label, dragData);
        showPointerHint(label, event);
      });

      slot.addEventListener("dragleave", (event) => {
        if (slot.contains(event.relatedTarget)) return;
        slot.classList.remove("is-drop-target");
        removeDropPreview(slot);
        hidePointerHint();
      });

      slot.addEventListener("drop", (event) => {
        const dragData = readDragData(event.dataTransfer);
        if (!dragData?.taskId) return;
        event.preventDefault();
        slot.classList.remove("is-drop-target");
        removeDropPreview(slot);
        hidePointerHint();
        const minutes = minuteFromPointer(event, slot, hour);
        ctx.moveTaskTime(dragData.taskId, formatMinutes(minutes));
      });
    }

    function readDragData(dataTransfer) {
      if (!dataTransfer) return null;
      const typed = dataTransfer.getData(taskDragMime);
      if (typed) {
        try {
          return JSON.parse(typed);
        } catch {
          return null;
        }
      }
      const taskId = dataTransfer.getData("text/plain");
      return taskId ? { minute: 0, taskId } : null;
    }

    function updateDropPreview(slot, minutes, label, entry = {}) {
      const preview = ensureDropPreview(slot);
      preview.style.setProperty("--drop-preview-top", `${((minutes % 60) / 60) * 100}%`);
      if (entry.categoryColor) preview.style.setProperty("--timeline-color", entry.categoryColor);
      else preview.style.removeProperty("--timeline-color");
      const end = Math.min(23 * 60 + 59, minutes + 60);
      const title = String(entry.title || "").trim();
      preview.textContent = `${label}–${formatMinutes(end)}${title ? ` · ${title}` : ""}`;
    }

    function ensureDropPreview(slot) {
      let preview = slot.querySelector(":scope > .timeline-drop-preview");
      if (!preview) {
        preview = document.createElement("span");
        preview.className = "timeline-drop-preview";
        slot.appendChild(preview);
      }
      return preview;
    }

    function removeDropPreview(slot) {
      slot.querySelector(":scope > .timeline-drop-preview")?.remove();
    }

    function removeAllDropPreviews() {
      document.querySelectorAll(".timeline-drop-preview").forEach((node) => node.remove());
    }

    function showPointerHint(label, event) {
      if (!pointerHint) {
        pointerHint = document.createElement("span");
        pointerHint.className = "timeline-pointer-hint";
        document.body.appendChild(pointerHint);
      }
      pointerHint.textContent = label;
      pointerHint.style.left = `${event.clientX}px`;
      pointerHint.style.top = `${event.clientY}px`;
    }

    function hidePointerHint() {
      pointerHint?.remove();
      pointerHint = null;
    }

    function showUnscheduledTarget() {
      if (unscheduledTarget) return;
      unscheduledTarget = document.createElement("div");
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      const hint = document.createElement("small");
      unscheduledTarget.className = "timeline-unschedule-target";
      unscheduledTarget.setAttribute("aria-hidden", "true");
      icon.classList.add("ui-icon");
      use.setAttribute("href", "#icon-skip");
      title.textContent = "Без времени";
      hint.textContent = "Перетащи сюда, чтобы убрать расписание";
      icon.appendChild(use);
      copy.append(title, hint);
      unscheduledTarget.append(icon, copy);
      document.body.appendChild(unscheduledTarget);
    }

    function isOverUnscheduledTarget(event) {
      if (!unscheduledTarget) return false;
      const rect = unscheduledTarget.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    }

    function setUnscheduledTargetActive(active) {
      unscheduledTarget?.classList.toggle("is-drop-target", active);
    }

    function hideUnscheduledTarget() {
      unscheduledTarget?.remove();
      unscheduledTarget = null;
    }

    function formatMinutes(minutes) {
      return formatHourMinute(Math.floor(minutes / 60), minutes % 60);
    }

    return {
      attachDropZone,
      attachUnscheduledDrag,
      hidePointerHint,
      hideUnscheduledTarget,
      isOverUnscheduledTarget,
      readDragData,
      setUnscheduledTargetActive,
      showPointerHint,
      showUnscheduledTarget,
    };
  }

  const api = { createTimelineDrag };
  global.RhythmTimelineDrag = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
