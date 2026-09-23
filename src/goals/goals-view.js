(function (global) {
  function createGoalsView(ctx) {
    let celebratingGoalId = "";
    const expandedGoalIds = new Set();

    function renderGoals() {
      const goals = [...(ctx.getState().goals || [])];
      const todayKey = ctx.toDateKey(new Date());
      const stats = goalStats(goals, todayKey);

      ctx.els.goalActiveMetric.textContent = stats.active;
      ctx.els.goalOverdueMetric.textContent = stats.overdue;
      ctx.els.goalDoneMetric.textContent = stats.done;
      ctx.els.goalList.replaceChildren();
      ctx.els.goalEmpty.classList.toggle("is-visible", goals.length === 0);

      goals
        .sort((a, b) => goalSortRank(a, todayKey) - goalSortRank(b, todayKey) || a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title))
        .forEach((goal) => ctx.els.goalList.appendChild(createGoalNode(goal, todayKey)));
    }

    function createGoalNode(goal, todayKey = ctx.toDateKey(new Date())) {
      const item = document.createElement("article");
      const header = document.createElement("header");
      const identity = document.createElement("div");
      const title = document.createElement("h3");
      const meta = document.createElement("p");
      const controls = document.createElement("div");
      const status = document.createElement("span");
      const progressValue = goalProgress(goal);
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
      item.append(header, createGoalProgress(progressValue, goal.steps || []));

      const nextCheckpoint = createNextCheckpoint(goal);
      if (nextCheckpoint) item.appendChild(nextCheckpoint);
      item.appendChild(createCheckpointDetails(goal));

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

      if (!title) {
        ctx.showToast("Напиши название цели");
        ctx.els.goalTitle.focus();
        return;
      }
      if (!dueDate) {
        ctx.showToast("Выбери срок цели");
        ctx.els.goalDueDate.focus();
        return;
      }
      if (!steps.length) {
        ctx.showToast("Добавь хотя бы один чекпоинт");
        ctx.checkpointEditor.focus();
        return;
      }

      const undo = ctx.createUndoSnapshot();
      const done = steps.every((step) => step.done);
      const now = new Date().toISOString();
      ctx.upsertGoal({
        id,
        title,
        dueDate,
        steps,
        status: done ? "done" : "active",
        completedAt: done ? existing?.completedAt || now : "",
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
      ctx.saveState();
      resetGoalForm({ open: false });
      renderGoals();
      ctx.showToast(existing ? "Цель обновлена" : "Цель добавлена", { undo });
    }

    async function fillGoalForm(goal) {
      if (ctx.confirmDiscardOpenForms && !(await ctx.confirmDiscardOpenForms())) return;
      ctx.els.goalId.value = goal.id;
      ctx.els.goalTitle.value = goal.title || "";
      ctx.els.goalDueDate.value = goal.dueDate || ctx.getActiveDate();
      ctx.checkpointEditor.setSteps(goal.steps || []);
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
      ctx.els.goalDueDate.value = ctx.getActiveDate();
      ctx.checkpointEditor.setSteps();
      ctx.els.goalFormHeading.textContent = "Новая цель";
      ctx.els.resetGoalForm.textContent = "Очистить";
      ctx.markFormPristine?.(ctx.els.goalForm);
    }

    function toggleGoalStep(goalId, stepId, done) {
      const goal = ctx.getState().goals.find((item) => item.id === goalId);
      const step = goal?.steps?.find((item) => item.id === stepId);
      if (!goal || !step) return;

      const undo = ctx.createUndoSnapshot();
      const wasDone = goal.status === "done";
      step.done = done;
      const achieved = goal.steps.length > 0 && goal.steps.every((item) => item.done);
      goal.status = achieved ? "done" : "active";
      goal.completedAt = achieved ? goal.completedAt || new Date().toISOString() : "";
      goal.updatedAt = new Date().toISOString();
      if (achieved && !wasDone) celebratingGoalId = goal.id;

      ctx.saveState();
      renderGoals();
      ctx.showToast(achieved && !wasDone ? "Цель достигнута" : done ? "Чекпоинт пройден" : "Чекпоинт снова активен", { undo });
    }

    async function deleteGoal(goalId) {
      const goal = ctx.getState().goals.find((item) => item.id === goalId);
      if (!goal) return;
      const confirmed = await ctx.confirmAction?.({
        title: "Удалить цель?",
        message: `Цель «${goal.title}» и её чекпоинты будут удалены.`,
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
        createMenuAction("trash", "Удалить", () => deleteGoal(goal.id), true),
      );
      menu.append(trigger, popover);
      return menu;
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

    function createGoalProgress(progressValue, steps) {
      const progress = document.createElement("div");
      const head = document.createElement("div");
      const label = document.createElement("span");
      const bar = document.createElement("div");
      const fill = document.createElement("span");
      const completeCount = steps.filter((step) => step.done).length;

      progress.className = "goal-progress";
      head.className = "goal-progress-head";
      label.textContent = `${completeCount} из ${steps.length} чекпоинтов`;
      bar.className = "goal-progress-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `Прогресс цели: ${completeCount} из ${steps.length} чекпоинтов`);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(progressValue));
      fill.style.width = `${progressValue}%`;
      head.appendChild(label);
      bar.appendChild(fill);
      progress.append(head, bar);
      return progress;
    }

    function createNextCheckpoint(goal) {
      const next = (goal.steps || []).find((step) => !step.done);
      if (!next) return null;
      const element = document.createElement("p");
      const label = document.createElement("span");
      element.className = "goal-next-step";
      label.textContent = "Следующий";
      element.append(label, document.createTextNode(next.title));
      return element;
    }

    function createCheckpointDetails(goal) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      const list = document.createElement("div");
      const steps = goal.steps || [];
      const doneCount = steps.filter((step) => step.done).length;
      details.className = "goal-details";
      details.open = expandedGoalIds.has(goal.id);
      details.addEventListener("toggle", () => {
        if (details.open) expandedGoalIds.add(goal.id);
        else expandedGoalIds.delete(goal.id);
      });
      summary.textContent = `Чекпоинты · ${doneCount}/${steps.length}`;
      list.className = "goal-steps";
      list.setAttribute("aria-label", `Чекпоинты цели ${goal.title}`);
      steps.forEach((step) => list.appendChild(createCheckpointControl(goal, step)));
      details.append(summary, list);
      return details;
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

    return { createGoalNode, fillGoalForm, renderGoals, resetGoalForm, saveGoalFromForm };
  }

  function goalStats(goals, todayKey) {
    return goals.reduce(
      (stats, goal) => {
        const state = goalState(goal, todayKey);
        if (state === "done") stats.done += 1;
        else if (state === "overdue") stats.overdue += 1;
        else stats.active += 1;
        return stats;
      },
      { active: 0, done: 0, overdue: 0 },
    );
  }

  function goalProgress(goal) {
    const steps = Array.isArray(goal.steps) ? goal.steps : [];
    if (!steps.length) return goal.status === "done" ? 100 : 0;
    return Math.round((steps.filter((step) => step.done).length / steps.length) * 100);
  }

  function goalState(goal, todayKey) {
    if (goal.status === "done") return "done";
    if (goal.dueDate < todayKey) return "overdue";
    return "active";
  }

  function goalSortRank(goal, todayKey) {
    return { overdue: 0, active: 1, done: 2 }[goalState(goal, todayKey)] ?? 1;
  }

  function goalStatusLabel(goal, todayKey) {
    const state = goalState(goal, todayKey);
    if (state === "done") return "Достигнута";
    if (state === "overdue") return "Просрочена";
    return "В работе";
  }

  function goalDueLabel(goal, todayKey) {
    if (!goal.dueDate) return "Без срока";
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
