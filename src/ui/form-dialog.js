(function (global) {
  function createFormDialogManager(options = {}) {
    const panels = (options.panels || []).filter(Boolean);
    const compactQuery = global.matchMedia?.("(max-width: 1280px)");
    const backdrop = options.backdrop;
    let activePanel = null;
    let returnFocus = null;

    panels.forEach((panel) => {
      new MutationObserver(() => syncPanel(panel)).observe(panel, { attributes: true, attributeFilter: ["class"] });
      panel.addEventListener("keydown", trapKeys);
    });
    backdrop?.addEventListener("click", closeActive);
    compactQuery?.addEventListener?.("change", syncMode);

    function syncPanel(panel) {
      if (!panel.classList.contains("is-collapsed")) {
        activate(panel);
      } else if (activePanel === panel) {
        deactivate();
      }
    }

    function activate(panel) {
      if (activePanel !== panel) returnFocus = document.activeElement;
      activePanel = panel;
      syncMode();
    }

    function syncMode() {
      const modal = Boolean(activePanel && compactQuery?.matches);
      panels.forEach((panel) => {
        const isActive = panel === activePanel && !panel.classList.contains("is-collapsed");
        if (isActive && modal) {
          panel.setAttribute("role", "dialog");
          panel.setAttribute("aria-modal", "true");
        } else {
          panel.removeAttribute("role");
          panel.removeAttribute("aria-modal");
        }
      });
      if (backdrop) backdrop.hidden = !modal;
      document.body.classList.toggle("form-dialog-open", modal);
    }

    function trapKeys(event) {
      if (event.currentTarget !== activePanel || !compactQuery?.matches) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeActive();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable(activePanel);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function closeActive() {
      if (!activePanel) return;
      activePanel.querySelector('[aria-label="Закрыть форму"]')?.click();
    }

    function deactivate() {
      const target = returnFocus;
      activePanel = null;
      returnFocus = null;
      syncMode();
      if (target?.isConnected) global.setTimeout(() => target.focus(), 0);
    }

    panels.forEach(syncPanel);
    return { syncMode };
  }

  function getFocusable(root) {
    return [...root.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hidden && element.offsetParent !== null);
  }

  const api = { createFormDialogManager, getFocusable };
  global.RhythmFormDialog = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
