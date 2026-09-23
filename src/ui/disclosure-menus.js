(function (global) {
  const DISCLOSURE_SELECTOR = ".task-more, .habit-more, .goal-menu, .overdue-more, .nav-more";
  const MENU_SELECTOR = ".task-more-menu, .habit-more-menu, .goal-menu-popover, .overdue-more-menu, .nav-more-menu";

  function chooseMenuDirection(triggerRect, menuHeight, viewportHeight, gap = 8) {
    const roomAbove = triggerRect.top - gap;
    const roomBelow = viewportHeight - triggerRect.bottom - gap;
    if (roomBelow >= menuHeight) return "down";
    if (roomAbove >= menuHeight) return "up";
    return roomAbove > roomBelow ? "up" : "down";
  }

  function calculateMenuShift(menuRect, viewportWidth, gap = 8) {
    if (menuRect.left < gap) return gap - menuRect.left;
    if (menuRect.right > viewportWidth - gap) return viewportWidth - gap - menuRect.right;
    return 0;
  }

  function calculateMenuMaxHeight(triggerRect, viewportHeight, direction, gap = 8) {
    const available = direction === "up"
      ? triggerRect.top - gap
      : viewportHeight - triggerRect.bottom - gap;
    return Math.max(0, Math.floor(available));
  }

  function positionDisclosure(details, viewportHeight = global.innerHeight, viewportWidth = global.innerWidth) {
    const trigger = details.querySelector(":scope > summary");
    const menu = details.querySelector(MENU_SELECTOR);
    if (!trigger || !menu || !details.open) return;
    details.classList.remove("menu-opens-up", "menu-opens-down");
    menu.style.removeProperty("--menu-shift-x");
    menu.style.removeProperty("--menu-max-height");
    const triggerRect = trigger.getBoundingClientRect();
    const direction = chooseMenuDirection(triggerRect, menu.getBoundingClientRect().height, viewportHeight);
    details.classList.add(direction === "up" ? "menu-opens-up" : "menu-opens-down");
    menu.style.setProperty("--menu-max-height", `${calculateMenuMaxHeight(triggerRect, viewportHeight, direction)}px`);
    const shift = calculateMenuShift(menu.getBoundingClientRect(), viewportWidth);
    if (shift) menu.style.setProperty("--menu-shift-x", `${shift}px`);
  }

  function bindDisclosureMenus(root = document) {
    let positionFrame = 0;

    function openMenus() {
      return [...root.querySelectorAll(`${DISCLOSURE_SELECTOR}[open]`)];
    }

    function closeMenus(except = null, { restoreFocus = false } = {}) {
      openMenus().forEach((details) => {
        if (details === except) return;
        details.removeAttribute("open");
        details.classList.remove("menu-opens-up", "menu-opens-down");
        details.querySelector(MENU_SELECTOR)?.style.removeProperty("--menu-shift-x");
        details.querySelector(MENU_SELECTOR)?.style.removeProperty("--menu-max-height");
        if (restoreFocus) details.querySelector(":scope > summary")?.focus();
      });
    }

    function schedulePosition() {
      if (positionFrame) global.cancelAnimationFrame(positionFrame);
      positionFrame = global.requestAnimationFrame(() => {
        positionFrame = 0;
        openMenus().forEach((details) => positionDisclosure(details));
      });
    }

    root.addEventListener("toggle", (event) => {
      const details = event.target.closest?.(DISCLOSURE_SELECTOR);
      if (!details || event.target !== details) return;
      if (!details.open) {
        details.classList.remove("menu-opens-up", "menu-opens-down");
        details.querySelector(MENU_SELECTOR)?.style.removeProperty("--menu-shift-x");
        details.querySelector(MENU_SELECTOR)?.style.removeProperty("--menu-max-height");
        return;
      }
      closeMenus(details);
      positionDisclosure(details);
      schedulePosition();
    }, true);

    root.addEventListener("click", (event) => {
      const activeMenu = event.target.closest?.(DISCLOSURE_SELECTOR);
      closeMenus(activeMenu);
    });

    root.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !openMenus().length) return;
      event.preventDefault();
      closeMenus(null, { restoreFocus: true });
    });

    root.addEventListener("scroll", schedulePosition, true);
    global.addEventListener?.("resize", schedulePosition);

    return { closeMenus, positionDisclosure };
  }

  const api = {
    bindDisclosureMenus,
    calculateMenuMaxHeight,
    calculateMenuShift,
    chooseMenuDirection,
    positionDisclosure,
  };
  global.RhythmDisclosureMenus = api;
  if (typeof document !== "undefined") bindDisclosureMenus(document);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
