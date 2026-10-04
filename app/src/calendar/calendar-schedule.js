(function (global) {
  const layout = global.RhythmTimelineLayout || (typeof require !== "undefined" ? require("../timeline/timeline-layout.js") : null);
  const HOUR_HEIGHT = 96;
  const DRAG_TYPE = "application/x-parsitasks-calendar";

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
    let lastMode = "week";
    let resizeFrame;
    let renderedWidth = 0;
    const preview = element("div", "calendar-event-preview");
    preview.id = "calendarEventPreview";
    preview.setAttribute("role", "tooltip");
    preview.hidden = true;
    document.body.append(preview);
    let previewOwner = null;
    function hidePreview() {
      preview.hidden = true;
      previewOwner?.removeAttribute("aria-describedby");
      previewOwner = null;
    }
    function showPreview(node, open, entry) {
      if (!node.classList.contains("is-short")) return;
      hidePreview();
      preview.replaceChildren(element("strong", "", entry.title), element("span", "", open.querySelector("small").textContent));
      preview.hidden = false;
      const anchor = node.getBoundingClientRect();
      const size = preview.getBoundingClientRect();
      preview.style.left = `${Math.max(12, Math.min(global.innerWidth - size.width - 12, anchor.left))}px`;
      preview.style.top = `${anchor.bottom + size.height + 20 <= global.innerHeight ? anchor.bottom + 8 : Math.max(12, anchor.top - size.height - 8)}px`;
      previewOwner = open;
      open.setAttribute("aria-describedby", preview.id);
    }
    function blockHeight(start, end) {
      return Math.max(2, (Math.min(1440, end) - start) / 60 * hourHeight - 1);
    }
    function sizeCard(node, height) {
      node.style.height = `${height}px`;
      node.classList.toggle("is-short", height < 46);
      node.classList.toggle("is-tiny", height < 18);
    }
    function centerSelection() {
      const scroller = root.querySelector(".calendar-time-scroll");
      const selected = scroller?.querySelector(`.calendar-time-day[data-date="${ctx.getActiveDate()}"]`);
      if (selected && scroller.clientWidth < scroller.scrollWidth) scroller.scrollLeft = Math.max(0, selected.parentElement.offsetLeft - 48);
    }
    global.addEventListener("resize", () => {
      if (root.hidden) return;
      if (!resizing) {
        global.cancelAnimationFrame(resizeFrame);
        resizeFrame = global.requestAnimationFrame(() => { render(lastMode); centerSelection(); });
        return;
      }
      centerSelection();
    });

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
      node.draggable = true;
      node.addEventListener("dragstart", (event) => {
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
      node.style.top = `${Math.min(entry.minutes / 60 * hourHeight, 24 * hourHeight - height)}px`;
      node.style.left = `calc(${entry.columnIndex / entry.columnCount * 100}% + 3px)`;
      node.style.width = `calc(${100 / entry.columnCount}% - 6px)`;
      if (entry.categoryColor) node.style.setProperty("--event-color", entry.categoryColor);
      const open = button("calendar-event-open", "", () => {
        hidePreview();
        if (!resizing) lesson ? ctx.openLesson(lesson, date) : ctx.editTask(task, date);
      });
      open.setAttribute("aria-label", `${entry.timeLabel} · ${task.title}`);
      if (height >= 46) open.title = `${entry.timeLabel} · ${task.title}`;
      open.append(element("small", "", entry.timeLabel), element("strong", "", task.title));
      if (lesson) open.append(element("small", "", [lesson.typeLabel, lesson.room].filter(Boolean).join(" · ")));
      node.append(open);
      open.addEventListener("mouseenter", () => showPreview(node, open, entry));
      open.addEventListener("mouseleave", () => { if (document.activeElement !== open) hidePreview(); });
      open.addEventListener("focus", () => showPreview(node, open, entry));
      open.addEventListener("blur", hidePreview);
      if (!lesson) {
        attachDrag(node, task, date);
        if (entry.isTimeBlock) {
          const handle = button("calendar-event-resize", "", () => {});
          handle.setAttribute("aria-label", `Изменить длительность: ${task.title}`);
          handle.title = "Изменить длительность";
          handle.draggable = false;
          handle.addEventListener("dragstart", (event) => event.preventDefault());
          handle.addEventListener("keydown", async (event) => {
            if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const end = Math.max(entry.minutes + 15, Math.min(layout.TIMELINE_LAST_MINUTE, entry.endMinutes + (event.key === "ArrowUp" ? -15 : 15)));
            const changed = await ctx.resizeTask(task.id, date, time(entry.minutes), time(end));
            if (changed) [...root.querySelectorAll(".calendar-time-event")].find((card) => card.dataset.eventId === task.id && card.dataset.date === date)?.querySelector(".calendar-event-resize")?.focus({ preventScroll: true });
          });
          handle.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            event.preventDefault(); event.stopPropagation();
            hidePreview();
            const initialY = event.clientY;
            let end = entry.endMinutes;
            resizing = true;
            handle.setPointerCapture(event.pointerId);
            const move = (pointer) => {
              end = Math.max(entry.minutes + 15, Math.min(layout.TIMELINE_LAST_MINUTE,
                layout.snapMinutes(entry.endMinutes + (pointer.clientY - initialY) / hourHeight * 60)));
              sizeCard(node, blockHeight(entry.minutes, end));
              open.querySelector("small").textContent = `${time(entry.minutes)}–${time(end)}`;
            };
            const stop = (pointer) => {
              handle.removeEventListener("pointermove", move);
              handle.removeEventListener("pointerup", finish);
              handle.removeEventListener("pointercancel", cancel);
              if (handle.hasPointerCapture(pointer.pointerId)) handle.releasePointerCapture(pointer.pointerId);
              setTimeout(() => { resizing = false; }, 0);
            };
            const cancel = (pointer) => { stop(pointer); sizeCard(node, height); open.querySelector("small").textContent = entry.timeLabel; };
            const finish = (pointer) => { stop(pointer); handle.removeEventListener("pointerup", finish); ctx.resizeTask(task.id, date, time(entry.minutes), time(end)); };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", finish, { once: true });
            handle.addEventListener("pointercancel", cancel, { once: true });
          });
          node.append(handle);
        }
      }
      return node;
    }

    function render(mode) {
      hidePreview();
      root.hidden = !["day", "week"].includes(mode);
      if (root.hidden) return;
      lastMode = mode;
      const date = ctx.getActiveDate();
      const dates = mode === "day" ? [date] : ctx.getWeekDates(date);
      const models = dates.map(modelFor);
      const key = `${mode}:${dates[0]}:${date}`;
      const existing = root.querySelector(".calendar-time-scroll");
      if (existing && viewportKey === key) { scrollHour = existing.scrollTop / hourHeight; scrollLeft = existing.scrollLeft; }
      if (key !== viewportKey) {
        const first = models[dates.indexOf(date)].timedTasks[0]?.minutes;
        scrollHour = date === ctx.todayKey() ? Math.max(0, new Date().getHours() - 1) : Math.max(0, (first ?? 540) / 60 - 1);
        scrollLeft = 0;
      }
      viewportKey = key;
      root.replaceChildren();
      const toolbar = element("div", "calendar-schedule-toolbar");
      const period = element("span", "calendar-schedule-period", mode === "day" ? ctx.formatLongDate(date) : `${ctx.formatShortDate(dates[0])} — ${ctx.formatShortDate(dates[6])}`);
      const controls = element("div", "calendar-schedule-controls");
      const nowButton = button("ghost-button compact-button", "Сейчас", async () => {
        const today = ctx.todayKey();
        if (await ctx.selectDate(today) === false) return;
        const scroller = root.querySelector(".calendar-time-scroll");
        const current = new Date();
        scroller.scrollTop = Math.max(0, current.getHours() - 1) * hourHeight;
        const currentColumn = scroller.querySelector(`.calendar-time-day[data-date="${today}"]`);
        if (currentColumn) scroller.scrollLeft = Math.max(0, currentColumn.parentElement.offsetLeft - 48);
      });
      controls.append(nowButton);
      toolbar.append(period, controls);
      root.append(toolbar);
      const selectedModel = models[dates.indexOf(date)];
      const due = ctx.getState().tasks.filter((task) => task.dueDate === date);
      if (selectedModel.unscheduledTasks.length || due.length) {
        const untimed = element("section", "calendar-untimed");
        untimed.setAttribute("aria-label", "Дела без времени и сроки выбранного дня");
        untimed.append(element("h3", "", "Без времени и сроки"));
        const list = element("div", "calendar-untimed-list");
        due.forEach((task) => list.append(agendaRow({ task, done: ctx.isTaskDone(task, task.date || date), timeLabel: `Сдать${task.dueTime ? ` ${task.dueTime}` : ""}` }, date, true)));
        selectedModel.unscheduledTasks.forEach((entry) => list.append(agendaRow(entry, date)));
        untimed.append(list); root.append(untimed);
      }
      const scroller = element("div", "calendar-time-scroll");
      scroller.tabIndex = 0;
      scroller.setAttribute("aria-label", mode === "day" ? "Часы дня" : "Часы недели");
      scroller.addEventListener("scroll", hidePreview, { passive: true });
      root.append(scroller);
      // A quarter-hour must fit a readable title; preserve the viewed time on resize.
      const navigation = global.innerWidth <= 900 ? document.querySelector(".nav-tabs")?.getBoundingClientRect().height || 72 : 0;
      const top = scroller.getBoundingClientRect().top + global.scrollY;
      const availableHeight = Math.max(240, global.innerHeight - top - navigation - 20);
      scroller.style.height = `${Math.min(scroller.clientHeight || 528, availableHeight)}px`;
      hourHeight = Math.max(HOUR_HEIGHT, ((scroller.clientHeight || 528) - 48) / 12);
      root.style.setProperty("--calendar-hour-height", `${hourHeight}px`);
      const grid = element("div", `calendar-time-grid is-${mode}`);
      grid.style.setProperty("--calendar-days", dates.length);
      const rail = element("div", "calendar-hour-rail");
      const corner = element("div", "calendar-time-corner"); corner.setAttribute("aria-hidden", "true");
      rail.append(corner);
      for (let hour = 0; hour < 24; hour++) rail.append(element("span", "calendar-hour-label", time(hour * 60)));
      grid.append(rail);
      dates.forEach((day, index) => {
        const column = element("div", "calendar-time-column");
        const heading = button(`calendar-time-heading${day === date ? " is-selected" : ""}${day === ctx.todayKey() ? " is-today" : ""}`, ctx.formatShortDate(day), () => ctx.selectDate(day));
        heading.prepend(element("small", "", weekdayFormatter.format(new Date(`${day}T12:00:00`))));
        heading.setAttribute("aria-label", ctx.formatLongDate(day));
        heading.setAttribute("aria-pressed", String(day === date));
        column.append(heading);
        const hours = element("div", "calendar-time-day"); hours.dataset.date = day;
        for (let hour = 0; hour < 24; hour++) {
          const minuteAt = (event) => event.type === "click" && !event.detail ? hour * 60 : quarterMinute(event.clientY - hours.getBoundingClientRect().top, hourHeight);
          const slot = button("calendar-hour-slot", "", (event) => {
            const start = minuteAt(event);
            ctx.createTask(day, time(start), time(Math.min(layout.TIMELINE_LAST_MINUTE, start + 60)));
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
          now.style.top = `${(line.hour + line.offsetPercent / 100) * hourHeight}px`;
          now.setAttribute("aria-hidden", "true"); hours.append(now);
        }
        column.append(hours); grid.append(column);
      });
      scroller.append(grid);
      scroller.scrollTop = scrollHour * hourHeight; scroller.scrollLeft = scrollLeft;
      if (mode === "week" && (key !== existing?.dataset.period || renderedWidth !== global.innerWidth)) {
        const selectedColumn = scroller.querySelectorAll(".calendar-time-column")[dates.indexOf(date)];
        if (selectedColumn && scroller.clientWidth < grid.scrollWidth) scroller.scrollLeft = selectedColumn.offsetLeft - 48;
      }
      scroller.dataset.period = key;
      renderedWidth = global.innerWidth;

      const agenda = element("section", "calendar-selected-agenda");
      const agendaHeading = element("div", "calendar-agenda-heading");
      agendaHeading.append(element("h3", "", ctx.formatLongDate(date)), button("icon-button", "+", () => ctx.createTask(date)));
      agendaHeading.lastChild.setAttribute("aria-label", "Добавить задачу на выбранный день");
      agenda.append(agendaHeading);
      selectedModel.timedTasks.forEach((entry) => agenda.append(agendaRow(entry, date)));
      if (!selectedModel.timedTasks.length && !selectedModel.unscheduledTasks.length && !due.length) agenda.append(element("p", "muted", "На этот день пока ничего нет"));
      root.append(agenda);
      const gaps = freeIntervals(selectedModel.timedTasks).filter((gap) => gap.end - gap.start >= 45);
      if (gaps.length) {
        const available = element("details", "calendar-free-time");
        available.append(element("summary", "", "Окна в расписании"));
        const list = element("div", "calendar-free-time-list");
        gaps.forEach((gap) => list.append(button("ghost-button compact-button", `${time(gap.start)}–${time(gap.end)}`, () => ctx.createTask(date, time(gap.start), time(Math.min(gap.end, gap.start + 60))))));
        available.append(list); root.append(available);
      }
    }
    return { render };
  }
  const api = { createCalendarSchedule, freeIntervals, quarterMinute };
  global.RhythmCalendarSchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
