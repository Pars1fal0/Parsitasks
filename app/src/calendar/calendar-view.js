(function (global) {
  function createCalendarView(ctx) {
    let centeredWeek = "";
    const heatmapView = global.RhythmHeatmapView.createHeatmapView(ctx);
    const activityCharts = global.RhythmActivityCharts.createActivityCharts(ctx);
    const grid = ctx.els.views?.overview?.querySelector(".overview-grid");
    if (grid) {
      const metrics = document.createElement("div");
      metrics.className = "calendar-period-metrics";
      grid.querySelectorAll(".metric-panel").forEach((panel) => metrics.appendChild(panel));
      grid.appendChild(metrics);
    }
    const agenda = document.createElement("section"); agenda.className = "calendar-day-agenda"; agenda.id = "calendarDayAgenda";
    const weekAgenda = document.createElement("section"); weekAgenda.className = "calendar-day-agenda"; weekAgenda.id = "calendarWeekAgenda";
    ctx.els.weekBoardGrid?.after(weekAgenda);
    const legend = document.createElement("div"); legend.className = "calendar-month-legend";
    [["is-events", "Дела и занятия"], ["is-deadlines", "Сроки сдачи"]].forEach(([className, label]) => { const item = document.createElement("span"); item.className = className; item.textContent = label; legend.append(item); });
    ctx.els.monthGrid?.after(legend, agenda);
    ctx.els.weekBoardGrid?.after(legend.cloneNode(true));

    function deadlines(dateKey) { return ctx.getState().tasks.filter((task) => task.dueDate === dateKey); }
    function createDeadline(task) {
      const button = document.createElement("button"); button.type = "button"; button.className = "calendar-deadline";
      button.dataset.deadlineTaskId = task.id;
      button.textContent = `Сдать${task.dueTime ? ` ${task.dueTime}` : ""} · ${task.title}`;
      button.classList.toggle("is-done", ctx.isTaskDone(task, task.date || task.dueDate));
      button.addEventListener("click", () => ctx.openDateTasks(task.date, task.id)); return button;
    }
    function renderAgenda(dateKey, target = agenda) {
      const title = document.createElement("h3"); title.textContent = ctx.formatLongDate(dateKey);
      const lessons = (ctx.getStudyEvents?.(dateKey) || []).map((lesson) => createStudyChip(lesson, dateKey));
      const tasks = ctx.getOrderedTasksForDate(dateKey).map((task) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "calendar-agenda-task";
        const time = task.scheduleMode === "block" ? `${task.startTime}–${task.endTime}` : task.time ? `До ${task.time}` : "Без времени";
        button.textContent = `${time} · ${task.title}`;
        button.classList.toggle("is-done", ctx.isTaskDone(task, dateKey));
        button.addEventListener("click", () => ctx.openDateTasks(dateKey, task.id)); return button;
      });
      const due = deadlines(dateKey).map(createDeadline);
      const empty = document.createElement("p"); empty.textContent = "На этот день ничего не запланировано";
      target.replaceChildren(title, ...lessons, ...tasks, ...due, ...(!lessons.length && !tasks.length && !due.length ? [empty] : []));
    }

    function renderOverview() {
      const activeDate = ctx.getActiveDate();
      const week = ctx.getWeekDates(activeDate);
      const mode = ctx.els.views?.overview?.dataset.mode || "week";
      const period = overviewPeriod(mode, activeDate, week, ctx);
      ctx.renderSchedule?.(mode);
      let taskDone = 0;
      let taskTotal = 0;
      let habitDone = 0;
      let habitTotal = 0;
      let habitFrozen = 0;

      period.dates.forEach((dateKey) => {
        const stats = ctx.statsForDate(dateKey);
        taskDone += stats.taskDone;
        taskTotal += stats.taskTotal;
        habitDone += stats.habitDone - (stats.habitFlexibleDone || 0);
        habitTotal += stats.habitTotal - (stats.habitFlexibleDone || 0);
        habitFrozen += stats.habitFrozen || 0;
      });

      const weeklyGoals = new Set();
      period.dates.forEach((day) => ctx.getState().habits.forEach((habit) => {
        const key = `${habit.id}:${global.RhythmHabitSchedule?.weekStart(day)}`;
        if (weeklyGoals.has(key)) return;
        const progress = global.RhythmHabitSchedule?.weekProgress(habit, day, period.dates.at(-1));
        if (!progress) return;
        weeklyGoals.add(key);
        habitDone += Math.min(progress.completed, progress.target);
        habitTotal += progress.target;
      }));

      ctx.els.weeklyTaskMetric.textContent = taskTotal ? `${Math.round(taskDone / taskTotal * 100)}%` : "—";
      ctx.els.weeklyHabitMetric.textContent = habitTotal ? `${Math.round(habitDone / habitTotal * 100)}%` : "—";
      if (ctx.els.overviewHeading) ctx.els.overviewHeading.textContent = period.heading;
      ctx.els.weeklyTaskText.textContent = taskTotal ? `Выполнено ${taskDone} из ${taskTotal} ${period.suffix}` : `Нет задач ${period.suffix}`;
      ctx.els.weeklyHabitText.textContent = `${habitTotal
        ? `Выполнено ${habitDone} из ${habitTotal} ${period.suffix}${weeklyGoals.size ? ", включая недельные цели" : ""}`
        : `Нет обязательных привычек ${period.suffix}`}${habitFrozen ? ` · заморожено ${habitFrozen}` : ""}`;
      if (mode === "week") {
        renderWeekBoard(week);
      }
      if (mode === "month") renderMonthCalendar();
      if (mode === "year") { activityCharts.render(); renderHeatmap(); }
    }

    function overviewPeriod(mode, activeDate, week, helpers) {
      if (mode === "day") return { dates: [activeDate], heading: "День", suffix: "за день" };
      if (mode === "month") {
        const active = helpers.parseDate(activeDate);
        const lastDay = new Date(active.getFullYear(), active.getMonth() + 1, 0).getDate();
        const dates = Array.from({ length: lastDay }, (_, index) => helpers.toDateKey(new Date(active.getFullYear(), active.getMonth(), index + 1)));
        return { dates, heading: "Обзор месяца", suffix: "за месяц" };
      }
      if (mode === "year") {
        const end = helpers.parseDate(activeDate);
        const dates = Array.from({ length: 365 }, (_, index) => {
          const date = new Date(end);
          date.setDate(end.getDate() - (364 - index));
          return helpers.toDateKey(date);
        });
        return { dates, heading: "Обзор года", suffix: "за год" };
      }
      return { dates: week, heading: "Обзор недели", suffix: "за неделю" };
    }


    function renderWeekBoard(week) {
      const activeDate = ctx.getActiveDate();
      const previousScroll = ctx.els.weekBoardGrid.scrollLeft;
      ctx.els.weekBoardLabel.textContent = `${ctx.formatShortDate(week[0])} — ${ctx.formatShortDate(week[6])}`;
      ctx.els.weekBoardGrid.replaceChildren();

      week.forEach((dateKey) => {
        const tasks = ctx.getOrderedTasksForDate(dateKey);
        const lessons = ctx.getStudyEvents?.(dateKey) || [];
        const openTasks = tasks.filter((task) => !ctx.isTaskDone(task, dateKey));
        const doneCount = tasks.length - openTasks.length;
        const column = document.createElement("article");
        const header = document.createElement("button");
        const weekday = document.createElement("span");
        const day = document.createElement("strong");
        const count = document.createElement("div");
        const list = document.createElement("div");
        const load = document.createElement("span");

        column.className = "week-board-day calendar-drop-zone";
        column.dataset.date = dateKey;
        const dueTasks = deadlines(dateKey);
        const label = `${ctx.formatLongDate(dateKey)}: ${openTasks.length} открыто, ${doneCount} готово, ${lessons.length} занятий, ${dueTasks.length} сроков`;
        column.setAttribute("aria-label", label);
        column.classList.toggle("is-active", dateKey === activeDate);
        column.classList.toggle("is-today", dateKey === ctx.toDateKey(new Date()));
        header.className = "week-board-header";
        header.type = "button";
        header.setAttribute("aria-label", label);
        header.setAttribute("aria-pressed", String(dateKey === activeDate));
        weekday.textContent = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(ctx.parseDate(dateKey));
        day.textContent = String(ctx.parseDate(dateKey).getDate());
        count.className = "week-board-count";
        count.textContent = tasks.length ? `${doneCount}/${tasks.length} выполнено` : "Пока без задач";
        if (lessons.length) count.textContent += ` · ${lessons.length} занятий`;
        list.className = "week-board-list";
        load.className = "week-day-load";
        load.textContent = String(tasks.length + lessons.length);
        load.classList.toggle("has-deadlines", dueTasks.length > 0);
        load.title = label;
        header.append(weekday, day, load);

        lessons.forEach((lesson) => list.appendChild(createStudyChip(lesson, dateKey)));
        dueTasks.forEach((task) => list.appendChild(createDeadline(task)));
        if (tasks.length) {
          tasks.forEach((task) => list.appendChild(createWeekTaskChip(task, dateKey)));
        } else if (!lessons.length && !deadlines(dateKey).length) {
          const empty = document.createElement("span");
          empty.className = "week-board-empty";
          empty.textContent = "Нет задач";
          list.appendChild(empty);
        }

        column.append(header, count, list);
        header.addEventListener("click", () => global.matchMedia?.("(max-width: 680px)")?.matches ? ctx.selectCalendarDate?.(dateKey) : ctx.openDateTasks(dateKey));
        ctx.attachTaskDropZone(column, dateKey);
        column.querySelectorAll(".month-task-chip").forEach((chip) => ctx.attachTaskChipDrag(chip));
        ctx.els.weekBoardGrid.appendChild(column);
      });
      renderAgenda(activeDate, weekAgenda);
      global.requestAnimationFrame?.(() => {
        const grid = ctx.els.weekBoardGrid;
        const active = grid.querySelector(".week-board-day.is-active");
        if (!active || !grid.clientWidth) return;
        const context = `${activeDate}:${grid.clientWidth}`;
        grid.scrollLeft = context === centeredWeek ? previousScroll
          : Math.max(0, active.offsetLeft - grid.firstElementChild.offsetLeft - (grid.clientWidth - active.clientWidth) / 2);
        centeredWeek = context;
      });
    }

    function createWeekTaskChip(task, dateKey) {
      const chip = createTaskChip(task, dateKey, "week-task-chip month-task-chip");
      const title = document.createElement("span");
      const meta = document.createElement("small");
      const done = ctx.isTaskDone(task, dateKey);
      const category = ctx.getCategory(task.categoryId);

      chip.classList.toggle("is-done", done);
      title.textContent = task.title;
      meta.textContent = category?.name || ctx.priorityLabels[task.priority] || "Задача";
      chip.append(title, meta);
      return chip;
    }

    function renderMonthCalendar() {
      const activeDate = ctx.getActiveDate();
      const monthDate = ctx.parseDate(activeDate);
      const currentMonth = monthDate.getMonth();
      const dates = ctx.getMonthCalendarDates(activeDate);

      ctx.els.monthLabel.textContent = ctx.formatMonthLabel(activeDate);
      ctx.els.monthGrid.replaceChildren();

      dates.forEach((dateKey) => {
        const date = ctx.parseDate(dateKey);
        const tasks = ctx.getOrderedTasksForDate(dateKey);
        const lessons = ctx.getStudyEvents?.(dateKey) || [];
        const openTasks = tasks.filter((task) => !ctx.isTaskDone(task, dateKey));
        const doneCount = tasks.length - openTasks.length;
        const habitCount = ctx.habitsForDate(dateKey).length;
        const visibleTasks = openTasks.slice(0, 3);
        const hiddenTasks = openTasks.slice(3);
        const hiddenCount = hiddenTasks.length;
        const dayCell = document.createElement("div");
        const head = document.createElement("button");
        const dayNumber = document.createElement("strong");
        const items = document.createElement("div");
        const details = [];

        if (openTasks.length) details.push(`${openTasks.length} открыто`);
        if (doneCount) details.push(`${doneCount} готово`);
        if (habitCount) details.push(`${habitCount} привычек`);
        if (lessons.length) details.push(`${lessons.length} занятий`);
        if (deadlines(dateKey).length) details.push(`${deadlines(dateKey).length} сроков сдачи`);

        dayCell.className = "month-day calendar-drop-zone";
        dayCell.dataset.date = dateKey;
        dayCell.setAttribute("aria-label", `${ctx.formatLongDate(dateKey)}: ${details.join(", ") || "нет задач"}`);
        dayCell.classList.toggle("is-outside", date.getMonth() !== currentMonth);
        dayCell.classList.toggle("is-active", dateKey === activeDate);
        dayCell.classList.toggle("is-today", dateKey === ctx.toDateKey(new Date()));
        dayCell.classList.toggle("has-events", Boolean(tasks.length || lessons.length || deadlines(dateKey).length));
        head.className = "month-day-head";
        head.type = "button";
        head.setAttribute("aria-label", `Открыть ${ctx.formatLongDate(dateKey)}`);
        dayNumber.textContent = String(date.getDate());
        head.appendChild(dayNumber);
        if (tasks.length) {
          const progress = document.createElement("span");
          progress.textContent = `${doneCount}/${tasks.length}`;
          head.appendChild(progress);
        }
        items.className = "month-day-items";
        const due = deadlines(dateKey);
        due.forEach((task) => items.appendChild(createDeadline(task)));
        if (due.length) { const badge = document.createElement("span"); badge.className = "month-due-badge"; badge.textContent = String(due.length); badge.title = `Сроков сдачи: ${due.length}`; badge.setAttribute("aria-label", badge.title); dayCell.append(badge); }
        if (lessons.length) {
          const summary = document.createElement("details"); summary.className = "month-study-events";
          const label = document.createElement("summary"); label.textContent = `Занятия: ${lessons.length}`;
          summary.append(label, ...lessons.map((lesson) => createStudyChip(lesson, dateKey))); items.appendChild(summary);
        }
        visibleTasks.forEach((task) => items.appendChild(createMonthTaskChip(task, dateKey)));
        if (hiddenCount > 0) appendHiddenMonthTasks(dayCell, items, hiddenTasks, dateKey, hiddenCount);
        dayCell.append(head, items);

        head.addEventListener("click", () => global.matchMedia?.("(max-width: 680px)")?.matches ? ctx.selectCalendarDate?.(dateKey) : ctx.openDateTasks(dateKey));
        ctx.attachTaskDropZone(dayCell, dateKey);
        dayCell.querySelectorAll(".month-task-chip").forEach((chip) => ctx.attachTaskChipDrag(chip));
        ctx.els.monthGrid.appendChild(dayCell);
      });
      renderAgenda(activeDate);
    }

    function appendHiddenMonthTasks(dayCell, items, hiddenTasks, dateKey, hiddenCount) {
      const moreButton = document.createElement("button");
      const hiddenList = document.createElement("div");
      moreButton.className = "month-day-more";
      moreButton.type = "button";
      moreButton.textContent = `+${hiddenCount}`;
      hiddenList.className = "month-day-hidden";
      hiddenTasks.forEach((task) => hiddenList.appendChild(createMonthTaskChip(task, dateKey)));
      moreButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const expanded = dayCell.classList.toggle("is-expanded");
        moreButton.textContent = expanded ? "Скрыть" : `+${hiddenCount}`;
      });
      items.append(moreButton, hiddenList);
    }

    function createStudyChip(lesson, dateKey) {
      const button = document.createElement("button"); button.type = "button"; button.className = "calendar-study-event";
      button.style.setProperty("--lesson-color", lesson.color);
      button.dataset.studyLessonId = lesson.id;
      const title = document.createElement("strong"); title.textContent = lesson.title;
      const detail = document.createElement("small"); detail.textContent = [lesson.startTime + "–" + lesson.endTime, lesson.typeLabel, lesson.room].filter(Boolean).join(" · ");
      button.title = [lesson.title, detail.textContent, lesson.teacher].filter(Boolean).join(" · ");
      button.append(title, detail); button.addEventListener("click", () => ctx.openStudyLesson?.(lesson.id, dateKey)); return button;
    }

    function createMonthTaskChip(task, dateKey) {
      const chip = createTaskChip(task, dateKey, "month-task-chip");
      chip.textContent = task.title;
      return chip;
    }

    function createTaskChip(task, dateKey, className) {
      const chip = document.createElement("button");
      const category = ctx.getCategory(task.categoryId);
      chip.className = className;
      chip.type = "button";
      chip.draggable = true;
      chip.dataset.taskId = task.id;
      chip.dataset.date = dateKey;
      chip.style.setProperty("--chip-color", category?.color || "var(--muted-2)");
      return chip;
    }
    function renderHeatmap() {
      heatmapView.renderHeatmap();
    }

    return {
      renderHeatmap,
      renderMonthCalendar,
      renderOverview,
      renderWeekBoard,
    };
  }

  const api = { createCalendarView };
  global.RhythmCalendarView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
