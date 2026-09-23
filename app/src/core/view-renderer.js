(function (global) {
  function createViewRenderer(ctx) {
    function render(view) {
      ctx.renderDailyPulse();
      switch (view) {
        case "tasks":
          ctx.renderCategories();
          ctx.renderTasks();
          break;
        case "timeline":
          ctx.renderCategories();
          ctx.renderTimeline();
          break;
        case "habits":
          ctx.renderHabits();
          break;
        case "goals":
          ctx.renderGoals();
          break;
        case "overview":
          ctx.renderWeekdayLabels();
          ctx.renderOverview();
          break;
        case "journal":
          ctx.renderJournal();
          break;
        case "nutrition":
          ctx.renderNutrition();
          break;
        case "board":
          ctx.renderBoard();
          break;
        case "archive":
          ctx.renderCategories();
          ctx.renderArchive();
          break;
        case "settings":
          ctx.renderCategories();
          ctx.renderMcpActivity?.();
          ctx.renderSettingsBackupStatus?.();
          ctx.renderRemoteSyncStatus?.();
          break;
        default:
          ctx.renderTasks();
      }
    }

    return { render };
  }

  global.RhythmViewRenderer = { createViewRenderer };
  if (typeof module !== "undefined" && module.exports) module.exports = { createViewRenderer };
})(typeof window !== "undefined" ? window : globalThis);
