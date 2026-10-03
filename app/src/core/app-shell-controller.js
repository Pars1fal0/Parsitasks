(function (global) {
  const PAGE_TITLES = {
    archive: "Архив",
    board: "Доска",
    goals: "Цели",
    habits: "Привычки",
    journal: "Заметки",
    nutrition: "Питание",
    overview: "Календарь",
    settings: "Настройки",
    study: "Учёба",
    tasks: "Задачи на день",
    timeline: "Таймлайн дня",
  };

  function createAppShellController(ctx) {
    function render() {
      const activeView = ctx.getActiveView();
      if (!["timeline", "overview"].includes(activeView)) ctx.restoreTaskFormPanel();
      ctx.els.activeDate.value = ctx.getActiveDate();
      updateDateNavigation();
      ctx.els.todayLabel.textContent = ctx.formatLongDate(ctx.getActiveDate());
      ctx.renderSaveStatus();
      ctx.els.pageTitle.textContent = PAGE_TITLES[activeView] || PAGE_TITLES.tasks;
      document.body.dataset.view = activeView;
      ctx.syncTaskTimePresets();

      ctx.els.navTabs.forEach((button) => {
        const isActive = button.dataset.view === activeView;
        button.classList.toggle("is-active", isActive);
        button.toggleAttribute("aria-current", isActive);
        if (isActive) button.setAttribute("aria-current", "page");
      });

      const compact = global.matchMedia?.("(max-width: 900px)")?.matches;
      const isMoreView = compact
        ? ctx.isMobilePinned ? !ctx.isMobilePinned(activeView) : ["goals", "nutrition", "journal", "board", "archive", "settings", "study"].includes(activeView)
        : !["tasks", "habits", "overview", "study", "timeline"].includes(activeView);
      ctx.els.navMoreSummary?.classList.toggle("is-active", isMoreView);
      if (isMoreView) ctx.els.navMoreSummary?.setAttribute("aria-current", "page");
      else ctx.els.navMoreSummary?.removeAttribute("aria-current");

      Object.entries(ctx.els.views).forEach(([view, element]) => {
        element.classList.toggle("is-active", view === activeView);
      });
      ctx.viewRenderer.render(activeView);
    }

    function syncRoute({ replace = false } = {}) {
      const hash = ctx.navigationState.buildHash(ctx.getActiveView(), ctx.getOverviewMode());
      if (global.location.hash === hash) return;
      global.history[replace ? "replaceState" : "pushState"](
        { activeView: ctx.getActiveView(), overviewMode: ctx.getOverviewMode() },
        "",
        hash,
      );
    }

    function handleNavigationChange() {
      const route = ctx.navigationState.parseHash(global.location.hash);
      if (!route) {
        syncRoute({ replace: true });
        return;
      }
      ctx.setActiveView(route.view);
      if (route.overviewMode) ctx.setOverviewMode(route.overviewMode);
      syncOverviewMode();
      ctx.els.navMore?.removeAttribute("open");
      ctx.saveUiState();
      render();
      scrollTop();
    }

    function syncOverviewMode() {
      const mode = ctx.getOverviewMode();
      ctx.els.views.overview.dataset.mode = mode;
      document.querySelectorAll("[data-overview-mode]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.overviewMode === mode);
      });
      updateDateNavigation();
    }

    function updateDateNavigation() {
      const mode = ctx.getActiveView() === "overview" ? ctx.getOverviewMode() : "day";
      const labels = mode === "week" ? ["Предыдущая неделя", "Следующая неделя"]
        : mode === "month" ? ["Предыдущий месяц", "Следующий месяц"] : ["Предыдущий день", "Следующий день"];
      [ctx.els.prevDay, ctx.els.nextDay].forEach((button, index) => {
        button?.setAttribute("aria-label", labels[index]);
        button?.setAttribute("title", labels[index]);
      });
    }

    function scrollTop() {
      if (ctx.scrollActiveViewStart?.(ctx.getActiveView())) return;
      global.requestAnimationFrame(() => global.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    }

    return { handleNavigationChange, render, scrollTop, syncOverviewMode, syncRoute };
  }

  const api = { createAppShellController };
  global.RhythmAppShellController = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
