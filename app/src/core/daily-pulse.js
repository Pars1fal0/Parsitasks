const STREAK_LOOKBACK_DAYS = 60;

function createDailyPulse(ctx) {
  let lastRendered = null;

  function dayStats(dateKey) {
    const tasks = ctx.getTasks(dateKey);
    const doneTasks = tasks.filter((task) => ctx.isTaskDone(task, dateKey));
    const openTasks = tasks.filter((task) => !ctx.isTaskDone(task, dateKey));
    const taskPercent = percent(doneTasks.length, tasks.length);
    const habits = ctx.getHabits(dateKey);
    const statusOnDate = ctx.habitStatusOnDate || ((habit, date) => ctx.isHabitComplete(habit, date) ? "complete" : "missed");
    const frozenHabits = habits.filter((habit) => statusOnDate(habit, dateKey) === "frozen").length;
    const habitTotal = habits.filter((habit) => ["complete", "missed"].includes(statusOnDate(habit, dateKey))).length;
    const doneHabits = habits.filter((habit) => statusOnDate(habit, dateKey) === "complete").length;
    const habitPercent = percent(doneHabits, habitTotal);
    const values = [];
    if (tasks.length) values.push(taskPercent);
    if (habitTotal) values.push(habitPercent);
    const pulse = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
    return { doneHabits, doneTasks, frozenHabits, habitPercent, habitTotal, openTasks, pulse, taskPercent, tasks, values };
  }

  // Consecutive days closed at 100%. Days without planned work are neutral, and an unfinished
  // selected day does not break the run that led up to it.
  function perfectStreak(dateKey, current) {
    let streak = 0;
    let cursor = dateKey;
    if (!isPerfect(current)) cursor = shiftDateKey(dateKey, -1);
    for (let index = 0; index < STREAK_LOOKBACK_DAYS; index += 1) {
      const stats = cursor === dateKey ? current : dayStats(cursor);
      if (stats.values.length) {
        if (!isPerfect(stats)) break;
        streak += 1;
      }
      cursor = shiftDateKey(cursor, -1);
    }
    return streak;
  }

  function render(dateKey) {
    const stats = dayStats(dateKey);
    const { doneHabits, doneTasks, frozenHabits, habitPercent, habitTotal, openTasks, pulse, taskPercent, tasks, values } = stats;
    const nextTask = openTasks[0];
    const streak = perfectStreak(dateKey, stats);
    const perfect = isPerfect(stats);
    // Celebrate only the transition the user just caused, not a revisit of an already closed day.
    if (perfect && lastRendered?.dateKey === dateKey && !lastRendered.perfect) ctx.onDayComplete?.({ dateKey, streak });
    lastRendered = { dateKey, perfect };

    ctx.els.focusTitle.textContent = nextTask ? nextTask.title : tasks.length ? "План закрыт" : "Свободный слот";
    ctx.els.focusMeta.textContent = nextTask
      ? ctx.taskDetails(nextTask).join(" · ") || "Без категории"
      : tasks.length
        ? "Все задачи на выбранный день выполнены"
        : "Можно добавить задачу или оставить день без перегруза";
    ctx.els.focusPercent.textContent = tasks.length ? `${doneTasks.length} из ${tasks.length} задач` : "—";
    ctx.els.focusBar.style.width = `${taskPercent}%`;
    ctx.els.todayOpenMetric.textContent = openTasks.length;
    ctx.els.todayDoneMetric.textContent = doneTasks.length;
    ctx.els.habitDoneMetric.textContent = habitTotal ? `${doneHabits}/${habitTotal}` : "—";
    if (ctx.els.habitFrozenMetric) {
      ctx.els.habitFrozenMetric.textContent = `Заморожено ${frozenHabits}`;
      ctx.els.habitFrozenMetric.hidden = frozenHabits === 0;
    }
    ctx.els.sideProgressValue.textContent = values.length ? `${pulse}%` : "—";
    ctx.els.sideProgressBar.style.width = `${pulse}%`;
    const summary = [];
    if (tasks.length) summary.push(`Задачи: ${doneTasks.length} из ${tasks.length}`);
    if (habitTotal) summary.push(`Привычки: ${doneHabits} из ${habitTotal}`);
    if (!summary.length) summary.push("Нет обязательных дел");
    if (frozenHabits) summary.push(`Заморожено ${frozenHabits}`);
    if (streak >= 2) summary.push(`Серия 100%: ${streak} ${pluralDays(streak)}`);
    ctx.els.sideProgressSummary.textContent = summary.join(" · ");
    if (ctx.els.dayProgressValue) ctx.els.dayProgressValue.textContent = values.length ? `${pulse}%` : "—";
    if (ctx.els.dayProgressBar) ctx.els.dayProgressBar.style.width = `${pulse}%`;
    if (ctx.els.dayProgressSummary) ctx.els.dayProgressSummary.textContent = summary.join(" · ");

    return { doneHabits, doneTasks: doneTasks.length, frozenHabits, habitPercent, openTasks: openTasks.length, perfect, pulse, streak, taskPercent };
  }

  return { render };
}

function percent(done, total) {
  return total ? Math.round((done / total) * 100) : 0;
}

function isPerfect(stats) {
  return stats.values.length > 0 && stats.openTasks.length === 0 && stats.doneHabits === stats.habitTotal;
}

function shiftDateKey(dateKey, days) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function pluralDays(count) {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return "дней";
  if (units === 1) return "день";
  if (units >= 2 && units <= 4) return "дня";
  return "дней";
}

const api = { createDailyPulse, percent, pluralDays, shiftDateKey };

export { createDailyPulse, percent, pluralDays, shiftDateKey };
export default api;
