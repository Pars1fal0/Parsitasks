(function (global) {
  function createRemoteAuthController(ctx) {
    let busy = false;

    ctx.els.remoteAuthSignOutButton?.addEventListener("click", signOut);

    async function signOut() {
      if (busy) return;
      busy = true;
      render();
      try {
        await ctx.auth.signOut();
        ctx.onSignedOut?.();
      } catch {
        ctx.showToast("Не удалось завершить выход. Повтори попытку");
      } finally {
        busy = false;
        render();
        ctx.renderSyncStatus?.();
      }
    }

    function render() {
      const session = ctx.auth.getSession();
      const email = session?.user?.email || "";
      if (ctx.els.remoteAuthStatus) {
        ctx.els.remoteAuthStatus.textContent = busy
          ? "Выходим из аккаунта..."
          : email
            ? email
            : "Сессия аккаунта завершена";
      }
      if (ctx.els.remoteAuthSignOutButton) {
        ctx.els.remoteAuthSignOutButton.hidden = !session;
        ctx.els.remoteAuthSignOutButton.disabled = busy;
      }
      ctx.syncCloudControls?.();
    }

    render();
    return { render };
  }

  const api = { createRemoteAuthController };
  global.RhythmRemoteAuthController = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
