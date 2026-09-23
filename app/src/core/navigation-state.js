(function (global) {
  const VIEW_TO_ROUTE = {
    archive: "archive",
    board: "board",
    goals: "goals",
    habits: "habits",
    journal: "journal",
    nutrition: "nutrition",
    overview: "calendar",
    settings: "settings",
    tasks: "tasks",
    timeline: "timeline",
  };

  const ROUTE_TO_VIEW = Object.fromEntries(
    Object.entries(VIEW_TO_ROUTE).map(([view, route]) => [route, view]),
  );
  const OVERVIEW_MODES = new Set(["week", "month", "year"]);

  function parseHash(hash) {
    const route = String(hash || "").replace(/^#\/?/, "").replace(/\/$/, "");
    if (!route) return null;
    const [routeView, routeMode] = route.split("/");
    const view = ROUTE_TO_VIEW[routeView];
    if (!view) return null;
    return {
      view,
      overviewMode: view === "overview" && OVERVIEW_MODES.has(routeMode) ? routeMode : null,
    };
  }

  function buildHash(view, overviewMode) {
    const route = VIEW_TO_ROUTE[view] || VIEW_TO_ROUTE.tasks;
    if (view !== "overview") return `#${route}`;
    const mode = OVERVIEW_MODES.has(overviewMode) ? overviewMode : "week";
    return `#${route}/${mode}`;
  }

  global.RhythmNavigationState = { buildHash, parseHash };
  if (typeof module !== "undefined" && module.exports) module.exports = { buildHash, parseHash };
})(typeof window !== "undefined" ? window : globalThis);
