(function (global) {
  function normalizeLinkedTaskIds(value) {
    return [...new Set((Array.isArray(value) ? value : [])
      .map((id) => String(id || "").trim().slice(0, 160))
      .filter(Boolean))].slice(0, 100);
  }

  function normalizeHabitTargets(value, fallbackDate = "") {
    const byId = new Map();
    (Array.isArray(value) ? value : []).forEach((entry) => {
      const habitId = String(entry?.habitId || "").trim().slice(0, 160);
      if (!habitId) return;
      const requested = Number(entry.targetCount);
      const targetCount = Number.isFinite(requested) ? Math.min(3650, Math.max(1, Math.round(requested))) : 1;
      const startDate = isDateKey(entry.startDate) ? entry.startDate : fallbackDate;
      byId.set(habitId, { habitId, targetCount, startDate });
    });
    return [...byId.values()].slice(0, 100);
  }

  function normalizeTaskTargets(value, fallbackDate = "") {
    const targets = new Map();
    for (const entry of Array.isArray(value) ? value : []) {
      const taskId = String(entry?.taskId || "").trim().slice(0, 160);
      if (!taskId) continue;
      const mode = entry.mode === "count" ? "count" : entry.mode === "legacy" ? "legacy" : "once";
      const requested = Number(entry.targetCount);
      targets.set(taskId, { taskId, mode,
        targetCount: mode === "count" && Number.isFinite(requested) ? Math.min(3650, Math.max(1, Math.round(requested))) : 1,
        startDate: isDateKey(entry.startDate) ? entry.startDate : mode === "count" ? fallbackDate : "" });
    }
    return [...targets.values()].slice(0, 100);
  }

  function goalActivity(goal, state = {}, options = {}) {
    const todayKey = options.todayKey || dateKey(new Date());
    const steps = Array.isArray(goal.steps) ? goal.steps : [];
    const taskIds = normalizeLinkedTaskIds(goal.linkedTaskIds);
    const habitTargets = normalizeHabitTargets(goal.habitTargets, dateKey(new Date(goal.createdAt || Date.now())));
    const tasks = new Map((state.tasks || []).map((task) => [task.id, task]));
    const taskTargets = new Map(normalizeTaskTargets(goal.taskTargets, dateKey(new Date(goal.createdAt || Date.now())))
      .map((target) => [target.taskId, target]));
    const habits = new Map((state.habits || []).map((habit) => [habit.id, habit]));
    const checkpointDone = steps.filter((step) => step.done === true).length;
    const taskResults = taskIds.map((taskId) => {
      const task = tasks.get(taskId);
      const target = taskTargets.get(taskId) || { mode: "legacy", targetCount: 1, startDate: "" };
      const dates = new Set();
      (state.tasks || []).filter((item) => item.id === taskId || item.sourceTaskId === taskId).forEach((item) => {
        Object.entries(item.completed || {}).forEach(([day, completed]) => {
          if (completed === true && isDateKey(day) && day <= todayKey && (!target.startDate || day >= target.startDate)) dates.add(day);
        });
      });
      const count = dates.size;
      return { taskId, task, ...target, count, done: Boolean(task && count >= target.targetCount) };
    });
    const habitResults = habitTargets.map((target) => {
      const habit = habits.get(target.habitId);
      const count = habit ? Object.keys(habit.logs || {})
        .filter((day) => day >= target.startDate && day <= todayKey)
        .filter((day) => habitComplete(habit, day, options.habitStatusOnDate)).length : 0;
      return { ...target, habit, count, done: count >= target.targetCount };
    });
    const total = steps.length + taskResults.length + habitResults.length;
    const completed = checkpointDone + taskResults.reduce((sum, item) => sum + (item.task ? Math.min(1, item.count / item.targetCount) : 0), 0)
      + habitResults.reduce((sum, item) => sum + Math.min(1, item.count / item.targetCount), 0);
    return {
      checkpointDone,
      taskResults,
      habitResults,
      total,
      completed,
      percent: total ? Math.round((completed / total) * 100) : 0,
      achieved: total > 0 && completed >= total,
    };
  }

  function goalWeekActivity(goal, state = {}, weekDates = [], options = {}) {
    const todayKey = options.todayKey || dateKey(new Date());
    const dates = new Set(weekDates.filter((day) => isDateKey(day) && day <= todayKey));
    const tasks = new Map((state.tasks || []).map((task) => [task.id, task]));
    const habits = new Map((state.habits || []).map((habit) => [habit.id, habit]));
    const taskCount = normalizeLinkedTaskIds(goal.linkedTaskIds).reduce((count, id) => {
      if (!tasks.has(id)) return count;
      const target = normalizeTaskTargets(goal.taskTargets).find((item) => item.taskId === id);
      const completedDates = new Set();
      (state.tasks || []).filter((item) => item.id === id || item.sourceTaskId === id).forEach((task) => {
        [...dates].filter((day) => task.completed?.[day] === true && (!target?.startDate || day >= target.startDate))
          .forEach((day) => completedDates.add(day));
      });
      return count + completedDates.size;
    }, 0);
    const habitCount = normalizeHabitTargets(goal.habitTargets).reduce((count, target) => {
      const habit = habits.get(target.habitId);
      if (!habit) return count;
      return count + [...dates].filter((day) => day >= target.startDate
        && habitComplete(habit, day, options.habitStatusOnDate)).length;
    }, 0);
    return {
      taskCount,
      habitCount,
      hasLinks: Boolean(normalizeLinkedTaskIds(goal.linkedTaskIds).length || normalizeHabitTargets(goal.habitTargets).length),
    };
  }

  function reconcileGoalStatuses(state, options = {}) {
    const now = options.now || new Date().toISOString();
    let changed = false;
    (state.goals || []).forEach((goal) => {
      if (!goal.linkedTaskIds?.length && !goal.habitTargets?.length) return;
      const achieved = goalActivity(goal, state, options).achieved;
      const status = achieved ? "done" : "active";
      if (goal.status === status) return;
      goal.status = status;
      goal.completedAt = achieved ? now : "";
      goal.updatedAt = now;
      changed = true;
    });
    return changed;
  }

  function habitComplete(habit, day, statusOnDate) {
    if (statusOnDate) return statusOnDate(habit, day) === "complete";
    const value = habit.logs?.[day];
    return habit.type === "number" ? Number(value) >= Number(habit.goal || 1) : value === true;
  }

  function isDateKey(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function dateKey(date) {
    return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "";
  }

  const api = { goalActivity, goalWeekActivity, normalizeHabitTargets, normalizeLinkedTaskIds, normalizeTaskTargets, reconcileGoalStatuses };
  global.RhythmGoalActivity = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
