(function () {
  function createDesktopUpdateController({ bridge = window.rhythmDesktop, documentRef = document } = {}) {
    const panel = documentRef.querySelector("#desktopUpdatePanel");
    const status = documentRef.querySelector("#desktopUpdateStatus");
    const version = documentRef.querySelector("#desktopCurrentVersion");
    const checkButton = documentRef.querySelector("#desktopCheckUpdateButton");
    const releasesButton = documentRef.querySelector("#desktopOpenReleasesButton");
    const banner = documentRef.querySelector("#updateBanner");
    const bannerTitle = documentRef.querySelector("#updateBannerTitle");
    const bannerMessage = documentRef.querySelector("#updateBannerMessage");
    const applyButton = documentRef.querySelector("#applyUpdateButton");

    if (!bridge?.getUpdateStatus) {
      if (panel) panel.hidden = true;
      return { destroy() {} };
    }

    if (panel) panel.hidden = false;

    function render(next = {}) {
      if (panel) panel.dataset.updateState = next.state || "idle";
      if (version) version.textContent = next.currentVersion ? `Версия ${next.currentVersion}` : "Версия определяется…";
      if (status) status.textContent = next.message || "Обновления ещё не проверялись";

      const busy = ["checking", "downloading"].includes(next.state);
      if (checkButton) {
        checkButton.disabled = busy || next.state === "downloaded";
        checkButton.textContent = next.state === "checking" ? "Проверяем…" : "Проверить обновления";
      }

      if (next.state === "downloaded") {
        banner.dataset.updateSource = "desktop";
        banner.hidden = false;
        bannerTitle.textContent = "Обновление готово";
        bannerMessage.textContent = `${next.message}. Приложение перезапустится автоматически.`;
        applyButton.textContent = "Перезапустить";
        applyButton.disabled = false;
      } else if (banner?.dataset.updateSource === "desktop") {
        banner.hidden = true;
        delete banner.dataset.updateSource;
      }
    }

    checkButton?.addEventListener("click", async () => render(await bridge.checkForUpdates()));
    releasesButton?.addEventListener("click", () => bridge.openReleases());
    applyButton?.addEventListener("click", () => {
      if (banner?.dataset.updateSource !== "desktop") return;
      applyButton.disabled = true;
      applyButton.textContent = "Перезапускаем…";
      bridge.installUpdate();
    });

    const unsubscribe = bridge.onUpdateStatus?.(render);
    bridge.getUpdateStatus().then(render).catch(() => {
      render({ state: "error", message: "Не удалось получить состояние обновлений" });
    });

    return {
      destroy() {
        if (typeof unsubscribe === "function") unsubscribe();
      },
      render,
    };
  }

  window.RhythmDesktopUpdateController = { createDesktopUpdateController };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => createDesktopUpdateController(), { once: true });
  } else {
    createDesktopUpdateController();
  }
})();
