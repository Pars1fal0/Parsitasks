(function (global) {
  function createMcpActivityController(ctx) {
    async function undo(actionId) {
      const activity = ctx.getState().mcpActivity?.find((item) => item.id === actionId);
      if (!activity || activity.status === "undone") return;
      const confirmed = await ctx.confirmAction({
        title: "Отменить действие ChatGPT?",
        message: activity.summary || activity.title,
        acceptText: "Отменить действие",
      });
      if (!confirmed) return;
      const result = ctx.activityApi.undoActivity(ctx.getState(), actionId);
      if (!result.changed) return;
      ctx.replaceState(result.state);
      ctx.saveState();
      ctx.render();
      ctx.showToast("Действие ChatGPT отменено");
    }

    function render() {
      const container = ctx.container;
      if (!container) return;
      container.replaceChildren();
      const activity = ctx.activityApi.normalizeActivity(ctx.getState().mcpActivity).slice(0, 20);
      if (!activity.length) {
        const empty = document.createElement("p");
        empty.className = "mcp-activity-empty";
        empty.textContent = "ChatGPT пока не изменял данные приложения.";
        container.append(empty);
        return;
      }
      activity.forEach((item) => container.append(createRow(item)));
    }

    function createRow(item) {
      const row = document.createElement("article");
      row.className = "mcp-activity-row";
      if (item.status === "undone") row.classList.add("is-undone");

      const body = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.title;
      const summary = document.createElement("span");
      summary.textContent = item.summary;
      const meta = document.createElement("small");
      meta.textContent = item.status === "undone"
        ? `Отменено · ${ctx.formatDate(item.undoneAt || item.updatedAt)}`
        : ctx.formatDate(item.createdAt);
      body.append(title, summary, meta);
      row.append(body);

      if (item.status !== "undone") {
        const button = document.createElement("button");
        button.className = "ghost-button compact-button";
        button.type = "button";
        button.textContent = "Отменить";
        button.addEventListener("click", () => undo(item.id));
        row.append(button);
      }
      return row;
    }

    return { render, undo };
  }

  const api = { createMcpActivityController };
  global.RhythmMcpActivityController = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
