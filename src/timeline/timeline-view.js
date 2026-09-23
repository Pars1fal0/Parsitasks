(function (global) {
  const TASK_DRAG_MIME = "application/x-rhythm-timeline-task";
  const layout =
    global.RhythmTimelineLayout ||
    (typeof require !== "undefined" ? require("./timeline-layout.js") : null);
  const {
    DEFAULT_BLOCK_MINUTES,
    TIMELINE_LAST_MINUTE,
    TIMELINE_SLOT_MINUTES,
    buildTimelineModel,
    formatBlockLabel,
    formatHourMinute,
    getSlotHeight,
    minuteOffsetToPx,
    minutesToPx,
    nextBlockTimes,
    snapMinutes,
  } = layout;
  const menuApi =
    global.RhythmTimelineMenu ||
    (typeof require !== "undefined" ? require("./timeline-menu.js") : null);
  const dragApi =
    global.RhythmTimelineDrag ||
    (typeof require !== "undefined" ? require("./timeline-drag.js") : null);

  function createTimelineView(ctx) {
    const scaleHeights = { compact: 72, comfortable: 96, large: 144 };
    let timelineScale = loadTimelineScale();
    let justScheduledTaskId = "";
    let justScheduledTimer = null;
    const taskMenu = menuApi.createTimelineMenu({ ...ctx, createTaskBeside });
    const timelineDrag = dragApi.createTimelineDrag({
      ctx: { ...ctx, moveTaskTime: scheduleDraggedTask },
      formatHourMinute,
      minuteFromPointer,
      taskDragMime: TASK_DRAG_MIME,
    });
    bindScaleControls();

    function renderTimeline() {
      const viewport = captureViewport();
      taskMenu.closeTaskMenu();
      const hourHeight = scaleHeights[timelineScale];
      const activeDate = ctx.getActiveDate();
      const now = ctx.getNow?.() || new Date();
      const model = buildTimelineModel({
        activeDate,
        formatTime: ctx.formatTime,
        getCategory: ctx.getCategory,
        isTaskDone: ctx.isTaskDone,
        now,
        priorityLabels: ctx.priorityLabels,
        tasks: ctx.getOrderedTasksForDate(activeDate),
        todayKey: ctx.toDateKey?.(now),
      });

      ctx.els.timelineSummary.textContent = `${model.timedTasks.length} по времени · ${model.unscheduledTasks.length} без времени`;
      if (ctx.els.timelineUnscheduledCount) ctx.els.timelineUnscheduledCount.textContent = String(model.unscheduledTasks.length);
      ctx.els.timelineGrid.replaceChildren();
      ctx.els.timelineUnscheduledList.replaceChildren();
      ctx.els.timelineEmpty.classList.toggle("is-visible", model.timedTasks.length === 0 && model.unscheduledTasks.length === 0);

      model.hourRows.forEach((row) => {
        const rowNode = document.createElement("div");
        const label = document.createElement("div");
        const slot = document.createElement("div");

        rowNode.className = "timeline-hour-row";
        label.className = "timeline-hour-label";
        label.textContent = row.label;
        slot.className = "timeline-hour-slot";
        slot.style.minHeight = `${hourHeight}px`;
        slot.dataset.hour = String(row.hour);
        slot.setAttribute("role", "group");
        slot.setAttribute("aria-label", `Задачи на ${row.label}`);
        timelineDrag.attachDropZone(slot, row.hour);
        attachSlotCreate(slot, row.hour);

        if (model.nowLine?.hour === row.hour) {
          slot.appendChild(createNowLine(model.nowLine.offsetPercent));
        }

        row.tasks.forEach((entry) => {
          slot.appendChild(createTimelineTask(entry));
        });

        rowNode.append(label, slot);
        ctx.els.timelineGrid.appendChild(rowNode);
      });

      model.unscheduledTasks.forEach((entry) => {
        ctx.els.timelineUnscheduledList.appendChild(createTimelineTask(entry));
      });
      restoreViewport(viewport);
    }

    function createTimelineTask(entry) {
      const card = document.createElement("article");
      const main = document.createElement("button");
      const top = document.createElement("span");
      const time = document.createElement("strong");
      const title = document.createElement("span");
      const meta = document.createElement("small");
      const actions = taskMenu.createTaskMenu(entry);

      card.className = `timeline-task priority-${entry.task.priority || "medium"}`;
      card.classList.toggle("is-scheduled", Number.isFinite(entry.minutes));
      card.classList.toggle("is-unscheduled", !Number.isFinite(entry.minutes));
      card.classList.toggle("is-done", entry.done);
      card.classList.toggle("is-overdue", entry.isOverdue);
      card.classList.toggle("is-time-block", entry.isTimeBlock);
      card.classList.toggle("is-deadline-marker", Number.isFinite(entry.minutes) && !entry.isTimeBlock);
      card.classList.toggle("is-just-scheduled", entry.task.id === justScheduledTaskId && entry.isTimeBlock);
      card.dataset.taskId = entry.task.id;
      if (!Number.isFinite(entry.minutes)) card.setAttribute("role", "listitem");
      if (entry.categoryColor) card.style.setProperty("--timeline-color", entry.categoryColor);
      card.addEventListener("click", (event) => {
        if (card.dataset.suppressClick === "true" || event.target.closest(".timeline-resize-handle, .timeline-create-neighbor-button, .timeline-menu-button, .timeline-task-menu")) return;
        ctx.fillTaskForm(entry.task);
      });
      if (Number.isFinite(entry.minutes)) {
        card.style.setProperty("--timeline-task-top", `${minuteOffsetToPx(entry.minutes, scaleHeights[timelineScale])}px`);
        card.style.setProperty("--timeline-column-left", `${((entry.columnIndex || 0) / (entry.columnCount || 1)) * 100}%`);
        card.style.setProperty("--timeline-column-width", `${(1 / (entry.columnCount || 1)) * 100}%`);
        card.style.setProperty("--timeline-column-gap", entry.columnCount > 1 ? "6px" : "0px");
        card.dataset.overlapCount = String(entry.columnCount || 1);
        card.setAttribute("aria-grabbed", "false");
        if (ctx.moveTaskTime) card.addEventListener("pointerdown", (event) => startTaskDrag(event, entry));
      } else if (ctx.moveTaskTime) {
        timelineDrag.attachUnscheduledDrag(card, entry);
      }
      if (Number.isFinite(entry.visualDuration)) {
        const duration = Math.max(TIMELINE_SLOT_MINUTES, entry.visualDuration);
        card.classList.toggle("is-short-block", duration <= 30);
        card.classList.toggle("is-tiny-block", duration <= 15);
        setBlockHeight(card, duration);
      }

      main.type = "button";
      main.className = "timeline-task-main";
      main.setAttribute("aria-label", `${entry.title}, ${entry.timeLabel || "без времени"}`);
      if (Number.isFinite(entry.minutes) && ctx.shiftTaskTime) {
        main.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight");
        main.addEventListener("keydown", (event) => handleTaskKeydown(event, entry));
      }
      top.className = "timeline-task-top";
      time.textContent = entry.timeLabel || "Без времени";
      title.textContent = entry.title;
      title.title = entry.title;
      meta.textContent = entry.isOverdue ? `${entry.metaLabel} · просрочено` : entry.metaLabel;
      top.append(time, title);
      main.append(top, meta);
      if (!Number.isFinite(entry.minutes) && ctx.moveTaskTime) card.appendChild(createUnscheduledDragHandle(entry));
      card.append(main);
      if (Number.isFinite(entry.minutes) && ctx.createTaskAtTime) card.appendChild(createNeighborButton(entry));
      card.append(actions);

      if (entry.isTimeBlock && ctx.resizeTaskBlockTime) {
        card.appendChild(createResizeHandle(entry, "start"));
        card.appendChild(createResizeHandle(entry, "end"));
      }

      return card;
    }

    function createUnscheduledDragHandle(entry) {
      const handle = document.createElement("button");
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      handle.type = "button";
      handle.className = "timeline-unscheduled-drag-handle";
      handle.setAttribute("aria-label", `Перетащить «${entry.title}» на временную шкалу`);
      handle.title = "Перетащить на временную шкалу";
      handle.draggable = false;
      icon.classList.add("ui-icon");
      use.setAttribute("href", "#icon-grip");
      icon.appendChild(use);
      handle.appendChild(icon);
      handle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      return handle;
    }

    function scheduleDraggedTask(taskId, targetTime) {
      justScheduledTaskId = taskId;
      const result = ctx.moveTaskTime?.(taskId, targetTime);
      if (result && typeof result.then === "function") {
        return result.then((changed) => {
          if (changed) armJustScheduledHighlight(taskId);
          else clearJustScheduledHighlight(taskId);
          return changed;
        });
      }
      if (result) armJustScheduledHighlight(taskId);
      else clearJustScheduledHighlight(taskId);
      return result;
    }

    function armJustScheduledHighlight(taskId) {
      global.clearTimeout(justScheduledTimer);
      justScheduledTimer = global.setTimeout(() => clearJustScheduledHighlight(taskId), 3200);
    }

    function clearJustScheduledHighlight(taskId) {
      if (taskId && justScheduledTaskId !== taskId) return;
      justScheduledTaskId = "";
      global.clearTimeout(justScheduledTimer);
      justScheduledTimer = null;
      ctx.els.timelineGrid
        ?.querySelector(`[data-task-id="${escapeSelector(taskId)}"]`)
        ?.classList.remove("is-just-scheduled");
    }

    function createNeighborButton(entry) {
      const button = document.createElement("button");
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      button.type = "button";
      button.className = "timeline-create-neighbor-button";
      button.setAttribute("aria-label", `Создать задачу рядом с ${entry.title}`);
      button.title = "Создать задачу в это же время";
      icon.classList.add("ui-icon");
      use.setAttribute("href", "#icon-plus");
      icon.appendChild(use);
      button.appendChild(icon);
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        createTaskBeside(entry);
      });
      return button;
    }

    function createTaskBeside(entry) {
      if (!Number.isFinite(entry?.minutes) || !ctx.createTaskAtTime) return false;
      const start = entry.minutes;
      const end = entry.isTimeBlock && Number.isFinite(entry.endMinutes)
        ? entry.endMinutes
        : Math.min(TIMELINE_LAST_MINUTE, start + DEFAULT_BLOCK_MINUTES);
      ctx.createTaskAtTime(formatMinutes(start), formatMinutes(Math.max(start + TIMELINE_SLOT_MINUTES, end)));
      return true;
    }

    function createResizeHandle(entry, edge) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = `timeline-resize-handle is-${edge}`;
      handle.setAttribute("aria-label", edge === "start" ? "Потянуть начало блока" : "Потянуть конец блока");
      handle.addEventListener("pointerdown", (event) => startBlockResize(event, entry, edge));
      handle.addEventListener("keydown", (event) => {
        const offsets = { ArrowDown: 15, ArrowUp: -15 };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        resizeBlockByKeyboard(entry, edge, offset);
      });
      return handle;
    }

    function startBlockResize(event, entry, edge) {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      const card = target.closest(".timeline-task");
      const slotHeight = getSlotHeight(target.closest(".timeline-hour-slot"));
      const startY = event.clientY;
      const originalStart = entry.minutes;
      const originalEnd = entry.endMinutes;
      target.setPointerCapture?.(event.pointerId);
      card?.classList.add("is-resizing");
      card?.setAttribute("data-resize-label", formatBlockLabel(originalStart, originalEnd));

      const onMove = (moveEvent) => {
        moveEvent.preventDefault();
        const rawDelta = ((moveEvent.clientY - startY) / slotHeight) * 60;
        const delta = snapMinutes(rawDelta);
        const next = nextBlockTimes(originalStart, originalEnd, edge, delta);
        if (card) {
          previewBlockResize(card, originalStart, next.start, next.end);
          timelineDrag.showPointerHint(formatBlockLabel(next.start, next.end), moveEvent);
        }
      };

      const onUp = (upEvent) => {
        cleanup(upEvent);
        const rawDelta = ((upEvent.clientY - startY) / slotHeight) * 60;
        const delta = snapMinutes(rawDelta);
        const next = nextBlockTimes(originalStart, originalEnd, edge, delta);
        ctx.resizeTaskBlockTime(entry.task.id, formatHourMinute(Math.floor(next.start / 60), next.start % 60), formatHourMinute(Math.floor(next.end / 60), next.end % 60));
      };

      const onCancel = (cancelEvent) => {
        cleanup(cancelEvent);
        if (card) {
          setBlockHeight(card, originalEnd - originalStart);
          card.style.removeProperty("--timeline-drag-y");
          card.style.removeProperty("transform");
          card.removeAttribute("data-resize-label");
        }
      };

      const cleanup = (nextEvent) => {
        target.releasePointerCapture?.(nextEvent.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        card?.classList.remove("is-resizing");
        timelineDrag.hidePointerHint();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    }

    function resizeBlockByKeyboard(entry, edge, offset) {
      const next = nextBlockTimes(entry.minutes, entry.endMinutes, edge, offset);
      ctx.resizeTaskBlockTime(entry.task.id, formatHourMinute(Math.floor(next.start / 60), next.start % 60), formatHourMinute(Math.floor(next.end / 60), next.end % 60));
    }

    function startTaskDrag(event, entry) {
      if (!Number.isFinite(entry.minutes) || !ctx.moveTaskTime) return;
      if (event.button !== 0 || event.target.closest(".timeline-resize-handle, .timeline-create-neighbor-button, .timeline-menu-button, .timeline-task-menu")) return;
      const card = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      const originalStart = entry.minutes;
      const duration = entry.isTimeBlock ? Math.max(TIMELINE_SLOT_MINUTES, entry.endMinutes - entry.minutes) : 0;
      const isTouch = event.pointerType === "touch";
      let didMove = false;
      let latestStart = originalStart;
      let dropWithoutTime = false;
      let active = false;
      let cancelled = false;
      let longPressTimer = null;

      const activate = () => {
        if (active || cancelled) return;
        active = true;
        card.setPointerCapture?.(event.pointerId);
        card.classList.add("is-dragging");
        card.setAttribute("aria-grabbed", "true");
        card.setAttribute("data-drag-label", entry.timeLabel || formatHourMinute(Math.floor(originalStart / 60), originalStart % 60));
        if (isTouch) global.navigator?.vibrate?.(12);
      };
      if (isTouch) longPressTimer = global.setTimeout(activate, 320);
      else activate();

      const onMove = (moveEvent) => {
        const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (!active) {
          if (distance > 8) {
            cancelled = true;
            global.clearTimeout(longPressTimer);
          }
          return;
        }
        moveEvent.preventDefault();
        const rawDelta = ((moveEvent.clientY - startY) / getSlotHeight(card.closest(".timeline-hour-slot"))) * 60;
        const delta = snapMinutes(rawDelta);
        const maxStart = duration ? TIMELINE_LAST_MINUTE - duration : TIMELINE_LAST_MINUTE;
        const nextStart = Math.max(0, Math.min(maxStart, originalStart + delta));
        if (distance > 3) didMove = true;
        if (didMove) timelineDrag.showUnscheduledTarget();
        dropWithoutTime = didMove && timelineDrag.isOverUnscheduledTarget(moveEvent);
        timelineDrag.setUnscheduledTargetActive(dropWithoutTime);
        latestStart = nextStart;
        if (dropWithoutTime) {
          card.style.setProperty("--timeline-drag-y", "0px");
          card.setAttribute("data-drag-label", "Без времени");
          timelineDrag.showPointerHint("Без времени", moveEvent);
          return;
        }
        const label = duration
          ? formatBlockLabel(nextStart, nextStart + duration)
          : formatHourMinute(Math.floor(nextStart / 60), nextStart % 60);
        card.style.setProperty("--timeline-drag-y", `${minutesToPx(nextStart - originalStart, scaleHeights[timelineScale])}px`);
        card.setAttribute("data-drag-label", label);
        timelineDrag.showPointerHint(label, moveEvent);
      };

      const onUp = (upEvent) => {
        global.clearTimeout(longPressTimer);
        if (!active) {
          cleanup(upEvent);
          return;
        }
        const shouldClearTime = dropWithoutTime || timelineDrag.isOverUnscheduledTarget(upEvent);
        cleanup(upEvent);
        if (!didMove || (!shouldClearTime && latestStart === originalStart)) return;
        card.dataset.suppressClick = "true";
        window.setTimeout(() => {
          delete card.dataset.suppressClick;
        }, 0);
        if (shouldClearTime) {
          ctx.clearTaskTime?.(entry.task.id);
        } else {
          ctx.moveTaskTime(entry.task.id, formatHourMinute(Math.floor(latestStart / 60), latestStart % 60));
        }
      };

      const onCancel = (cancelEvent) => {
        cancelled = true;
        global.clearTimeout(longPressTimer);
        cleanup(cancelEvent);
      };

      const cleanup = (nextEvent) => {
        if (active) card.releasePointerCapture?.(nextEvent?.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        card.classList.remove("is-dragging");
        card.setAttribute("aria-grabbed", "false");
        card.style.removeProperty("--timeline-drag-y");
        card.removeAttribute("data-drag-label");
        timelineDrag.hidePointerHint();
        timelineDrag.hideUnscheduledTarget();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    }

    function previewBlockResize(card, originalStart, nextStart, nextEnd) {
      setBlockHeight(card, nextEnd - nextStart);
      card.style.setProperty("--timeline-drag-y", `${minutesToPx(nextStart - originalStart, scaleHeights[timelineScale])}px`);
      card.setAttribute("data-resize-label", formatBlockLabel(nextStart, nextEnd));
    }

    function setBlockHeight(card, duration) {
      const normalizedDuration = Math.max(TIMELINE_SLOT_MINUTES, duration);
      card.classList.toggle("is-short-block", normalizedDuration <= 30);
      card.classList.toggle("is-tiny-block", normalizedDuration <= 15);
      card.style.setProperty("--block-height", `${Math.max(20, Math.round(minutesToPx(normalizedDuration, scaleHeights[timelineScale]) - 4))}px`);
    }

    function captureViewport() {
      return {
        x: Number(global.scrollX) || 0,
        y: Number(global.scrollY) || document.documentElement?.scrollTop || document.body?.scrollTop || 0,
      };
    }

    function restoreViewport(position) {
      global.requestAnimationFrame?.(() => {
        global.scrollTo?.({ left: position.x, top: position.y, behavior: "auto" });
      });
    }

    function handleTaskKeydown(event, entry) {
      if (!event.altKey) return;
      const offsets = {
        ArrowDown: 15,
        ArrowLeft: -15,
        ArrowRight: 15,
        ArrowUp: -15,
      };
      const offset = offsets[event.key];
      if (!offset) return;
      event.preventDefault();
      event.stopPropagation();
      ctx.shiftTaskTime(entry.task.id, offset);
    }

    function createNowLine(offsetPercent) {
      const marker = document.createElement("span");
      const label = document.createElement("span");
      marker.className = "timeline-now-line";
      marker.style.setProperty("--now-offset", `${offsetPercent}%`);
      label.className = "timeline-now-label";
      label.textContent = "Сейчас";
      marker.appendChild(label);
      return marker;
    }

    function attachSlotCreate(slot, hour) {
      if (!ctx.createTaskAtTime) return;
      slot.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest(".timeline-task") || event.target.closest(".timeline-now-line")) return;
        const startMinutes = Math.min(TIMELINE_LAST_MINUTE - TIMELINE_SLOT_MINUTES, minuteFromPointerFree(event, slot, hour));
        let latestEnd = Math.min(TIMELINE_LAST_MINUTE, startMinutes + DEFAULT_BLOCK_MINUTES);
        const isTouch = event.pointerType === "touch";
        let didMove = false;
        let active = false;
        let cancelled = false;
        const startY = event.clientY;
        const preview = document.createElement("span");
        preview.className = "timeline-create-preview";
        let longPressTimer = null;

        const activate = () => {
          if (active || cancelled) return;
          active = true;
          slot.appendChild(preview);
          updateCreatePreview(preview, startMinutes, latestEnd);
          slot.setPointerCapture?.(event.pointerId);
          if (isTouch) global.navigator?.vibrate?.(12);
        };
        if (isTouch) longPressTimer = global.setTimeout(activate, 320);
        else activate();

        const onMove = (moveEvent) => {
          if (!active) {
            if (Math.abs(moveEvent.clientY - startY) > 8) {
              cancelled = true;
              global.clearTimeout(longPressTimer);
            }
            return;
          }
          moveEvent.preventDefault();
          if (Math.abs(moveEvent.clientY - startY) > 4) didMove = true;
          const rawEnd = minuteFromPointerFree(moveEvent, slot, hour);
          latestEnd = Math.max(startMinutes + TIMELINE_SLOT_MINUTES, rawEnd);
          updateCreatePreview(preview, startMinutes, latestEnd);
          timelineDrag.showPointerHint(formatBlockLabel(startMinutes, latestEnd), moveEvent);
        };

        const onUp = (upEvent) => {
          global.clearTimeout(longPressTimer);
          if (!active) {
            cleanup(upEvent);
            return;
          }
          cleanup(upEvent);
          if (!didMove) return;
          slot.dataset.suppressClick = "true";
          window.setTimeout(() => {
            delete slot.dataset.suppressClick;
          }, 0);
          ctx.createTaskAtTime(formatMinutes(startMinutes), formatMinutes(latestEnd));
        };

        const onCancel = (cancelEvent) => {
          cancelled = true;
          global.clearTimeout(longPressTimer);
          cleanup(cancelEvent);
        };

        const cleanup = (nextEvent) => {
          if (active) slot.releasePointerCapture?.(nextEvent?.pointerId);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onCancel);
          preview.remove();
          timelineDrag.hidePointerHint();
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
      });

      slot.addEventListener("click", (event) => {
        if (slot.dataset.suppressClick === "true") return;
        if (event.target.closest(".timeline-task") || event.target.closest(".timeline-now-line")) return;
        const minutes = Math.min(TIMELINE_LAST_MINUTE - TIMELINE_SLOT_MINUTES, minuteFromPointer(event, slot, hour));
        const startTime = formatMinutes(minutes);
        const end = Math.min(TIMELINE_LAST_MINUTE, minutes + DEFAULT_BLOCK_MINUTES);
        const endTime = formatMinutes(end);
        ctx.createTaskAtTime(startTime, endTime);
      });
    }

    function minuteFromPointer(event, slot, hour) {
      const rect = slot.getBoundingClientRect();
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      const minutesInHour = Math.min(45, Math.max(0, snapMinutes((y / getSlotHeight(slot)) * 60)));
      return Math.min(TIMELINE_LAST_MINUTE, hour * 60 + minutesInHour);
    }

    function minuteFromPointerFree(event, slot, hour) {
      const rect = slot.getBoundingClientRect();
      const rawMinutes = hour * 60 + snapMinutes(((event.clientY - rect.top) / getSlotHeight(slot)) * 60);
      return Math.max(0, Math.min(TIMELINE_LAST_MINUTE, rawMinutes));
    }

    function updateCreatePreview(preview, startMinutes, endMinutes) {
      const top = `${((startMinutes % 60) / 60) * 100}%`;
      const height = `${Math.max(20, minutesToPx(endMinutes - startMinutes, scaleHeights[timelineScale]) - 4)}px`;
      preview.style.setProperty("--create-preview-top", top);
      preview.style.setProperty("--create-preview-height", height);
      preview.textContent = formatBlockLabel(startMinutes, endMinutes);
    }

    function formatMinutes(minutes) {
      return formatHourMinute(Math.floor(minutes / 60), minutes % 60);
    }

    function bindScaleControls() {
      (ctx.els.timelineScaleButtons || []).forEach((button) => {
        button.addEventListener("click", () => {
          const nextScale = button.dataset.timelineScale;
          if (!scaleHeights[nextScale] || nextScale === timelineScale) return;
          timelineScale = nextScale;
          try {
            global.localStorage?.setItem("rhythm-timeline-scale", timelineScale);
          } catch {}
          updateScaleControls();
          renderTimeline();
        });
      });
      updateScaleControls();
    }

    function updateScaleControls() {
      (ctx.els.timelineScaleButtons || []).forEach((button) => {
        const active = button.dataset.timelineScale === timelineScale;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }

    function loadTimelineScale() {
      try {
        const saved = global.localStorage?.getItem("rhythm-timeline-scale");
        if (scaleHeights[saved]) return saved;
      } catch {}
      return global.matchMedia?.("(max-width: 720px)")?.matches ? "large" : "comfortable";
    }

    function scrollToRelevantTime(options = {}) {
      const keepUnscheduledVisible = options.keepUnscheduledVisible !== false;
      if (keepUnscheduledVisible && ctx.els.timelineUnscheduledList?.children.length) return false;
      global.requestAnimationFrame?.(() => {
        const nowLine = ctx.els.timelineGrid?.querySelector(".timeline-now-line");
        const firstTask = ctx.els.timelineGrid?.querySelector(".timeline-task.is-scheduled");
        const morning = ctx.els.timelineGrid?.querySelector('.timeline-hour-slot[data-hour="8"]');
        const target = nowLine || firstTask || morning;
        if (!target) return;
        const offset = Math.min(180, Math.max(112, (global.innerHeight || 800) * 0.18));
        const top = target.getBoundingClientRect().top + (Number(global.scrollY) || 0) - offset;
        global.scrollTo?.({ left: 0, top: Math.max(0, top), behavior: "auto" });
      });
      return true;
    }

    function escapeSelector(value) {
      if (global.CSS?.escape) return global.CSS.escape(String(value || ""));
      return String(value || "").replace(/["\\]/g, "\\$&");
    }

    return { renderTimeline, scrollToRelevantTime };
  }

  const api = { buildTimelineModel, createTimelineView };
  global.RhythmTimelineView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
