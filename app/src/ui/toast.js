(function () {
  function createToastController({ element, restoreUndoSnapshot, defaultTimeout = 2600, undoTimeout = 10000 }) {
    let toastTimer = null;
    let undoTimer = null;

    function hideToast() {
      clearTimeout(toastTimer);
      clearTimeout(undoTimer);
      element.classList.remove("is-visible", "has-action");
      element.hidden = true;
    }

    function showToast(message, options = {}) {
      element.replaceChildren();
      const text = document.createElement("span");
      text.textContent = message;
      text.className = "toast-message";
      text.title = message;
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
          hideToast();
          restoreUndoSnapshot(options.undo);
        });
        element.appendChild(undoButton);
      }

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "toast-close";
      closeButton.setAttribute("aria-label", "Закрыть уведомление");
      closeButton.title = "Закрыть уведомление";
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.classList.add("ui-icon");
      icon.setAttribute("aria-hidden", "true");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", "#icon-close");
      icon.append(use);
      closeButton.append(icon);
      closeButton.addEventListener("click", hideToast);
      element.appendChild(closeButton);

      element.hidden = false;
      element.classList.add("is-visible");
      element.classList.toggle("has-action", Boolean(options.undo || options.action));
      clearTimeout(toastTimer);
      clearTimeout(undoTimer);
      const timeout = options.undo || options.action ? undoTimeout : defaultTimeout;
      toastTimer = setTimeout(hideToast, timeout);
      undoTimer = setTimeout(() => {}, timeout);
    }

    return { showToast };
  }

  window.RhythmToast = { createToastController };
})();
