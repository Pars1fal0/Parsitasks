(function (global) {
  function createConfirmDialog(ctx) {
    let resolver = null;
    let previouslyFocused = null;
    let verificationText = "";
    let originalParent = null;
    let originalNext = null;

    function confirmAction({
      cancelLabel = "Отмена",
      confirmLabel = "Подтвердить",
      message = "",
      details = [],
      secondaryLabel = "",
      tone = "default",
      title = "Подтвердить действие?",
      verificationLabel = "",
      verificationText: expectedVerificationText = "",
    } = {}) {
      if (!ctx.els.confirmModal) return Promise.resolve(false);

      close(false, { silent: true });
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const nativeDialog = document.querySelector("dialog[open]:modal");
      if (nativeDialog && !nativeDialog.contains(ctx.els.confirmModal)) {
        originalParent = ctx.els.confirmModal.parentNode;
        originalNext = ctx.els.confirmModal.nextSibling;
        nativeDialog.append(ctx.els.confirmModal);
      }
      ctx.els.confirmTitle.textContent = title;
      ctx.els.confirmMessage.textContent = message;
      ctx.els.confirmModal.querySelector(".confirm-details")?.remove();
      if (Array.isArray(details) && details.length) {
        const list = document.createElement("dl"); list.className = "confirm-details";
        details.slice(0, 20).forEach((item) => {
          const label = document.createElement("dt"); label.textContent = String(item.label || "");
          const value = document.createElement("dd"); value.textContent = String(item.value ?? "");
          list.append(label, value);
        });
        ctx.els.confirmMessage.after(list);
      }
      ctx.els.confirmCancel.textContent = cancelLabel;
      ctx.els.confirmSecondary.textContent = secondaryLabel;
      ctx.els.confirmSecondary.hidden = !secondaryLabel;
      ctx.els.confirmAccept.textContent = confirmLabel;
      ctx.els.confirmAccept.dataset.tone = tone;
      verificationText = String(expectedVerificationText || "").trim().toLocaleLowerCase();
      if (ctx.els.confirmVerification) ctx.els.confirmVerification.hidden = !verificationText;
      if (ctx.els.confirmVerificationLabel) {
        ctx.els.confirmVerificationLabel.textContent = verificationLabel || "Введи текст для подтверждения";
      }
      if (ctx.els.confirmVerificationInput) {
        ctx.els.confirmVerificationInput.value = "";
        ctx.els.confirmVerificationInput.hidden = !verificationText;
      }
      syncAcceptState();
      ctx.els.confirmModal.hidden = false;
      if (verificationText) ctx.els.confirmVerificationInput?.focus();
      else ctx.els.confirmAccept.focus();

      return new Promise((resolve) => {
        resolver = resolve;
      });
    }

    function bindEvents() {
      ctx.els.confirmAccept?.addEventListener("click", () => close(true));
      ctx.els.confirmCancel?.addEventListener("click", () => close(false));
      ctx.els.confirmSecondary?.addEventListener("click", () => close("secondary"));
      ctx.els.confirmVerificationInput?.addEventListener("input", syncAcceptState);
      ctx.els.confirmModal?.querySelector("[data-confirm-cancel]")?.addEventListener("click", () => close(false));
      document.addEventListener("keydown", (event) => {
        if (ctx.els.confirmModal?.hidden) return;
        if (event.key === "Escape") {
          event.preventDefault();
          close(false);
          return;
        }
        if (event.key === "Tab") trapFocus(event);
      });
    }

    function close(value, { silent = false } = {}) {
      if (ctx.els.confirmModal) ctx.els.confirmModal.hidden = true;
      if (originalParent) {
        originalParent.insertBefore(ctx.els.confirmModal, originalNext?.parentNode === originalParent ? originalNext : null);
        originalParent = null; originalNext = null;
      }
      verificationText = "";
      const focusTarget = previouslyFocused;
      previouslyFocused = null;
      if (!silent && focusTarget?.isConnected) focusTarget.focus();
      if (!silent && resolver) {
        const resolve = resolver;
        resolver = null;
        resolve(value);
      }
    }

    function syncAcceptState() {
      if (!ctx.els.confirmAccept) return;
      const entered = String(ctx.els.confirmVerificationInput?.value || "").trim().toLocaleLowerCase();
      ctx.els.confirmAccept.disabled = Boolean(verificationText) && entered !== verificationText;
    }

    function trapFocus(event) {
      const focusable = getFocusableElements();
      if (!focusable.length) {
        event.preventDefault();
        ctx.els.confirmAccept?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function getFocusableElements() {
      return [...ctx.els.confirmModal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
        (element) => !element.disabled && element.offsetParent !== null,
      );
    }

    return {
      bindEvents,
      confirm: confirmAction,
    };
  }

  global.RhythmConfirmDialog = { createConfirmDialog };
})(window);
