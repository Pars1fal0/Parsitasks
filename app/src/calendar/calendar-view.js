(function (global) {
  function createCalendarView(ctx) {
    const heatmapView = global.RhythmHeatmapView.createHeatmapView(ctx);

    function renderOverview() {
      const activeDate = ctx.getActiveDate();
      const week = ctx.getWeekDates(activeDate);
      const mode = ctx.els.views?.overview?.dataset.mode || "week";
      const period = overviewPeriod(mode, activeDate, week, ctx);
      let taskDone = 0;
      let taskTotal = 0;
      let habitDone = 0;
      let habitTotal = 0;

      period.dates.forEach((dateKey) => {
        const stats = ctx.statsForDate(dateKey);
        taskDone += stats.taskDone;
        taskTotal += stats.taskTotal;
        habitDone += stats.habitDone;
        habitTotal += stats.habitTotal;
      });

      const taskMetric = taskTotal ? Math.round((taskDone / taskTotal) * 100) : 0;
      const habitMetric = habitTotal ? Math.round((habitDone / habitTotal) * 100) : 0;

      ctx.els.weeklyTaskMetric.textContent = `${taskMetric}%`;
      ctx.els.weeklyHabitMetric.textContent = `${habitMetric}%`;
      if (ctx.els.overviewHeading) ctx.els.overviewHeading.textContent = period.heading;
      ctx.els.weeklyTaskText.textContent = `${taskDone} из ${taskTotal} задач ${period.suffix}`;
      ctx.els.weeklyHabitText.textContent = `${habitDone} из ${habitTotal} отметок привычек ${period.suffix}`;
      if (mode === "week") renderWeekBoard(week);
      if (mode === "month") renderMonthCalendar();
      if (mode === "year") renderHeatmap();
    }

    function overviewPeriod(mode, activeDate, week, helpers) {
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
      ctx.els.weekBoardLabel.textContent = `${ctx.formatShortDate(week[0])} — ${ctx.formatShortDate(week[6])}`;
      ctx.els.weekBoardGrid.replaceChildren();

      week.forEach((dateKey) => {
        const tasks = ctx.getOrderedTasksForDate(dateKey);
        const openTasks = tasks.filter((task) => !ctx.isTaskDone(task, dateKey));
        const doneCount = tasks.length - openTasks.length;
        const column = document.createElement("article");
        const header = document.createElement("button");
        const weekday = document.createElement("span");
        const day = document.createElement("strong");
        const count = document.createElement("div");
        const list = document.createElement("div");

        column.className = "week-board-day calendar-drop-zone";
        column.dataset.date = dateKey;
        column.setAttribute("aria-label", `${ctx.formatLongDate(dateKey)}: ${openTasks.length} открыто, ${doneCount} готово`);
        column.classList.toggle("is-active", dateKey === activeDate);
        column.classList.toggle("is-today", dateKey === ctx.toDateKey(new Date()));
        header.className = "week-board-header";
        header.type = "button";
        header.setAttribute("aria-label", `Открыть ${ctx.formatLongDate(dateKey)}`);
        weekday.textContent = ctx.formatWeekday(dateKey);
        day.textContent = String(ctx.parseDate(dateKey).getDate());
        count.className = "week-board-count";
        count.textContent = `${doneCount}/${tasks.length} выполнено`;
        list.className = "week-board-list";
        header.append(weekday, day);

        if (tasks.length) {
          tasks.forEach((task) => list.appendChild(createWeekTaskChip(task, dateKey)));
        } else {
          const empty = document.createElement("span");
          empty.className = "week-board-empty";
          empty.textContent = "Нет задач";
          list.appendChild(empty);
        }

        column.append(header, count, list);
        header.addEventListener("click", () => ctx.openDateTasks(dateKey));
        ctx.attachTaskDropZone(column, dateKey);
        column.querySelectorAll(".month-task-chip").forEach((chip) => ctx.attachTaskChipDrag(chip));
        ctx.els.weekBoardGrid.appendChild(column);
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

        dayCell.className = "month-day calendar-drop-zone";
        dayCell.dataset.date = dateKey;
        dayCell.setAttribute("aria-label", `${ctx.formatLongDate(dateKey)}: ${details.join(", ") || "нет задач"}`);
        dayCell.classList.toggle("is-outside", date.getMonth() !== currentMonth);
        dayCell.classList.toggle("is-active", dateKey === activeDate);
        dayCell.classList.toggle("is-today", dateKey === ctx.toDateKey(new Date()));
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
        visibleTasks.forEach((task) => items.appendChild(createMonthTaskChip(task, dateKey)));
        if (hiddenCount > 0) appendHiddenMonthTasks(dayCell, items, hiddenTasks, dateKey, hiddenCount);
        dayCell.append(head, items);

        head.addEventListener("click", () => ctx.openDateTasks(dateKey));
        ctx.attachTaskDropZone(dayCell, dateKey);
        dayCell.querySelectorAll(".month-task-chip").forEach((chip) => ctx.attachTaskChipDrag(chip));
        ctx.els.monthGrid.appendChild(dayCell);
      });
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
