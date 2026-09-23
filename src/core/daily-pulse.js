(function (global) {
  function createDailyPulse(ctx) {
    function render(dateKey) {
      const tasks = ctx.getTasks(dateKey);
      const doneTasks = tasks.filter((task) => ctx.isTaskDone(task, dateKey));
      const openTasks = tasks.filter((task) => !ctx.isTaskDone(task, dateKey));
      const taskPercent = percent(doneTasks.length, tasks.length);
      const habits = ctx.getHabits(dateKey);
      const doneHabits = habits.filter((habit) => ctx.isHabitComplete(habit, dateKey)).length;
      const habitPercent = percent(doneHabits, habits.length);
      const values = [];
      if (tasks.length) values.push(taskPercent);
      if (habits.length) values.push(habitPercent);
      const pulse = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
      const nextTask = openTasks[0];

      ctx.els.focusTitle.textContent = nextTask ? nextTask.title : tasks.length ? "План закрыт" : "Свободный слот";
      ctx.els.focusMeta.textContent = nextTask
        ? ctx.taskDetails(nextTask).join(" · ") || "Без категории"
        : tasks.length
          ? "Все задачи на выбранный день выполнены"
          : "Можно добавить задачу или оставить день без перегруза";
      ctx.els.focusPercent.textContent = `${taskPercent}%`;
      ctx.els.focusBar.style.width = `${taskPercent}%`;
      ctx.els.todayOpenMetric.textContent = openTasks.length;
      ctx.els.todayDoneMetric.textContent = doneTasks.length;
      ctx.els.habitDoneMetric.textContent = `${doneHabits}/${habits.length}`;
      ctx.els.sideProgressValue.textContent = `${pulse}%`;
      ctx.els.sideProgressBar.style.width = `${pulse}%`;
      ctx.els.sideProgressSummary.textContent = `Задачи ${taskPercent}% · привычки ${habitPercent}%`;

      return { doneHabits, doneTasks: doneTasks.length, habitPercent, openTasks: openTasks.length, pulse, taskPercent };
    }

    return { render };
  }

  function percent(done, total) {
    return total ? Math.round((done / total) * 100) : 0;
  }

  const api = { createDailyPulse, percent };
  global.RhythmDailyPulse = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
