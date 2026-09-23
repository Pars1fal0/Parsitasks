(function (global) {
  function createTaskState(ctx) {
    function deleteTask(taskId) {
      const state = ctx.getState();
      markDeleted(state, "tasks", taskId);
      state.tasks = state.tasks.filter((item) => item.id !== taskId);
      Object.keys(state.taskOrder).forEach((dateKey) => {
        state.taskOrder[dateKey] = state.taskOrder[dateKey].filter((id) => id !== taskId);
      });
    }

    function deleteMovedReplacement(taskId, options = {}) {
      const state = ctx.getState();
      const replacement = state.tasks.find((task) => task.id === taskId);
      if (!replacement?.sourceTaskId) return deleteTask(taskId);
      if (options.restoreSourceOccurrence) {
        const source = state.tasks.find((task) => task.id === replacement.sourceTaskId);
        if (source?.excludedDates) {
          delete source.excludedDates[replacement.date];
          source.updatedAt = new Date().toISOString();
        }
      }
      return deleteTask(taskId);
    }

    function deleteHabit(habitId) {
      const state = ctx.getState();
      markDeleted(state, "habits", habitId);
      state.habits = state.habits.filter((item) => item.id !== habitId);
    }

    function deleteGoal(goalId) {
      const state = ctx.getState();
      markDeleted(state, "goals", goalId);
      state.goals = state.goals.filter((item) => item.id !== goalId);
    }

    function reorderHabit(sourceId, targetId) {
      const habits = ctx.getState().habits;
      const from = habits.findIndex((habit) => habit.id === sourceId);
      const to = habits.findIndex((habit) => habit.id === targetId);
      if (from < 0 || to < 0 || from === to) return false;
      const [habit] = habits.splice(from, 1);
      habits.splice(to, 0, habit);
      return true;
    }

    function markDeleted(state, type, id) {
      state.tombstones ||= {
        tasks: {}, habits: {}, goals: {}, categories: {}, journalEntries: {},
        nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {},
      };
      state.tombstones[type] ||= {};
      state.tombstones[type][id] = new Date().toISOString();
    }

    return { deleteGoal, deleteHabit, deleteMovedReplacement, deleteTask, reorderHabit };
  }

  global.RhythmTaskState = { createTaskState };
  if (typeof module !== "undefined" && module.exports) module.exports = { createTaskState };
})(typeof window !== "undefined" ? window : globalThis);
