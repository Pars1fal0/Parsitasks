(function (global) {
  const goalActivity = global.RhythmGoalActivity || require("./goal-activity.js");

  function createGoalsView(ctx) {
    let celebratingGoalId = "";
    const expandedGoalIds = new Set();
    const selectedTaskIds = new Set();
    const selectedTaskTargets = new Map();
    const selectedHabits = new Map();
    const goalFilter = document.createElement("select");
    goalFilter.id = "goalFilter";
    goalFilter.setAttribute("aria-label", "Состояние целей");
    [["active", "В работе"], ["paused", "На паузе"], ["archived", "Архив"], ["all", "Все цели"]].forEach(([value, label]) => goalFilter.add(new Option(label, value)));
    ctx.els.goalList.before(goalFilter);

    function bindEvents() {
      goalFilter.addEventListener("change", renderGoals);
      ctx.els.goalTaskSearch.addEventListener("input", renderTaskOptions);
      ctx.els.goalHabitSearch.addEventListener("input", renderHabitOptions);
      ctx.els.goalTaskOptions.addEventListener("change", (event) => {
        const control = event.target.closest("[data-goal-task-link], [data-goal-task-count], [data-goal-task-start], [data-goal-task-mode]");
        if (!control) return;
        const id = control.dataset.goalTaskLink || control.dataset.goalTaskCount || control.dataset.goalTaskStart || control.dataset.goalTaskMode;
        if (control.dataset.goalTaskLink) {
          if (control.checked) {
            selectedTaskIds.add(id);
            const task = ctx.getState().tasks.find((item) => item.id === id);
            selectedTaskTargets.set(id, { taskId: id, mode: task?.repeat !== "none" ? "count" : "once",
              targetCount: task?.repeat !== "none" ? 7 : 1, startDate: task?.repeat !== "none" ? ctx.toDateKey(new Date()) : "" });
          } else { selectedTaskIds.delete(id); selectedTaskTargets.delete(id); }
        } else {
          const target = selectedTaskTargets.get(id);
          if (!target) return;
          if (control.dataset.goalTaskMode) {
            target.mode = control.value;
            target.targetCount = target.mode === "count" ? Math.max(1, target.targetCount) : 1;
            target.startDate = target.mode === "legacy" ? "" : target.startDate || ctx.toDateKey(new Date());
          } else if (control.dataset.goalTaskCount) target.targetCount = Number(control.value);
          else target.startDate = control.value;
        }
        syncLinkFields();
        renderTaskOptions();
      });
      ctx.els.goalHabitOptions.addEventListener("change", (event) => {
        const control = event.target;
        const habitId = control.dataset.goalHabitLink || control.dataset.goalHabitCount || control.dataset.goalHabitStart;
        if (!habitId) return;
        if (control.dataset.goalHabitLink) {
          if (control.checked) selectedHabits.set(habitId, { habitId, targetCount: 7, startDate: ctx.toDateKey(new Date()) });
          else selectedHabits.delete(habitId);
          renderHabitOptions();
        } else {
          const target = selectedHabits.get(habitId);
          if (!target) return;
          if (control.dataset.goalHabitCount) target.targetCount = Number(control.value);
          else target.startDate = control.value;
        }
        syncLinkFields();
      });
    }

    function renderGoals() {
      const allGoals = ctx.getState().goals || [];
      const goals = allGoals.filter((goal) => goalFilter.value === "all" || (goalFilter.value === "archived" ? goal.archived : goalFilter.value === "paused" ? goal.paused && !goal.archived : !goal.paused && !goal.archived));
      const todayKey = ctx.toDateKey(new Date());
      const stats = goalStats(allGoals, todayKey);

      ctx.els.goalActiveMetric.textContent = stats.active;
      ctx.els.goalOverdueMetric.textContent = stats.overdue;
      ctx.els.goalDoneMetric.textContent = stats.done;
      ctx.els.goalList.replaceChildren();
      ctx.els.goalEmpty.classList.toggle("is-visible", goals.length === 0);

      goals
        .sort((a, b) => goalSortRank(a, todayKey) - goalSortRank(b, todayKey) || a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title))
        .forEach((goal) => ctx.els.goalList.appendChild(createGoalNode(goal, todayKey)));
    }

    function revealGoal(id) {
      const goal = ctx.getState().goals.find((item) => item.id === id);
      if (!goal) return;
      goalFilter.value = goal.archived ? "archived" : goal.paused ? "paused" : "active";
      renderGoals();
    }

    function createGoalNode(goal, todayKey = ctx.toDateKey(new Date())) {
      const item = document.createElement("article");
      const header = document.createElement("header");
      const identity = document.createElement("div");
      const title = document.createElement("h3");
      const meta = document.createElement("p");
      const controls = document.createElement("div");
      const status = document.createElement("span");
      const activity = activityFor(goal);
      const state = goalState(goal, todayKey);

      item.className = `goal-item is-${state}`;
      item.dataset.goalId = goal.id;
      header.className = "goal-head";
      identity.className = "goal-identity";
      controls.className = "goal-head-controls";
      title.textContent = goal.title;
      meta.className = "goal-meta";
      meta.textContent = goalDueLabel(goal, todayKey);
      status.className = "goal-status-pill";
      status.textContent = goalStatusLabel(goal, todayKey);

      identity.append(title, meta);
      controls.append(status, createGoalMenu(goal));
      header.append(identity, controls);
      item.append(header, createGoalProgress(activity));

      const nextCheckpoint = createNextCheckpoint(goal, activity);
      if (nextCheckpoint) item.appendChild(nextCheckpoint);
      item.appendChild(createCheckpointDetails(goal, activity));

      if (goal.id === celebratingGoalId) {
        item.classList.add("is-celebrating");
        item.appendChild(createCelebration());
        global.setTimeout(() => {
          item.classList.remove("is-celebrating");
          item.querySelector(".goal-celebration")?.remove();
          if (celebratingGoalId === goal.id) celebratingGoalId = "";
        }, 1600);
      }

      return item;
    }

    function saveGoalFromForm(event) {
      event.preventDefault();
      const title = ctx.cleanText(ctx.els.goalTitle.value);
      const dueDate = ctx.normalizeDateKey(ctx.els.goalDueDate.value, "");
      const id = ctx.els.goalId.value || ctx.createId();
      const existing = ctx.getState().goals.find((goal) => goal.id === id);
      const steps = ctx.checkpointEditor.getSteps();
      const linkedTaskIds = goalActivity.normalizeLinkedTaskIds([...selectedTaskIds]);
      const taskTargets = goalActivity.normalizeTaskTargets([...selectedTaskTargets.values()], ctx.toDateKey(new Date()));
      const habitTargets = goalActivity.normalizeHabitTargets([...selectedHabits.values()], ctx.toDateKey(new Date()));

      if (!title) {
        ctx.showToast("Напиши название цели");
        ctx.els.goalTitle.focus();
        return;
      }
      if (!steps.length && !linkedTaskIds.length && !habitTargets.length) {
        ctx.showToast("Добавь этап, задачу или привычку");
        ctx.checkpointEditor.focus();
        return;
      }

      const undo = ctx.createUndoSnapshot();
      const now = new Date().toISOString();
      const goal = {
        id,
        title,
        dueDate,
        paused: existing?.paused === true,
        archived: existing?.archived === true,
        steps,
        linkedTaskIds,
        taskTargets,
        habitTargets,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      const done = goalActivity.goalActivity(goal, ctx.getState(), { todayKey: ctx.toDateKey(new Date()), habitStatusOnDate: ctx.habitStatusOnDate }).achieved;
      goal.status = done ? "done" : "active";
      goal.completedAt = done ? existing?.completedAt || now : "";
      ctx.upsertGoal(goal);
      ctx.saveState();
      resetGoalForm({ open: false });
      renderGoals();
      ctx.showToast(existing ? "Цель обновлена" : "Цель добавлена", { undo });
    }

    async function fillGoalForm(goal) {
      if (ctx.confirmDiscardOpenForms && !(await ctx.confirmDiscardOpenForms())) return;
      ctx.els.goalId.value = goal.id;
      ctx.els.goalTitle.value = goal.title || "";
      ctx.els.goalDueDate.value = goal.dueDate || "";
      ctx.checkpointEditor.setSteps(goal.steps || []);
      setLinks(goal);
      ctx.els.goalFormHeading.textContent = "Редактировать цель";
      ctx.els.resetGoalForm.textContent = "Отмена";
      ctx.els.goalFormPanel.classList.remove("is-collapsed");
      ctx.markFormPristine?.(ctx.els.goalForm);
      ctx.els.goalTitle.focus();
    }

    function resetGoalForm(options = {}) {
      ctx.els.goalFormPanel.classList.toggle("is-collapsed", options.open === false);
      ctx.els.goalId.value = "";
      ctx.els.goalTitle.value = "";
      ctx.els.goalDueDate.value = "";
      ctx.checkpointEditor.setSteps();
      setLinks();
      ctx.els.goalFormHeading.textContent = "Новая цель";
      ctx.els.resetGoalForm.textContent = "Очистить";
      ctx.markFormPristine?.(ctx.els.goalForm);
    }

    function setLinks(goal = {}) {
      selectedTaskIds.clear();
      selectedTaskTargets.clear();
      goalActivity.normalizeLinkedTaskIds(goal.linkedTaskIds).forEach((id) => selectedTaskIds.add(id));
      const stored = goalActivity.normalizeTaskTargets(goal.taskTargets);
      selectedTaskIds.forEach((id) => selectedTaskTargets.set(id, stored.find((item) => item.taskId === id)
        || { taskId: id, mode: "legacy", targetCount: 1, startDate: "" }));
      selectedHabits.clear();
      goalActivity.normalizeHabitTargets(goal.habitTargets, ctx.toDateKey(new Date()))
        .forEach((target) => selectedHabits.set(target.habitId, target));
      ctx.els.goalTaskSearch.value = "";
      ctx.els.goalHabitSearch.value = "";
      syncLinkFields();
      renderTaskOptions();
      renderHabitOptions();
    }

    function syncLinkFields() {
      ctx.els.goalLinkedTaskIds.value = JSON.stringify([...selectedTaskIds]);
      const taskTargetsField = ctx.els.goalForm.querySelector("#goalTaskTargets");
      if (taskTargetsField) taskTargetsField.value = JSON.stringify([...selectedTaskTargets.values()]);
      ctx.els.goalHabitTargets.value = JSON.stringify([...selectedHabits.values()]);
      ctx.els.goalTaskLinkCount.textContent = `${selectedTaskIds.size} выбрано`;
      ctx.els.goalHabitLinkCount.textContent = `${selectedHabits.size} выбрано`;
    }

    function renderTaskOptions() {
      const query = ctx.els.goalTaskSearch.value.trim().toLocaleLowerCase("ru-RU");
      const tasks = ctx.getState().tasks || [];
      const byId = new Map(tasks.map((task) => [task.id, task]));
      const visible = [...selectedTaskIds].map((id) => byId.get(id) || { id, title: "Удалённая задача", date: "" });
      tasks.filter((task) => !selectedTaskIds.has(task.id) && (!query || task.title.toLocaleLowerCase("ru-RU").includes(query)))
        .sort((left, right) => (right.date || "").localeCompare(left.date || ""))
        .slice(0, 40)
        .forEach((task) => visible.push(task));
      ctx.els.goalTaskOptions.replaceChildren(...visible.map((task) => {
        const row = document.createElement("div");
        const label = document.createElement("label");
        const input = document.createElement("input");
        const text = document.createElement("span");
        const meta = document.createElement("small");
        label.className = "goal-link-option";
        input.type = "checkbox";
        input.className = "goal-link-control";
        input.dataset.goalTaskLink = task.id;
        input.checked = selectedTaskIds.has(task.id);
        text.textContent = task.title;
        meta.textContent = task.date ? formatShortDate(task.date) : "Позже · без даты";
        label.append(input, text, meta);
        row.append(label);
        const target = selectedTaskTargets.get(task.id);
        if (target) {
          const controls = document.createElement("div");
          controls.className = "goal-task-target";
          const mode = document.createElement("select");
          mode.dataset.goalTaskMode = task.id;
          mode.setAttribute("aria-label", `Вклад задачи ${task.title}`);
          [["once", "Одно выполнение"], ["count", "Несколько выполнений"], ...(target.mode === "legacy" ? [["legacy", "Старое правило: любое прошлое выполнение"]] : [])]
            .forEach(([value, title]) => mode.add(new Option(title, value)));
          mode.value = target.mode;
          controls.append(mode);
          if (target.mode !== "legacy") {
            if (target.mode === "count") {
              const label = document.createElement("label"); label.textContent = "Выполнений";
              const count = document.createElement("input"); count.type = "number"; count.min = "1"; count.max = "3650"; count.required = true;
              count.value = target.targetCount; count.dataset.goalTaskCount = task.id; label.append(count); controls.append(label);
            }
            const label = document.createElement("label"); label.textContent = "Считать с";
            const start = document.createElement("input"); start.type = "date"; start.required = target.mode === "count";
            start.value = target.startDate; start.dataset.goalTaskStart = task.id; label.append(start); controls.append(label);
          }
          const preview = document.createElement("small");
          const result = goalActivity.goalActivity({ linkedTaskIds: [task.id], taskTargets: [target] }, ctx.getState(), { todayKey: ctx.toDateKey(new Date()) }).taskResults[0];
          preview.textContent = `Уже засчитано: ${Math.min(result.count, result.targetCount)} из ${result.targetCount}${target.mode === "legacy" ? " · включая прошлую историю" : ""}`;
          controls.append(preview);
          row.append(controls);
        }
        return row;
      }));
      if (!visible.length) ctx.els.goalTaskOptions.textContent = tasks.length ? "Задачи не найдены" : "Задач пока нет";
    }

    function renderHabitOptions() {
      const query = ctx.els.goalHabitSearch.value.trim().toLocaleLowerCase("ru-RU");
      const habits = ctx.getState().habits || [];
      const byId = new Map(habits.map((habit) => [habit.id, habit]));
      const visible = [...selectedHabits.keys()].map((id) => byId.get(id) || { id, title: "Удалённая привычка" });
      habits.filter((habit) => !selectedHabits.has(habit.id) && (!query || habit.title.toLocaleLowerCase("ru-RU").includes(query)))
        .slice(0, 40)
        .forEach((habit) => visible.push(habit));
      ctx.els.goalHabitOptions.replaceChildren(...visible.map((habit) => {
        const row = document.createElement("div");
        const label = document.createElement("label");
        const input = document.createElement("input");
        const name = document.createElement("span");
        row.className = "goal-habit-option";
        label.className = "goal-link-option";
        input.type = "checkbox";
        input.className = "goal-link-control";
        input.dataset.goalHabitLink = habit.id;
        input.checked = selectedHabits.has(habit.id);
        name.textContent = habit.title;
        label.append(input, name);
        row.append(label);
        const target = selectedHabits.get(habit.id);
        if (target) {
          const controls = document.createElement("div");
          const countLabel = document.createElement("label");
          const count = document.createElement("input");
          const startLabel = document.createElement("label");
          const start = document.createElement("input");
          controls.className = "goal-habit-target";
          countLabel.textContent = "Дней выполнения";
          count.type = "number";
          count.min = "1";
          count.max = "3650";
          count.required = true;
          count.value = String(target.targetCount);
          count.className = "goal-link-control";
          count.dataset.goalHabitCount = habit.id;
          startLabel.textContent = "Считать с";
          start.type = "date";
          start.required = true;
          start.value = target.startDate;
          start.className = "goal-link-control";
          start.dataset.goalHabitStart = habit.id;
          countLabel.append(count);
          startLabel.append(start);
          controls.append(countLabel, startLabel);
          row.append(controls);
        }
        return row;
      }));
      if (!visible.length) ctx.els.goalHabitOptions.textContent = habits.length ? "Привычки не найдены" : "Привычек пока нет";
    }

    function activityFor(goal) {
      return goalActivity.goalActivity(goal, ctx.getState(), {
        todayKey: ctx.toDateKey(new Date()),
        habitStatusOnDate: ctx.habitStatusOnDate,
      });
    }

    function toggleGoalStep(goalId, stepId, done) {
      const goal = ctx.getState().goals.find((item) => item.id === goalId);
      const step = goal?.steps?.find((item) => item.id === stepId);
      if (!goal || !step) return;

      const undo = ctx.createUndoSnapshot();
      const wasDone = goal.status === "done";
      step.done = done;
      const achieved = activityFor(goal).achieved;
      goal.status = achieved ? "done" : "active";
      goal.completedAt = achieved ? goal.completedAt || new Date().toISOString() : "";
      goal.updatedAt = new Date().toISOString();
      if (achieved && !wasDone) celebratingGoalId = goal.id;

      ctx.saveState();
      renderGoals();
      ctx.showToast(achieved && !wasDone ? "Цель достигнута" : done ? "Этап выполнен" : "Этап снова активен", { undo });
    }

    async function deleteGoal(goalId) {
      const goal = ctx.getState().goals.find((item) => item.id === goalId);
      if (!goal) return;
      const confirmed = await ctx.confirmAction?.({
        title: "Удалить цель?",
        message: `Цель «${goal.title}» и её этапы будут удалены.`,
        confirmLabel: "Удалить",
        tone: "danger",
      });
      if (confirmed === false || confirmed == null) return;

      const undo = ctx.createUndoSnapshot();
      ctx.deleteGoal(goalId);
      ctx.saveState();
      resetGoalForm({ open: false });
      renderGoals();
      ctx.showToast("Цель удалена", { undo });
    }

    function createGoalMenu(goal) {
      const menu = document.createElement("details");
      const trigger = document.createElement("summary");
      const popover = document.createElement("div");
      menu.className = "goal-menu";
      trigger.className = "icon-button subtle goal-menu-trigger";
      trigger.setAttribute("aria-label", `Действия с целью ${goal.title}`);
      trigger.appendChild(createIcon("more"));
      popover.className = "goal-menu-popover";
      popover.append(
        createMenuAction("edit", "Редактировать", () => fillGoalForm(goal)),
        createMenuAction("clock", goal.paused ? "Продолжить" : "Поставить на паузу", () => changeGoalState(goal, "paused")),
        createMenuAction("archive", goal.archived ? "Вернуть из архива" : "В архив", () => changeGoalState(goal, "archived")),
        createMenuAction("trash", "Удалить", () => deleteGoal(goal.id), true),
      );
      menu.append(trigger, popover);
      return menu;
    }

    function changeGoalState(goal, field) {
      const undo = ctx.createUndoSnapshot();
      const previous = { ...goal };
      goal[field] = !goal[field];
      goal.updatedAt = new Date().toISOString();
      if (ctx.saveState() === false) { Object.assign(goal, previous); return; }
      renderGoals();
      ctx.showToast(field === "archived" ? (goal.archived ? "Цель в архиве" : "Цель восстановлена") : (goal.paused ? "Цель на паузе" : "Цель снова в работе"), { undo });
    }

    function createMenuAction(iconName, label, handler, danger = false) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `goal-menu-action${danger ? " is-danger" : ""}`;
      button.append(createIcon(iconName), document.createTextNode(label));
      button.addEventListener("click", (event) => {
        event.currentTarget.closest("details")?.removeAttribute("open");
        handler();
      });
      return button;
    }

    function createIcon(name) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      svg.classList.add("ui-icon");
      use.setAttribute("href", `#icon-${name}`);
      svg.appendChild(use);
      return svg;
    }

    function createGoalProgress(activity) {
      const progress = document.createElement("div");
      const head = document.createElement("div");
      const label = document.createElement("span");
      const value = document.createElement("strong");
      const bar = document.createElement("div");
      const fill = document.createElement("span");

      progress.className = "goal-progress";
      head.className = "goal-progress-head";
      label.textContent = "Выполнено из плана";
      value.textContent = `${activity.percent}%`;
      bar.className = "goal-progress-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `Прогресс цели: ${activity.percent}%`);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(activity.percent));
      fill.style.width = `${activity.percent}%`;
      head.append(label, value);
      bar.appendChild(fill);
      progress.append(head, bar);
      return progress;
    }

    function createNextCheckpoint(goal, activity) {
      const task = activity.taskResults.find((item) => !item.done && item.task);
      const step = (goal.steps || []).find((item) => !item.done);
      const habit = activity.habitResults.find((item) => !item.done && item.habit);
      if (!task && !step && !habit) return null;
      const element = document.createElement("p");
      const label = document.createElement("span");
      element.className = "goal-next-step";
      label.textContent = task ? "Задача" : step ? "Следующий шаг" : "Привычка";
      element.append(label, document.createTextNode(task?.task.title || step?.title || habit?.habit.title));
      return element;
    }

    function createCheckpointDetails(goal, activity) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      const list = document.createElement("div");
      const steps = goal.steps || [];
      details.className = "goal-details";
      details.open = expandedGoalIds.has(goal.id);
      details.addEventListener("toggle", () => {
        if (details.open) expandedGoalIds.add(goal.id);
        else expandedGoalIds.delete(goal.id);
      });
      summary.textContent = `План · ${activity.total} пунктов`;
      list.className = "goal-steps";
      list.setAttribute("aria-label", `План цели ${goal.title}`);
      steps.forEach((step) => list.appendChild(createCheckpointControl(goal, step)));
      activity.taskResults.forEach((result) => list.appendChild(createTaskLinkControl(result)));
      activity.habitResults.forEach((result) => list.appendChild(createHabitLinkControl(result)));
      details.append(summary, list);
      return details;
    }

    function createTaskLinkControl(result) {
      const button = document.createElement("button");
      const marker = document.createElement("span");
      const title = document.createElement("span");
      const meta = document.createElement("small");
      button.type = "button";
      button.className = `goal-activity-row${result.done ? " is-done" : ""}`;
      button.disabled = !result.task;
      marker.className = "goal-activity-marker";
      marker.append(createIcon(result.done ? "check" : "tasks"));
      title.textContent = result.task?.title || "Удалённая задача";
      meta.textContent = result.mode === "count" ? `${result.count} из ${result.targetCount} · с ${formatShortDate(result.startDate)}`
        : result.done ? "Выполнена" : result.task?.date ? formatShortDate(result.task.date) : result.task ? "Позже · без даты" : "Связь недоступна";
      button.append(marker, title, meta);
      button.addEventListener("click", () => ctx.openTask?.(result.task));
      return button;
    }

    function createHabitLinkControl(result) {
      const button = document.createElement("button");
      const marker = document.createElement("span");
      const title = document.createElement("span");
      const meta = document.createElement("small");
      button.type = "button";
      button.className = `goal-activity-row${result.done ? " is-done" : ""}`;
      button.disabled = !result.habit;
      marker.className = "goal-activity-marker";
      marker.append(createIcon(result.done ? "check" : "habit"));
      title.textContent = result.habit?.title || "Удалённая привычка";
      meta.textContent = `Дней: ${result.count}/${result.targetCount}`;
      button.append(marker, title, meta);
      button.addEventListener("click", () => ctx.openHabit?.(result.habit));
      return button;
    }

    function createCheckpointControl(goal, step) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      const marker = document.createElement("span");
      const text = document.createElement("span");
      label.className = "goal-step";
      checkbox.type = "checkbox";
      checkbox.checked = step.done === true;
      checkbox.addEventListener("change", () => toggleGoalStep(goal.id, step.id, checkbox.checked));
      marker.className = "goal-step-marker";
      marker.appendChild(createIcon("check"));
      text.className = "goal-step-title";
      text.textContent = step.title;
      label.append(checkbox, marker, text);
      return label;
    }

    function createCelebration() {
      const celebration = document.createElement("div");
      celebration.className = "goal-celebration";
      celebration.setAttribute("aria-hidden", "true");
      const positions = [
        [-72, -48, -18], [-46, -66, 32], [-18, -58, 72], [18, -68, -48], [50, -54, 24], [76, -34, 64],
        [-78, 18, 48], [-52, 42, -64], [-20, 54, 18], [24, 58, -32], [54, 38, 70], [80, 12, -18],
      ];
      positions.forEach(([x, y, rotation], index) => {
        const particle = document.createElement("i");
        particle.style.setProperty("--goal-particle-x", `${x}px`);
        particle.style.setProperty("--goal-particle-y", `${y}px`);
        particle.style.setProperty("--goal-particle-rotation", `${rotation}deg`);
        particle.style.setProperty("--goal-particle-delay", `${index * 22}ms`);
        celebration.appendChild(particle);
      });
      return celebration;
    }

    return { bindEvents, createGoalNode, fillGoalForm, renderGoals, resetGoalForm, revealGoal, saveGoalFromForm };
  }

  function goalStats(goals, todayKey) {
    return goals.reduce(
      (stats, goal) => {
        if (goal.paused || goal.archived) return stats;
        const state = goalState(goal, todayKey);
        if (state === "done") stats.done += 1;
        else if (state === "overdue") stats.overdue += 1;
        else stats.active += 1;
        return stats;
      },
      { active: 0, done: 0, overdue: 0 },
    );
  }

  function goalProgress(goal, state, options) {
    if (state) return goalActivity.goalActivity(goal, state, options).percent;
    const steps = Array.isArray(goal.steps) ? goal.steps : [];
    if (!steps.length) return goal.status === "done" ? 100 : 0;
    return Math.round((steps.filter((step) => step.done).length / steps.length) * 100);
  }

  function goalState(goal, todayKey) {
    if (goal.archived) return "archived";
    if (goal.paused) return "paused";
    if (goal.status === "done") return "done";
    if (goal.dueDate && goal.dueDate < todayKey) return "overdue";
    return "active";
  }

  function goalSortRank(goal, todayKey) {
    return { overdue: 0, active: 1, done: 2 }[goalState(goal, todayKey)] ?? 1;
  }

  function goalStatusLabel(goal, todayKey) {
    const state = goalState(goal, todayKey);
    if (state === "archived") return "В архиве";
    if (state === "paused") return "На паузе";
    if (state === "done") return "Достигнута";
    if (state === "overdue") return "Просрочена";
    return "В работе";
  }

  function goalDueLabel(goal, todayKey) {
    if (!goal.dueDate) return "Без срока";
    if (goal.paused || goal.archived) return `Срок: ${formatGoalDate(goal.dueDate)}`;
    const diff = diffDays(todayKey, goal.dueDate);
    const formattedDate = formatGoalDate(goal.dueDate);
    if (goal.status === "done") return `достигнута · срок был до ${formattedDate}`;
    if (diff === 0) return "срок сегодня";
    if (diff === 1) return "срок завтра";
    if (diff > 1) return `осталось ${diff} дн. · до ${formattedDate}`;
    return `просрочена на ${Math.abs(diff)} дн. · до ${formattedDate}`;
  }

  function formatGoalDate(dateKey) {
    const [year, month, day] = String(dateKey || "").split("-").map(Number);
    if (!year || !month || !day) return dateKey || "";
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(year, month - 1, day));
  }

  function formatShortDate(dateKey) {
    const [year, month, day] = String(dateKey || "").split("-");
    return year && month && day ? `${day}.${month}.${year}` : dateKey;
  }

  function diffDays(fromKey, toKey) {
    const [fromYear, fromMonth, fromDay] = fromKey.split("-").map(Number);
    const [toYear, toMonth, toDay] = toKey.split("-").map(Number);
    return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86400000);
  }

  function parseGoalSteps(value, existingSteps = [], createId = defaultCreateId) {
    const existingByTitle = new Map(existingSteps.map((step) => [String(step.title || "").toLowerCase(), step]));
    return String(value || "")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .map((title) => {
        const existing = existingByTitle.get(title.toLowerCase());
        return { id: existing?.id || createId(), title, done: existing?.done === true };
      });
  }

  function defaultCreateId() {
    return `goal-step-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  const api = { createGoalsView, goalProgress, goalSortRank, goalStats, goalState, parseGoalSteps };
  global.RhythmGoalsView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
