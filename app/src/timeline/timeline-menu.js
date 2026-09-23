(function (global) {
  function createTimelineMenu(ctx) {
    let openTaskMenu = null;
    ensureMenuDismissHandlers();

    function createTaskMenu(entry) {
      const wrap = document.createElement("div");
      const button = document.createElement("button");
      const menu = document.createElement("div");

      wrap.className = "timeline-task-menu-wrap";
      button.type = "button";
      button.className = "timeline-menu-button";
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", `Действия для задачи ${entry.title}`);
      button.textContent = "...";

      menu.className = "timeline-task-menu";
      menu.setAttribute("role", "menu");
      menu.hidden = true;
      menu.append(
        createMenuItem(entry.done ? "Снова активна" : "Завершить", "complete", () => ctx.toggleTaskDone?.(entry.task.id)),
        ...(Number.isFinite(entry.minutes)
          ? [createMenuItem("Создать рядом", "create-neighbor", () => ctx.createTaskBeside?.(entry))]
          : []),
        createMenuItem("Дублировать", "duplicate", () => ctx.duplicateTask?.(entry.task.id)),
        ...(Number.isFinite(entry.minutes)
          ? [createMenuItem("Убрать время", "unschedule", () => ctx.clearTaskTime?.(entry.task.id))]
          : []),
        createMenuItem("Открыть детали", "details", () => ctx.fillTaskForm(entry.task)),
        createMenuItem("Удалить", "delete", () => ctx.deleteTask?.(entry.task.id), "danger"),
      );

      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleTaskMenu(wrap);
      });

      wrap.append(button, menu);
      return wrap;
    }

    function createMenuItem(label, action, handler, tone = "") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = tone ? `timeline-menu-item is-${tone}` : "timeline-menu-item";
      button.dataset.action = action;
      button.setAttribute("role", "menuitem");
      button.textContent = label;
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeTaskMenu();
        handler();
      });
      return button;
    }

    function toggleTaskMenu(wrap) {
      const shouldOpen = openTaskMenu !== wrap;
      closeTaskMenu();
      if (!shouldOpen) return;
      const menu = wrap.querySelector(".timeline-task-menu");
      const button = wrap.querySelector(".timeline-menu-button");
      wrap.classList.add("is-open");
      wrap.closest(".timeline-task")?.classList.add("has-open-menu");
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      openTaskMenu = wrap;
      positionTaskMenu(wrap);
    }

    function positionTaskMenu(wrap) {
      const menu = wrap?.querySelector(".timeline-task-menu");
      const button = wrap?.querySelector(".timeline-menu-button");
      if (!menu || !button || menu.hidden) return;
      wrap.classList.remove("opens-up");
      const triggerRect = button.getBoundingClientRect();
      const menuHeight = menu.getBoundingClientRect().height;
      const roomAbove = triggerRect.top - 8;
      const roomBelow = global.innerHeight - triggerRect.bottom - 8;
      if (roomBelow < menuHeight && roomAbove > roomBelow) wrap.classList.add("opens-up");
    }

    function closeTaskMenu() {
      if (!openTaskMenu) return;
      const menu = openTaskMenu.querySelector(".timeline-task-menu");
      const button = openTaskMenu.querySelector(".timeline-menu-button");
      openTaskMenu.closest(".timeline-task")?.classList.remove("has-open-menu");
      openTaskMenu.classList.remove("is-open", "opens-up");
      if (menu) menu.hidden = true;
      if (button) button.setAttribute("aria-expanded", "false");
      openTaskMenu = null;
    }

    function ensureMenuDismissHandlers() {
      if (typeof document === "undefined") return;
      document.addEventListener("click", (event) => {
        if (!event.target.closest?.(".timeline-task-menu-wrap")) closeTaskMenu();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeTaskMenu();
      });
      document.addEventListener("scroll", () => positionTaskMenu(openTaskMenu), true);
      global.addEventListener?.("resize", () => positionTaskMenu(openTaskMenu));
    }

    return { closeTaskMenu, createTaskMenu };
  }

  const api = { createTimelineMenu };
  global.RhythmTimelineMenu = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
