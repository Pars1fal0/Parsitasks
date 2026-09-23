(function () {
  function createToastController({ element, restoreUndoSnapshot, defaultTimeout = 2600, undoTimeout = 10000 }) {
    let toastTimer = null;
    let undoTimer = null;

    function showToast(message, options = {}) {
      element.replaceChildren();
      const text = document.createElement("span");
      text.textContent = message;
      element.appendChild(text);

      if (options.action?.label && typeof options.action.onClick === "function") {
        const actionButton = document.createElement("button");
        actionButton.type = "button";
        actionButton.textContent = options.action.label;
        actionButton.addEventListener("click", options.action.onClick);
        element.appendChild(actionButton);
      }

      if (options.undo) {
        const undoButton = document.createElement("button");
        undoButton.type = "button";
        undoButton.textContent = "Отменить";
        undoButton.addEventListener("click", () => {
          clearTimeout(toastTimer);
          clearTimeout(undoTimer);
          restoreUndoSnapshot(options.undo);
        });
        element.appendChild(undoButton);
      }

      element.classList.add("is-visible");
      element.classList.toggle("has-action", Boolean(options.undo || options.action));
      clearTimeout(toastTimer);
      clearTimeout(undoTimer);
      const timeout = options.undo || options.action ? undoTimeout : defaultTimeout;
      toastTimer = setTimeout(() => {
        element.classList.remove("is-visible");
        element.classList.remove("has-action");
      }, timeout);
      undoTimer = setTimeout(() => {}, timeout);
    }

    return { showToast };
  }

  window.RhythmToast = { createToastController };
})();
