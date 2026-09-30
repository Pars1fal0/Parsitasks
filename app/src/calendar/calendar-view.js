(function (global) {
  function createCalendarView(ctx) {
    let centeredWeek = "";
    const heatmapView = global.RhythmHeatmapView.createHeatmapView(ctx);
    ctx.els.openGoalsFromCalendar?.addEventListener("click", () => ctx.openGoals());

    function renderOverview() {
      const activeDate = ctx.getActiveDate();
      const week = ctx.getWeekDates(activeDate);
      const mode = ctx.els.views?.overview?.dataset.mode || "week";
      const period = overviewPeriod(mode, activeDate, week, ctx);
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
        renderGoalWeek(week);
        renderWeekBoard(week);
      }
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

    function renderGoalWeek(week) {
      const state = ctx.getState();
      const todayKey = ctx.toDateKey(new Date());
      const isCurrentWeek = week.includes(todayKey);
      const goals = (state.goals || []).filter((goal) => goal.status !== "done"
        || (goal.completedAt && goal.completedAt.slice(0, 10) >= week[0] && goal.completedAt.slice(0, 10) <= week[6]));
      const entries = goals.map((goal) => ({
        goal,
        weekActivity: global.RhythmGoalActivity.goalWeekActivity(goal, state, week, { todayKey, habitStatusOnDate: ctx.habitStatusOnDate }),
        activity: global.RhythmGoalActivity.goalActivity(goal, state, { todayKey, habitStatusOnDate: ctx.habitStatusOnDate }),
      }));
      const goalSection = ctx.els.goalWeekList.closest?.(".goal-week-review");
      if (goalSection) goalSection.hidden = entries.length === 0;
      const tracked = entries.filter(({ weekActivity }) => weekActivity.hasLinks);
      const moved = tracked.filter(({ weekActivity }) => weekActivity.taskCount + weekActivity.habitCount > 0).length;
      ctx.els.goalWeekHeading.textContent = `Цели · ${ctx.formatShortDate(week[0])} — ${ctx.formatShortDate(week[6])}`;
      ctx.els.goalWeekSummary.textContent = !entries.length
        ? "Активных целей сейчас нет"
        : tracked.length
          ? `По связанным задачам и привычкам: ${moved} из ${tracked.length} с отметками`
          : "У текущих целей нет связанных задач или привычек";
      ctx.els.goalWeekList.replaceChildren();
      if (!entries.length) return;
      entries.sort((a, b) => (a.goal.status === "done") - (b.goal.status === "done")
        || (a.goal.dueDate || "9999").localeCompare(b.goal.dueDate || "9999"));
      entries.slice(0, 4).forEach(({ goal, weekActivity, activity }) => {
        const row = document.createElement("div");
        const title = document.createElement("button");
        const count = document.createElement("span");
        const next = document.createElement("span");
        row.className = "goal-week-row";
        title.type = "button";
        title.className = "goal-week-title";
        title.textContent = goal.title;
        title.addEventListener("click", () => ctx.openGoals(goal.id));
        count.className = "goal-week-count";
        const steps = goal.steps || [];
        count.textContent = weekActivity.hasLinks
          ? weekActivity.taskCount + weekActivity.habitCount
            ? `${weekActivity.taskCount} ${russianCount(weekActivity.taskCount, ["задача", "задачи", "задач"])} · ${weekActivity.habitCount} ${russianCount(weekActivity.habitCount, ["отметка", "отметки", "отметок"])} привычек`
            : "Без отметок за неделю"
          : `${steps.filter((step) => step.done).length} из ${steps.length} этапов · без недельных дат`;
        next.className = "goal-week-next";
        const nextTask = activity.taskResults.find((item) => !item.done && item.task);
        const nextStep = (goal.steps || []).find((item) => !item.done);
        const nextHabit = activity.habitResults.find((item) => !item.done && item.habit);
        next.textContent = goal.status === "done" ? "Достигнута" : isCurrentWeek
          ? `Дальше: ${nextTask?.task.title || nextStep?.title || nextHabit?.habit.title || "добавьте шаг в цель"}`
          : "";
        row.append(title, count, next);
        ctx.els.goalWeekList.appendChild(row);
      });
      if (entries.length > 4) {
        const more = document.createElement("span");
        more.className = "goal-week-more";
        more.textContent = `Ещё ${entries.length - 4} целей в разделе «Цели»`;
        ctx.els.goalWeekList.appendChild(more);
      }
    }

    function russianCount(value, forms) {
      const lastTwo = value % 100;
      if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
      const last = value % 10;
      return last === 1 ? forms[0] : last >= 2 && last <= 4 ? forms[1] : forms[2];
    }

    function renderWeekBoard(week) {
      const activeDate = ctx.getActiveDate();
      const previousScroll = ctx.els.weekBoardGrid.scrollLeft;
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
        count.textContent = tasks.length ? `${doneCount}/${tasks.length} выполнено` : "Пока без задач";
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
