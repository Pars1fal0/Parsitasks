(function (global) {
  const layout = global.RhythmTimelineLayout || (typeof require !== "undefined" ? require("../timeline/timeline-layout.js") : null);
  const HOUR_HEIGHT = 96;
  const DAY_END = 23 * 60 + 59;
  const DRAG_TYPE = "application/x-parsitasks-calendar";
  const MOBILE_HOUR_HEIGHT = 72;
  const ZOOM_STORAGE = "parsitasks-calendar-touch-scale";

  function zoomHeight(value) { return Math.max(48, Math.min(192, Number(value) || MOBILE_HOUR_HEIGHT)); }
  function anchoredScroll(scrollTop, oldHeight, newHeight, anchorY, headerHeight = 48) {
    return Math.max(0, (scrollTop + anchorY - headerHeight) / oldHeight * newHeight + headerHeight - anchorY);
  }

  function freeIntervals(entries, start = 480, end = 1320) {
    const occupied = entries.filter((entry) => entry.isTimeBlock)
      .map((entry) => [Math.max(start, entry.minutes), Math.min(end, entry.endMinutes)])
      .filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && to > from)
      .sort((a, b) => a[0] - b[0]);
    const result = [];
    let cursor = start;
    for (const [from, to] of occupied) {
      if (from > cursor) result.push({ start: cursor, end: from });
      cursor = Math.max(cursor, to);
    }
    if (cursor < end) result.push({ start: cursor, end });
    return result;
  }

  function time(minutes) { return layout.formatHourMinute(Math.floor(minutes / 60), minutes % 60); }
  function quarterMinute(offset, height) {
    return Math.max(0, Math.min(1425, Math.floor(offset / height * 60 / 15) * 15));
  }

  function createCalendarSchedule(ctx) {
    const root = document.querySelector("#calendarSchedule");
    const weekdayFormatter = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });
    let viewportKey = "";
    let scrollHour = 0;
    let scrollLeft = 0;
    let dragged = null;
    let resizing = false;
    let hourHeight = HOUR_HEIGHT;
    let desktopHourHeight = HOUR_HEIGHT;
    let lastMode = "week";
    let resizeFrame;
    let renderedWidth = 0;
    let fullMobileWeek = false;
    let threeMobileDays = false;
    const eventActions = new Map();
    let interactivePreview = false;
    let touchBusy = false;
    let suppressClickUntil = 0;
    let mobileHourHeight = MOBILE_HOUR_HEIGHT;
    let disposeTouch = () => {};
    let menuController;
    let expanded = false, returnFocus = null, pagePosition = null, previousOverflow = "";
    let exitPending = false, exitApproved = false, selectedEvent = null, untimedOpen = false;
    let preservedViewport = null;
    const home = document.createComment("calendar-schedule-home");
    root.before(home);
    const layerToggle = document.querySelector("#overviewView .study-layer-toggle");
    const layerHome = layerToggle?.parentElement;
    const layerSibling = layerToggle?.nextSibling;
    try { mobileHourHeight = zoomHeight(global.localStorage?.getItem(ZOOM_STORAGE)); } catch { /* Device preference is optional. */ }
    const mobile = () => global.matchMedia?.("(max-width: 680px)")?.matches;
    const preview = element("div", "calendar-event-preview");
    preview.id = "calendarEventPreview";
    preview.setAttribute("role", "tooltip");
    preview.hidden = true;
    document.body.append(preview);
    let previewOwner = null;
    let previewScroll = null;
    function hidePreview() {
      preview.hidden = true;
      interactivePreview = false;
      preview.classList.remove("is-interactive");
      preview.setAttribute("role", "tooltip");
      previewOwner?.removeAttribute("aria-describedby");
      previewOwner = null;
      previewScroll = null;
    }
    function showPreview(node, open, entry, force = false) {
      if (!force && !node.classList.contains("is-short")) return;
      hidePreview();
      preview.replaceChildren(element("strong", "", entry.title), element("span", "", open.querySelector("small").textContent));
      preview.hidden = false;
      const anchor = node.getBoundingClientRect();
      const size = preview.getBoundingClientRect();
      preview.style.left = `${Math.max(12, Math.min(global.innerWidth - size.width - 12, anchor.left))}px`;
      preview.style.top = `${anchor.bottom + size.height + 20 <= global.innerHeight ? anchor.bottom + 8 : Math.max(12, anchor.top - size.height - 8)}px`;
      previewOwner = open;
      const scroller = root.querySelector(".calendar-time-scroll");
      previewScroll = scroller ? { top: scroller.scrollTop, left: scroller.scrollLeft } : null;
      open.setAttribute("aria-describedby", preview.id);
    }
    function showEventActions(node, open, entry, date) {
      showPreview(node, open, entry, true);
      interactivePreview = true;
      preview.classList.add("is-interactive");
      preview.setAttribute("role", "dialog");
      preview.setAttribute("aria-label", entry.title);
      const actions = element("div", "calendar-preview-actions");
      if (!entry.task.studyEvent) actions.append(button("primary-button compact-button", entry.done ? "Вернуть в работу" : "Выполнить", () => {
        hidePreview(); ctx.toggleTaskDone(entry.task.id, date);
      }));
      actions.append(button("ghost-button compact-button", "Изменить", () => {
        hidePreview(); entry.task.studyEvent ? ctx.openLesson(entry.task.studyEvent, date) : ctx.editTask(entry.task, date);
      }));
      const close = button("icon-button", "", () => { hidePreview(); open.focus({ preventScroll: true }); });
      close.setAttribute("aria-label", "Закрыть"); close.title = "Закрыть";
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      icon.classList.add("ui-icon"); icon.setAttribute("aria-hidden", "true"); use.setAttribute("href", "#icon-close"); icon.append(use); close.append(icon);
      actions.append(close);
      preview.append(actions);
      if (entry.task.studyEvent) preview.append(element("span", "", [entry.task.studyEvent.teacher, entry.task.studyEvent.room].filter(Boolean).join(" · ")));
      const bounds = preview.getBoundingClientRect();
      preview.style.left = `${Math.max(12, Math.min(node.getBoundingClientRect().left, global.innerWidth - bounds.width - 12))}px`;
      preview.style.top = `${Math.max(12, Math.min(parseFloat(preview.style.top), global.innerHeight - bounds.height - 12))}px`;
    }
    function chooseNearbyEvents(event) {
      if (!mobile() || !event.detail || event.target.closest?.(".calendar-event-check, .calendar-event-resize")) return;
      const day = event.target.closest?.(".calendar-time-day");
      const card = event.target.closest?.(".calendar-time-event");
      if (!day || (card && !card.classList.contains("is-short"))) return;
      const candidates = [...eventActions.values()].filter((item) => {
        if (item.node.parentElement !== day) return false;
        const rect = item.node.getBoundingClientRect();
        const padding = item.node.classList.contains("is-short") ? 16 : 0;
        return event.clientX >= rect.left - 4 && event.clientX <= rect.right + 4
          && event.clientY >= rect.top - padding && event.clientY <= rect.bottom + padding;
      }).sort((a, b) => a.entry.minutes - b.entry.minutes);
      if (!candidates.length) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (candidates.length === 1) {
        const item = candidates[0]; showEventActions(item.node, item.open, item.entry, item.date); return;
      }
      const first = candidates[0];
      showPreview(first.node, first.open, first.entry, true);
      interactivePreview = true; preview.classList.add("is-interactive");
      preview.setAttribute("role", "dialog"); preview.setAttribute("aria-label", "События рядом");
      preview.replaceChildren(element("strong", "", "События рядом"));
      candidates.forEach((item) => {
        const select = button("calendar-event-choice", "", () => showEventActions(item.node, item.open, item.entry, item.date));
        select.append(element("small", "", item.entry.timeLabel), element("span", "", item.entry.title)); preview.append(select);
      });
      const close = button("ghost-button compact-button", "Закрыть", hidePreview); preview.append(close);
    }
    document.addEventListener("pointerdown", (event) => {
      if (interactivePreview && !preview.contains(event.target) && !previewOwner?.contains(event.target)) hidePreview();
      if (!touchBusy && !event.target.closest?.(".calendar-time-event, .calendar-touch-selection, .calendar-event-preview")) clearSelection();
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") hidePreview(); });
    function blockHeight(start, end) {
      return Math.max(2, (Math.min(1440, end) - start) / 60 * hourHeight - 1);
    }
    function sizeCard(node, height) {
      node.style.height = `${height}px`;
      node.classList.toggle("is-short", height < 46);
      node.classList.toggle("is-tiny", height < 18);
    }
    function clearSelection() {
      selectedEvent = null;
      root.querySelectorAll(".is-touch-selected").forEach((node) => node.classList.remove("is-touch-selected"));
      root.querySelector(".calendar-touch-selection")?.remove();
    }
    function selectEvent(card) {
      clearSelection();
      selectedEvent = { id: card.dataset.eventId, date: card.dataset.date };
      card.classList.add("is-touch-selected");
      const status = element("div", "calendar-touch-selection");
      status.setAttribute("role", "status");
      const label = element("span", "", card.querySelector(".calendar-event-open small").textContent);
      label.className = "calendar-selection-time";
      status.append(label, button("ghost-button compact-button", "Готово", clearSelection));
      root.querySelector(".calendar-time-scroll").before(status);
    }
    function closeExpanded() {
      if (!expanded) return;
      rememberViewport();
      expanded = false; untimedOpen = false; clearSelection(); hidePreview();
      root.classList.remove("is-expanded");
      document.body.classList.remove("has-expanded-calendar");
      document.body.style.overflow = previousOverflow;
      home.after(root);
      render(lastMode);
      if (pagePosition) global.scrollTo(pagePosition.x, pagePosition.y);
      (returnFocus?.isConnected ? returnFocus : root.querySelector(".calendar-expand-button"))?.focus({ preventScroll: true });
    }
    async function requestExit() {
      if (exitPending) return;
      exitPending = true;
      if (await ctx.confirmClose?.() === false) { exitPending = false; return; }
      exitApproved = true;
      if (global.history.state?.calendarExpanded) global.history.back();
      else { closeExpanded(); exitApproved = false; exitPending = false; }
    }
    function expand() {
      if (expanded) return;
      rememberViewport();
      expanded = true;
      returnFocus = document.activeElement;
      pagePosition = { x: global.scrollX, y: global.scrollY };
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.body.classList.add("has-expanded-calendar");
      root.classList.add("is-expanded");
      document.body.append(root);
      global.history.pushState({ ...global.history.state, calendarExpanded: true }, "", global.location.href);
      render(lastMode);
      root.querySelector(".calendar-exit-button")?.focus({ preventScroll: true });
    }
    global.addEventListener("popstate", async (event) => {
      if (!expanded) return;
      event.stopImmediatePropagation();
      const url = `${global.location.pathname}${global.location.search}#calendar/${lastMode}`;
      const accepted = exitApproved || await ctx.confirmClose?.() !== false;
      if (accepted) {
        global.history.replaceState({ ...global.history.state, calendarExpanded: false, overviewMode: lastMode }, "", url);
        closeExpanded();
      } else global.history.pushState({ ...global.history.state, calendarExpanded: true }, "", url);
      exitPending = false; exitApproved = false;
    });
    // This is an app view, not browser fullscreen: task editors remain available above it.
    new MutationObserver(() => {
      if (expanded && document.body.dataset.view !== "overview") {
        global.history.replaceState({ ...global.history.state, calendarExpanded: false }, "");
        closeExpanded();
      }
    }).observe(document.body, { attributes: true, attributeFilter: ["data-view"] });
    document.addEventListener("keydown", (event) => {
      if (!expanded || document.body.classList.contains("has-floating-task-form") || document.querySelector("dialog[open], .confirm-modal:not([hidden])")) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (interactivePreview) hidePreview();
        else if (selectedEvent) clearSelection();
        else if (untimedOpen) { untimedOpen = false; render(lastMode); root.querySelector(".calendar-untimed-jump")?.focus(); }
        else if (root.querySelector("details[open]")) root.querySelector("details[open]").open = false;
        else requestExit();
      }
      if (event.key === "Tab") {
        const scope = interactivePreview ? preview : untimedOpen ? root.querySelector(".calendar-untimed") : root;
        const items = [...scope.querySelectorAll("button, input, select, summary, [tabindex='0']")].filter((node) => !node.disabled && node.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    }, true);
    function centerSelection() {
      const scroller = root.querySelector(".calendar-time-scroll");
      const selected = scroller?.querySelector(`.calendar-time-day[data-date="${ctx.getActiveDate()}"]`);
      if (selected && scroller.clientWidth < scroller.scrollWidth) scroller.scrollLeft = Math.max(0, selected.parentElement.offsetLeft - 48);
    }
    global.addEventListener("resize", () => {
      if (root.hidden) return;
      if (touchBusy) return;
      if (renderedWidth === global.innerWidth) { fitMobileViewport(); return; }
      if (!resizing) {
        global.cancelAnimationFrame(resizeFrame);
        resizeFrame = global.requestAnimationFrame(() => { render(lastMode); centerSelection(); });
        return;
      }
      centerSelection();
    });

    root.addEventListener("click", (event) => {
      if (touchBusy || (event.detail && performance.now() < suppressClickUntil)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    root.addEventListener("click", chooseNearbyEvents, true);

    function fitMobileViewport() {
      const scroller = root.querySelector(".calendar-time-scroll");
      if (mobile() && scroller) root.style.setProperty("--calendar-mobile-top", `${Math.max(12, scroller.getBoundingClientRect().top + global.scrollY)}px`);
      if (scroller) root.style.setProperty("--calendar-grid-bottom", `${Math.max(0, root.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom)}px`);
    }
    function rememberViewport() {
      const scroller = root.querySelector(".calendar-time-scroll");
      if (scroller) preservedViewport = { key: viewportKey, hour: scroller.scrollTop / hourHeight, left: scroller.scrollLeft };
    }

    function setZoom(next, anchorY) {
      const scroller = root.querySelector(".calendar-time-scroll");
      if (!scroller) return;
      const oldHeight = hourHeight;
      const nextHeight = zoomHeight(next);
      const top = anchoredScroll(scroller.scrollTop, oldHeight, nextHeight, anchorY ?? scroller.clientHeight / 2);
      hourHeight = nextHeight;
      if (mobile()) mobileHourHeight = nextHeight;
      else desktopHourHeight = nextHeight;
      root.style.setProperty("--calendar-hour-height", `${nextHeight}px`);
      root.querySelectorAll(".calendar-time-event").forEach((node) => {
        const start = Number(node.dataset.startMinute);
        const height = blockHeight(start, start + Number(node.dataset.visualDuration));
        sizeCard(node, height);
        node.style.top = `${Math.min(start / 60 * nextHeight, 24 * nextHeight - height)}px`;
      });
      root.querySelectorAll(".calendar-now-line").forEach((node) => { node.style.top = `${Number(node.dataset.minute) / 60 * nextHeight}px`; });
      scroller.scrollTop = top;
      scrollHour = top / nextHeight;
      const label = root.querySelector(".calendar-zoom-value");
      if (label) label.textContent = `${Math.round(nextHeight / MOBILE_HOUR_HEIGHT * 100)}%`;
    }

    function saveZoom() {
      try { global.localStorage?.setItem(ZOOM_STORAGE, String(mobileHourHeight)); } catch { /* Keep the gesture usable when storage is unavailable. */ }
    }

    function bindTouch(scroller) {
      let pinch = null, contact = null, moving = null, holdTimer, autoFrame;
      const distance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
      const midpoint = (touches) => (touches[0].clientY + touches[1].clientY) / 2 - scroller.getBoundingClientRect().top;
      const clearHold = () => { clearTimeout(holdTimer); holdTimer = null; };
      const restoreMove = () => {
        global.cancelAnimationFrame(autoFrame);
        if (moving) {
          moving.node.classList.remove("is-touch-moving"); moving.node.style.top = moving.top;
          sizeCard(moving.node, moving.height); moving.label.textContent = moving.timeLabel;
        }
        moving = null;
      };
      const moveCard = (y) => {
        if (!moving) return;
        moving.y = y;
        const delta = (y - contact.y + scroller.scrollTop - contact.scroll) / hourHeight * 60;
        if (moving.edge === "start") moving.minute = Math.max(0, Math.min(Math.floor((moving.end - 15) / 15) * 15, Math.round((moving.start + delta) / 15) * 15));
        else if (moving.edge === "end") moving.endMinute = Math.max(moving.start + 15, Math.min(DAY_END, Math.round((moving.end + delta) / 15) * 15));
        else moving.minute = Math.max(0, Math.min(Math.floor((DAY_END - moving.duration) / 15) * 15, Math.round((moving.start + delta) / 15) * 15));
        const end = moving.edge ? moving.endMinute : moving.minute + moving.duration;
        moving.node.style.top = `${moving.minute / 60 * hourHeight}px`;
        sizeCard(moving.node, blockHeight(moving.minute, end));
        moving.label.textContent = `${time(moving.minute)}–${time(end)}`;
        const label = root.querySelector(".calendar-selection-time");
        if (label) label.textContent = moving.label.textContent;
      };
      const autoScroll = () => {
        if (!moving) return;
        const bounds = scroller.getBoundingClientRect();
        const delta = !moving.hasMoved ? 0 : moving.y < bounds.top + 90 ? -6 : moving.y > bounds.bottom - 60 ? 6 : 0;
        if (delta) { scroller.scrollTop += delta; moveCard(moving.y); }
        autoFrame = global.requestAnimationFrame(autoScroll);
      };
      const start = (event) => {
        if (!mobile()) return;
        if (event.touches.length >= 2) {
          event.preventDefault(); clearHold(); restoreMove(); clearSelection(); hidePreview(); touchBusy = true;
          const y = midpoint(event.touches);
          pinch = { distance: Math.max(1, distance(event.touches)), height: hourHeight, scroll: scroller.scrollTop, y };
          return;
        }
        if (touchBusy) { event.preventDefault(); return; }
        const touch = event.touches[0];
        contact = { x: touch.clientX, y: touch.clientY, scroll: scroller.scrollTop };
        const card = event.target.closest?.(".calendar-time-event:not(.is-lesson)");
        const handle = event.target.closest?.(".calendar-event-resize");
        const begin = (edge = null) => {
          const startMinute = Number(card.dataset.startMinute);
          moving = { node: card, top: card.style.top, start: startMinute, minute: startMinute,
            duration: Number(card.dataset.visualDuration), label: card.querySelector(".calendar-event-open small"), y: contact.y,
            height: parseFloat(card.style.height), edge };
          moving.end = startMinute + moving.duration; moving.endMinute = moving.end;
          moving.timeLabel = moving.label.textContent;
          selectEvent(card);
          card.classList.add("is-touch-moving"); hidePreview(); touchBusy = true; autoScroll();
        };
        if (!card || event.target.closest?.(".calendar-event-check")) return;
        if (handle) {
          if (!card.classList.contains("is-touch-selected")) return;
          event.preventDefault(); begin(handle.dataset.edge); return;
        }
        holdTimer = setTimeout(() => begin(), 450);
      };
      const move = (event) => {
        if (!mobile()) return;
        if (pinch && event.touches.length >= 2) {
          event.preventDefault();
          const y = midpoint(event.touches);
          // Anchor to the initial content point, so successive frames cannot accumulate drift.
          setZoom(pinch.height * distance(event.touches) / pinch.distance, y);
          scroller.scrollTop = anchoredScroll(pinch.scroll, pinch.height, hourHeight, pinch.y) + pinch.y - y;
          return;
        }
        if (moving) {
          event.preventDefault();
          moving.hasMoved ||= Math.hypot(event.touches[0].clientX - contact.x, event.touches[0].clientY - contact.y) > 8;
          if (moving.hasMoved) moveCard(event.touches[0].clientY);
          return;
        }
        if (touchBusy) { event.preventDefault(); return; }
        if (contact && Math.hypot(event.touches[0].clientX - contact.x, event.touches[0].clientY - contact.y) > 8) {
          clearHold(); suppressClickUntil = performance.now() + 350;
        }
      };
      const end = (event) => {
        clearHold();
        if (touchBusy) { if (event.cancelable) event.preventDefault(); suppressClickUntil = performance.now() + 450; }
        if (pinch) { saveZoom(); pinch = null; }
        if (moving) {
          const result = moving;
          restoreMove();
          if (event.type !== "touchcancel" && (result.minute !== result.start || result.endMinute !== result.end)) {
            if (result.edge) ctx.resizeTask(result.node.dataset.eventId, result.node.dataset.date, time(result.minute), time(result.endMinute));
            else ctx.scheduleTask(result.node.dataset.eventId, result.node.dataset.date, result.node.dataset.date, time(result.minute));
          } else {
            const label = root.querySelector(".calendar-selection-time");
            if (label) label.textContent = result.timeLabel;
          }
        }
        if (!event.touches.length) { contact = null; touchBusy = false; }
      };
      scroller.addEventListener("touchstart", start, { passive: false });
      scroller.addEventListener("touchmove", move, { passive: false });
      scroller.addEventListener("touchend", end, { passive: false });
      scroller.addEventListener("touchcancel", end, { passive: false });
      return () => { clearHold(); restoreMove(); touchBusy = false; };
    }

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function button(className, text, onClick) {
      const node = element("button", className, text);
      node.type = "button";
      node.addEventListener("click", onClick);
      return node;
    }
    function iconButton(symbol, label, onClick, className = "") {
      const control = button(`icon-button ${className}`, "", onClick);
      control.setAttribute("aria-label", label); control.title = label;
      control.dataset.calendarFocus = label;
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      icon.classList.add("ui-icon"); icon.setAttribute("aria-hidden", "true");
      use.setAttribute("href", `#icon-${symbol}`); icon.append(use); control.append(icon);
      return control;
    }

    function modelFor(date) {
      const lessons = (ctx.getStudyEvents(date) || []).map((event) => ({
        id: `lesson:${event.id}:${date}`, title: event.title, date, priority: "medium", repeat: "none",
        scheduleMode: "block", startTime: event.startTime, endTime: event.endTime, time: event.endTime,
        studyEvent: event,
      }));
      return layout.buildTimelineModel({ activeDate: date, tasks: [...ctx.getTasks(date), ...lessons],
        formatTime: (value) => value, getCategory: ctx.getCategory, priorityLabels: {},
        isTaskDone: (task) => task.studyEvent ? false : ctx.isTaskDone(task, date), todayKey: ctx.todayKey() });
    }

    function attachDrag(node, task, date) {
      node.draggable = !mobile();
      node.addEventListener("dragstart", (event) => {
        if (event.target.closest?.(".calendar-event-check")) { event.preventDefault(); return; }
        dragged = { taskId: task.id, date };
        event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragged));
        event.dataTransfer.effectAllowed = "move";
        node.classList.add("is-dragging");
      });
      node.addEventListener("dragend", () => {
        dragged = null;
        node.classList.remove("is-dragging");
        root.querySelectorAll(".is-drop-target").forEach((target) => target.classList.remove("is-drop-target"));
      });
    }

    function agendaRow(entry, date, deadline = false) {
      const task = entry.task;
      const node = element("div", `calendar-schedule-agenda-item${entry.done ? " is-done" : ""}${deadline ? " calendar-deadline" : ""}`);
      node.dataset.agendaTaskId = task.id;
      if (!task.studyEvent && (!deadline || task.repeat === "none")) {
        const check = element("input", "calendar-task-check");
        check.type = "checkbox"; check.checked = entry.done;
        check.setAttribute("aria-label", `Выполнено: ${task.title}`);
        check.addEventListener("change", () => ctx.toggleTaskDone(task.id, deadline ? task.date || task.dueDate : date));
        node.append(check);
      }
      const open = button("calendar-agenda-open", "", () => task.studyEvent ? ctx.openLesson(task.studyEvent, date) : ctx.editTask(task, deadline ? task.date || date : date));
      open.append(element("span", "calendar-agenda-time", entry.timeLabel || "Без времени"), element("span", "calendar-agenda-title", task.title));
      if (task.studyEvent) open.lastChild.append(element("small", "calendar-lesson-detail", [task.studyEvent.typeLabel, task.studyEvent.teacher, task.studyEvent.room].filter(Boolean).join(" · ")));
      node.append(open);
      if (!task.studyEvent && !deadline) attachDrag(open, task, date);
      return node;
    }

    function eventCard(entry, date) {
      const task = entry.task;
      const lesson = task.studyEvent;
      const node = element("article", `calendar-time-event${lesson ? " is-lesson" : ""}${entry.done ? " is-done" : ""}${entry.isTimeBlock ? " is-block" : " is-time-marker"}`);
      node.dataset.eventId = task.id;
      const height = blockHeight(entry.minutes, entry.minutes + entry.visualDuration);
      sizeCard(node, height);
      node.dataset.date = date;
      node.dataset.startMinute = entry.minutes;
      node.dataset.visualDuration = entry.visualDuration;
      node.style.top = `${Math.min(entry.minutes / 60 * hourHeight, 24 * hourHeight - height)}px`;
      node.style.left = `calc(${entry.columnIndex / entry.columnCount * 100}% + 3px)`;
      node.style.width = `calc(${100 / entry.columnCount}% - 6px)`;
      if (entry.categoryColor) node.style.setProperty("--event-color", entry.categoryColor);
      if (!lesson) {
        const check = button("calendar-event-check", "", async (event) => {
          event.stopPropagation();
          hidePreview();
          if (resizing) return;
          check.disabled = true;
          try {
            await ctx.toggleTaskDone(task.id, date);
          } finally {
            check.disabled = false;
          }
          [...root.querySelectorAll(".calendar-time-event")].find((card) => card.dataset.eventId === task.id && card.dataset.date === date)
            ?.querySelector(".calendar-event-check")?.focus({ preventScroll: true });
        });
        check.setAttribute("aria-label", `${entry.done ? "Вернуть в работу" : "Выполнить"}: ${task.title}`);
        check.setAttribute("aria-pressed", String(entry.done));
        check.title = entry.done ? "Вернуть в работу" : "Выполнить задачу";
        check.draggable = false;
        check.addEventListener("pointerdown", (event) => event.stopPropagation());
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        icon.classList.add("ui-icon"); icon.setAttribute("aria-hidden", "true");
        use.setAttribute("href", "#icon-check"); icon.append(use); check.append(icon);
        node.append(check);
      }
      const open = button("calendar-event-open", "", () => {
        if (!resizing && mobile()) { showEventActions(node, open, entry, date); return; }
        hidePreview();
        if (!resizing) lesson ? ctx.openLesson(lesson, date) : ctx.editTask(task, date);
      });
      if (height >= 46) open.title = `${entry.timeLabel} · ${task.title}`;
      open.append(element("small", "", entry.timeLabel), element("strong", "", task.title));
      if (lesson) open.append(element("small", "", [lesson.typeLabel, lesson.room].filter(Boolean).join(" · ")));
      node.append(open);
      eventActions.set(node, { node, open, entry, date });
      open.addEventListener("mouseenter", () => showPreview(node, open, entry));
      open.addEventListener("mouseleave", () => { if (!interactivePreview && document.activeElement !== open) hidePreview(); });
      open.addEventListener("focus", () => { if (!interactivePreview) showPreview(node, open, entry); });
      open.addEventListener("blur", (event) => { if (!interactivePreview || !preview.contains(event.relatedTarget)) hidePreview(); });
      if (!lesson) {
        attachDrag(node, task, date);
        if (entry.isTimeBlock) {
          for (const edge of ["start", "end"]) {
            const handle = button(`calendar-event-resize is-${edge}`, "", (event) => event.stopPropagation());
            handle.dataset.edge = edge;
            handle.setAttribute("aria-label", `${edge === "start" ? "Изменить начало" : "Изменить длительность"}: ${task.title}`);
            handle.title = edge === "start" ? "Изменить начало" : "Изменить окончание";
            handle.draggable = false;
            handle.addEventListener("dragstart", (event) => event.preventDefault());
            handle.addEventListener("keydown", async (event) => {
              if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              const delta = event.key === "ArrowUp" ? -15 : 15;
              const start = edge === "start" ? Math.max(0, Math.min(entry.endMinutes - 15, entry.minutes + delta)) : entry.minutes;
              const end = edge === "end" ? Math.min(DAY_END, Math.max(entry.minutes + 15, entry.endMinutes + delta)) : entry.endMinutes;
              const changed = await ctx.resizeTask(task.id, date, time(start), time(end));
              if (changed) [...root.querySelectorAll(".calendar-time-event")].find((card) => card.dataset.eventId === task.id && card.dataset.date === date)?.querySelector(`.calendar-event-resize.is-${edge}`)?.focus({ preventScroll: true });
            });
            handle.addEventListener("pointerdown", (event) => {
              if (event.button !== 0 || event.pointerType === "touch") return;
              event.preventDefault(); event.stopPropagation();
              hidePreview();
              const initialY = event.clientY;
              let start = entry.minutes, end = entry.endMinutes;
              resizing = true;
              handle.setPointerCapture(event.pointerId);
              const move = (pointer) => {
                const delta = (pointer.clientY - initialY) / hourHeight * 60;
                if (edge === "start") start = Math.max(0, Math.min(end - 15, layout.snapMinutes(entry.minutes + delta)));
                else end = Math.min(DAY_END, Math.max(start + 15, layout.snapMinutes(entry.endMinutes + delta)));
                node.style.top = `${start / 60 * hourHeight}px`;
                sizeCard(node, blockHeight(start, end));
                open.querySelector("small").textContent = `${time(start)}–${time(end)}`;
              };
              const stop = (pointer) => {
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", finish);
                handle.removeEventListener("pointercancel", cancel);
                if (handle.hasPointerCapture(pointer.pointerId)) handle.releasePointerCapture(pointer.pointerId);
                setTimeout(() => { resizing = false; }, 0);
              };
              const cancel = (pointer) => { stop(pointer); node.style.top = `${entry.minutes / 60 * hourHeight}px`; sizeCard(node, height); open.querySelector("small").textContent = entry.timeLabel; };
              const finish = (pointer) => { cancel(pointer); if (start !== entry.minutes || end !== entry.endMinutes) ctx.resizeTask(task.id, date, time(start), time(end)); };
              handle.addEventListener("pointermove", move);
              handle.addEventListener("pointerup", finish, { once: true });
              handle.addEventListener("pointercancel", cancel, { once: true });
            });
            node.append(handle);
          }
        }
      }
      return node;
    }

    function render(mode) {
      const focusedControl = root.contains(document.activeElement) ? document.activeElement.dataset.calendarFocus : null;
      disposeTouch();
      menuController?.abort();
      menuController = new AbortController();
      if (layerHome && layerToggle.parentElement !== layerHome) layerHome.insertBefore(layerToggle, layerSibling);
      hidePreview();
      root.hidden = !["day", "week"].includes(mode);
      if (root.hidden) {
        if (expanded) { closeExpanded(); root.hidden = true; }
        return;
      }
      lastMode = mode;
      const date = ctx.getActiveDate();
      const dates = mode === "day" ? [date] : ctx.getWeekDates(date);
      const models = dates.map(modelFor);
      const key = `${mode}:${dates[0]}:${date}`;
      const existing = root.querySelector(".calendar-time-scroll");
      if (existing && viewportKey === key) { scrollHour = existing.scrollTop / hourHeight; scrollLeft = existing.scrollLeft; }
      if (preservedViewport?.key === key) { scrollHour = preservedViewport.hour; scrollLeft = preservedViewport.left; }
      preservedViewport = null;
      if (key !== viewportKey) {
        const first = models[dates.indexOf(date)].timedTasks[0]?.minutes;
        scrollHour = date === ctx.todayKey() ? Math.max(0, new Date().getHours() - 1) : Math.max(0, (first ?? 540) / 60 - 1);
        scrollLeft = 0;
      }
      viewportKey = key;
      root.replaceChildren();
      eventActions.clear();
      const toolbar = element("div", "calendar-schedule-toolbar");
      const period = element("span", "calendar-schedule-period", mode === "day" ? ctx.formatLongDate(date) : `${ctx.formatShortDate(dates[0])} — ${ctx.formatShortDate(dates[6])}`);
      const controls = element("div", "calendar-schedule-controls");
      const nowButton = button("ghost-button compact-button", expanded ? "Сегодня" : "Сейчас", async () => {
        const today = ctx.todayKey();
        if (await ctx.selectDate(today) === false) return;
        const scroller = root.querySelector(".calendar-time-scroll");
        const current = new Date();
        scroller.scrollTop = Math.max(0, current.getHours() - 1) * hourHeight;
        const currentColumn = scroller.querySelector(`.calendar-time-day[data-date="${today}"]`);
        if (currentColumn) scroller.scrollLeft = Math.max(0, currentColumn.parentElement.offsetLeft - 48);
      });
      nowButton.dataset.calendarFocus = "today";
      controls.append(nowButton);
      if (mobile() || expanded) {
        const menu = element("details", "calendar-touch-options");
        const toggle = element("summary", "icon-button");
        toggle.setAttribute("aria-label", "Настройки календаря и масштаб часов"); toggle.title = "Настройки календаря и масштаб часов";
        const toggleIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const toggleUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
        toggleIcon.classList.add("ui-icon"); toggleIcon.setAttribute("aria-hidden", "true"); toggleUse.setAttribute("href", "#icon-settings"); toggleIcon.append(toggleUse); toggle.append(toggleIcon);
        const options = element("div", "calendar-touch-options-panel");
        options.append(element("span", "", "Масштаб часов"));
        const zoom = element("div", "calendar-touch-zoom");
        const zoomButton = (symbol, label, change) => {
          const control = button("icon-button", "", () => { setZoom(change()); saveZoom(); });
          const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
          icon.classList.add("ui-icon"); icon.setAttribute("aria-hidden", "true"); use.setAttribute("href", `#icon-${symbol}`); icon.append(use); control.append(icon);
          control.setAttribute("aria-label", label); control.title = label; return control;
        };
        const value = button("calendar-zoom-value", `${Math.round((mobile() ? mobileHourHeight : hourHeight) / MOBILE_HOUR_HEIGHT * 100)}%`, () => { setZoom(mobile() ? MOBILE_HOUR_HEIGHT : HOUR_HEIGHT); saveZoom(); });
        value.setAttribute("aria-label", "Сбросить масштаб часов"); value.title = "Сбросить масштаб часов";
        zoom.append(zoomButton("minus", "Уменьшить масштаб часов", () => hourHeight / 1.25), value, zoomButton("plus", "Увеличить масштаб часов", () => hourHeight * 1.25));
        options.append(zoom);
        if (mode === "week") {
          const viewLabel = element("label", "calendar-days-option", "Показать");
          const viewSelect = element("select"); viewSelect.setAttribute("aria-label", "Количество дней в сетке");
          [["day", "Выбранный день"], ["three", "3 дня"], ["week", "Всю неделю"]].forEach(([value, label]) => viewSelect.add(new Option(label, value)));
          viewSelect.value = fullMobileWeek ? "week" : threeMobileDays ? "three" : "day";
          viewSelect.addEventListener("change", () => { fullMobileWeek = viewSelect.value === "week"; threeMobileDays = viewSelect.value === "three"; render(mode); centerSelection(); });
          viewLabel.append(viewSelect); options.append(viewLabel);
        }
        if (layerToggle) options.append(layerToggle);
        menu.append(toggle, options); controls.append(menu);
        document.addEventListener("pointerdown", (event) => { if (!menu.contains(event.target)) menu.open = false; }, { signal: menuController.signal });
        document.addEventListener("keydown", (event) => { if (event.key === "Escape" && menu.open) { menu.open = false; toggle.focus(); } }, { signal: menuController.signal });
      }
      if (mode === "week" && mobile() && !expanded) {
        const overview = button("ghost-button compact-button calendar-week-toggle", fullMobileWeek || threeMobileDays ? "Выбранный день" : "Все дни", () => { fullMobileWeek = !(fullMobileWeek || threeMobileDays); threeMobileDays = false; render(mode); });
        overview.setAttribute("aria-pressed", String(fullMobileWeek)); controls.append(overview);
      }
      if (expanded) {
        const navigation = element("div", "calendar-expanded-date");
        const shift = (direction) => {
          const value = new Date(`${ctx.getActiveDate()}T12:00:00`);
          value.setDate(value.getDate() + direction * (lastMode === "week" ? 7 : 1));
          const dateKey = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
          ctx.selectDate(dateKey);
        };
        navigation.append(iconButton("chevron-left", mode === "week" ? "Предыдущая неделя" : "Предыдущий день", () => shift(-1)), period,
          iconButton("chevron-right", mode === "week" ? "Следующая неделя" : "Следующий день", () => shift(1)));
        const modes = element("div", "segmented-control calendar-expanded-modes");
        modes.setAttribute("aria-label", "Период календаря");
        for (const [value, label] of [["day", "День"], ["week", "Неделя"]]) {
          const item = button(value === mode ? "is-active" : "", label, async () => {
            if (await ctx.changeMode(value) !== false) global.history.replaceState({ ...global.history.state, calendarExpanded: true }, "");
            root.querySelector(".calendar-expanded-modes .is-active")?.focus({ preventScroll: true });
          });
          item.dataset.calendarFocus = value;
          item.setAttribute("aria-pressed", String(value === mode)); modes.append(item);
        }
        toolbar.append(iconButton("close", "Свернуть календарь", requestExit, "calendar-exit-button"), navigation, modes, controls);
      } else {
        controls.append(iconButton("maximize", "Развернуть календарь", expand, "calendar-expand-button"));
        toolbar.append(period, controls);
      }
      root.append(toolbar);
      const selectedModel = models[dates.indexOf(date)];
      const due = ctx.getState().tasks.filter((task) => task.dueDate === date);
      if (selectedModel.unscheduledTasks.length || due.length) {
        const description = [selectedModel.unscheduledTasks.length ? `Без времени · ${selectedModel.unscheduledTasks.length}` : "", due.length ? `Сроки · ${due.length}` : ""].filter(Boolean).join(" · ");
        const jump = button("calendar-untimed-jump", expanded && mobile() ? `Дела · ${new Set([...selectedModel.unscheduledTasks.map((entry) => entry.task.id), ...due.map((task) => task.id)]).size}` : description, () => {
          const section = root.querySelector(".calendar-untimed");
          if (expanded) {
            untimedOpen = !untimedOpen; root.classList.toggle("has-untimed-panel", untimedOpen);
            jump.setAttribute("aria-expanded", String(untimedOpen));
            if (untimedOpen) section?.querySelector(".calendar-untimed-close")?.focus({ preventScroll: true });
          } else { section?.scrollIntoView({ block: "start", behavior: "smooth" }); section?.focus({ preventScroll: true }); }
        });
        jump.setAttribute("aria-label", `${jump.textContent}. ${description}`); jump.title = description; jump.dataset.calendarFocus = "untimed";
        jump.setAttribute("aria-expanded", String(expanded && untimedOpen));
        controls.prepend(jump);
      }
      if (expanded && !selectedModel.unscheduledTasks.length && !due.length) untimedOpen = false;
      root.classList.toggle("has-untimed-panel", expanded && untimedOpen);
      if (mode === "week" && mobile()) {
        const strip = element("nav", "calendar-week-strip"); strip.setAttribute("aria-label", "Дни недели и занятость");
        dates.forEach((day, index) => {
          const count = models[index].timedTasks.length + models[index].unscheduledTasks.length;
          const dueCount = ctx.getState().tasks.filter((task) => task.dueDate === day).length;
          const item = button(`calendar-week-strip-day${day === date ? " is-selected" : ""}`, "", () => ctx.selectDate(day));
          item.append(element("small", "", weekdayFormatter.format(new Date(`${day}T12:00:00`))), " ", element("strong", "", String(new Date(`${day}T12:00:00`).getDate())), " ", element("span", "", count ? `${count}` : "—"));
          item.classList.toggle("has-deadlines", dueCount > 0); item.setAttribute("aria-pressed", String(day === date));
          item.setAttribute("aria-label", `${item.textContent}. ${ctx.formatLongDate(day)}: ${count} дел и занятий, ${dueCount} сроков сдачи`);
          strip.append(item);
        });
        root.append(strip);
      }
      const scroller = element("div", "calendar-time-scroll");
      scroller.tabIndex = 0;
      scroller.setAttribute("aria-label", mode === "day" ? "Часы дня" : "Часы недели");
      scroller.addEventListener("scroll", () => {
        if (!interactivePreview || !previewScroll || scroller.scrollTop !== previewScroll.top || scroller.scrollLeft !== previewScroll.left) hidePreview();
      }, { passive: true });
      root.append(scroller);
      // Keep the hour scale readable; CSS owns the viewport height independently of the page header.
      fitMobileViewport();
      hourHeight = mobile() ? mobileHourHeight : expanded ? hourHeight : Math.max(desktopHourHeight, ((scroller.clientHeight || 528) - 48) / 12);
      root.style.setProperty("--calendar-hour-height", `${hourHeight}px`);
      const grid = element("div", `calendar-time-grid is-${mode}${mode === "week" && mobile() && !fullMobileWeek ? threeMobileDays ? " is-three-days" : " is-compact-week" : ""}`);
      grid.style.setProperty("--calendar-days", dates.length);
      const rail = element("div", "calendar-hour-rail");
      const corner = element("div", "calendar-time-corner"); corner.setAttribute("aria-hidden", "true");
      rail.append(corner);
      for (let hour = 0; hour < 24; hour++) rail.append(element("span", "calendar-hour-label", time(hour * 60)));
      grid.append(rail);
      dates.forEach((day, index) => {
        const column = element("div", "calendar-time-column");
        column.classList.toggle("is-selected", day === date);
        const rangeStart = Math.min(4, Math.max(0, dates.indexOf(date) - 1));
        column.classList.toggle("is-in-range", index >= rangeStart && index < rangeStart + 3);
        const heading = button(`calendar-time-heading${day === date ? " is-selected" : ""}${day === ctx.todayKey() ? " is-today" : ""}`, ctx.formatShortDate(day), () => ctx.selectDate(day));
        heading.prepend(element("small", "", weekdayFormatter.format(new Date(`${day}T12:00:00`))), " ");
        heading.setAttribute("aria-label", `${heading.textContent}. ${ctx.formatLongDate(day)}`);
        heading.setAttribute("aria-pressed", String(day === date));
        column.append(heading);
        const hours = element("div", "calendar-time-day"); hours.dataset.date = day;
        for (let hour = 0; hour < 24; hour++) {
          const minuteAt = (event) => event.type === "click" && !event.detail ? hour * 60 : quarterMinute(event.clientY - hours.getBoundingClientRect().top, hourHeight);
          const slot = button("calendar-hour-slot", "", (event) => {
            const start = minuteAt(event);
            ctx.createTask(day, time(start), time(Math.min(DAY_END, start + 60)));
          });
          slot.dataset.time = time(hour * 60);
          slot.setAttribute("aria-label", `Новая задача · ${ctx.formatLongDate(day)} · ${time(hour * 60)}`);
          const highlightQuarter = (event) => {
            const minute = minuteAt(event);
            slot.style.setProperty("--slot-quarter", `${(minute % 60) / 60 * 100}%`);
            slot.title = `Новая задача · ${time(minute)}`;
          };
          slot.addEventListener("pointermove", highlightQuarter);
          slot.addEventListener("dragover", (event) => {
            if (!dragged || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
            event.preventDefault(); highlightQuarter(event); event.dataTransfer.dropEffect = "move"; slot.classList.add("is-drop-target");
          });
          slot.addEventListener("dragleave", () => slot.classList.remove("is-drop-target"));
          slot.addEventListener("drop", (event) => {
            event.preventDefault(); slot.classList.remove("is-drop-target");
            if (!dragged) return;
            ctx.scheduleTask(dragged.taskId, dragged.date, day, time(minuteAt(event)));
            dragged = null;
          });
          hours.append(slot);
        }
        models[index].timedTasks.forEach((entry) => hours.append(eventCard(entry, day)));
        const line = models[index].nowLine;
        if (line) {
          const now = element("div", "calendar-now-line");
          now.dataset.minute = (line.hour + line.offsetPercent / 100) * 60;
          now.style.top = `${(line.hour + line.offsetPercent / 100) * hourHeight}px`;
          now.setAttribute("aria-hidden", "true"); hours.append(now);
        }
        column.append(hours); grid.append(column);
      });
      scroller.append(grid);
      disposeTouch = bindTouch(scroller);
      scroller.scrollTop = scrollHour * hourHeight; scroller.scrollLeft = scrollLeft;
      if (mode === "week" && (key !== existing?.dataset.period || renderedWidth !== global.innerWidth)) {
        const selectedColumn = scroller.querySelectorAll(".calendar-time-column")[dates.indexOf(date)];
        if (selectedColumn && scroller.clientWidth < grid.scrollWidth) scroller.scrollLeft = selectedColumn.offsetLeft - 48;
      }
      scroller.dataset.period = key;
      renderedWidth = global.innerWidth;

      if (selectedModel.unscheduledTasks.length || due.length) {
        const untimed = element("section", "calendar-untimed");
        untimed.tabIndex = -1;
        untimed.setAttribute("aria-label", "Дела без времени и сроки выбранного дня");
        const heading = element("div", "calendar-untimed-heading");
        heading.append(element("h3", "", "Без времени и сроки"));
        if (expanded) heading.append(iconButton("close", "Закрыть дела без времени", () => {
          untimedOpen = false; root.classList.remove("has-untimed-panel");
          const jump = root.querySelector(".calendar-untimed-jump"); jump?.setAttribute("aria-expanded", "false"); jump?.focus();
        }, "calendar-untimed-close"));
        untimed.append(heading);
        const list = element("div", "calendar-untimed-list");
        due.forEach((task) => list.append(agendaRow({ task, done: ctx.isTaskDone(task, task.date || date), timeLabel: `Сдать${task.dueTime ? ` ${task.dueTime}` : ""}` }, date, true)));
        selectedModel.unscheduledTasks.forEach((entry) => list.append(agendaRow(entry, date)));
        untimed.append(list); root.append(untimed);
      }

      const timedTasks = selectedModel.timedTasks.filter((entry) => !entry.task.studyEvent);
      const agenda = element("section", "calendar-selected-agenda");
      const agendaHeading = element("div", "calendar-agenda-heading");
      const addTask = button("icon-button", "", () => ctx.createTask(date));
      const addIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const addUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
      addIcon.classList.add("ui-icon");
      addIcon.setAttribute("aria-hidden", "true");
      addUse.setAttribute("href", "#icon-plus");
      addIcon.appendChild(addUse);
      addTask.appendChild(addIcon);
      addTask.title = "Добавить задачу на выбранный день";
      agendaHeading.append(element("h3", "", ctx.formatLongDate(date)), addTask);
      agendaHeading.lastChild.setAttribute("aria-label", "Добавить задачу на выбранный день");
      agenda.append(agendaHeading);
      timedTasks.forEach((entry) => agenda.append(agendaRow(entry, date)));
      if (!selectedModel.timedTasks.length && !selectedModel.unscheduledTasks.length && !due.length) agenda.append(element("p", "muted", "На этот день пока ничего нет"));
      if (timedTasks.length || (!selectedModel.timedTasks.length && !selectedModel.unscheduledTasks.length && !due.length)) root.append(agenda);
      const gaps = freeIntervals(selectedModel.timedTasks).filter((gap) => gap.end - gap.start >= 45);
      if (gaps.length) {
        const available = element("details", "calendar-free-time");
        available.append(element("summary", "", "Окна в расписании"));
        const list = element("div", "calendar-free-time-list");
        gaps.forEach((gap) => list.append(button("ghost-button compact-button", `${time(gap.start)}–${time(gap.end)}`, () => ctx.createTask(date, time(gap.start), time(Math.min(gap.end, gap.start + 60))))));
        available.append(list); root.append(available);
      }
      global.requestAnimationFrame(fitMobileViewport);
      if (selectedEvent) {
        const selected = [...eventActions.values()].find((item) => item.node.dataset.eventId === selectedEvent.id && item.date === selectedEvent.date)?.node;
        if (selected && mobile()) selectEvent(selected);
        else clearSelection();
      }
      if (focusedControl) [...root.querySelectorAll("[data-calendar-focus]")].find((node) => node.dataset.calendarFocus === focusedControl)?.focus({ preventScroll: true });
    }
    return { render };
  }
  const api = { createCalendarSchedule, freeIntervals, quarterMinute, zoomHeight, anchoredScroll };
  global.RhythmCalendarSchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
