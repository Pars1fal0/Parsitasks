const RELEASES_URL = "https://github.com/Pars1fal0/Parsitasks/releases/latest";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 12 * 1000;

function createUpdateManager({
  app,
  ipcMain,
  shell,
  getMainWindow,
  isAutomationTest = false,
  updater = null,
  validateSender = () => true,
}) {
  let checkTimer = null;
  let startupTimer = null;
  let status = {
    state: "idle",
    currentVersion: app.getVersion(),
    version: "",
    percent: 0,
    message: "Обновления ещё не проверялись",
    canAutoUpdate: false,
  };

  function sendStatus(patch = {}) {
    status = { ...status, ...patch, currentVersion: app.getVersion() };
    const window = getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send("updates:status", status);
    }
    return status;
  }

  function isPortableBuild() {
    return Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
  }

  function canAutoUpdate() {
    return app.isPackaged && !isPortableBuild() && !isAutomationTest;
  }

  function getUpdater() {
    if (!updater) updater = require("electron-updater").autoUpdater;
    return updater;
  }

  async function checkForUpdates({ manual = false } = {}) {
    if (!canAutoUpdate()) {
      return sendStatus({
        state: app.isPackaged && isPortableBuild() ? "portable" : "development",
        message: isPortableBuild()
          ? "Portable-версия обновляется вручную через GitHub Releases"
          : "Проверка обновлений доступна в установленной версии",
        canAutoUpdate: false,
      });
    }

    if (["checking", "downloading"].includes(status.state)) return status;

    sendStatus({
      state: "checking",
      message: manual ? "Проверяем GitHub Releases…" : "Проверяем обновления…",
      canAutoUpdate: true,
    });

    try {
      await getUpdater().checkForUpdates();
    } catch (error) {
      sendStatus({
        state: "error",
        message: readableUpdateError(error),
        canAutoUpdate: true,
      });
    }

    return status;
  }

  function registerIpc() {
    ipcMain.handle("updates:get-status", (event) => validateSender(event) ? status : untrustedSender());
    ipcMain.handle("updates:check", (event) => validateSender(event) ? checkForUpdates({ manual: true }) : untrustedSender());
    ipcMain.handle("updates:install", (event) => {
      if (!validateSender(event)) return untrustedSender();
      if (status.state !== "downloaded") return { ok: false, reason: "not-downloaded" };
      setImmediate(() => getUpdater().quitAndInstall(false, true));
      return { ok: true };
    });
    ipcMain.handle("updates:open-releases", async (event) => {
      if (!validateSender(event)) return untrustedSender();
      await shell.openExternal(RELEASES_URL);
      return { ok: true };
    });
  }

  function start() {
    if (!canAutoUpdate()) {
      checkForUpdates().catch(() => {});
      return;
    }

    const autoUpdater = getUpdater();
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on("checking-for-update", () => {
      sendStatus({
        state: "checking",
        message: "Проверяем обновления…",
        canAutoUpdate: true,
      });
    });
    autoUpdater.on("update-available", (info) => {
      sendStatus({
        state: "downloading",
        version: info.version || "",
        percent: 0,
        message: `Загружаем версию ${info.version || ""}…`,
        canAutoUpdate: true,
      });
    });
    autoUpdater.on("update-not-available", () => {
      sendStatus({
        state: "current",
        version: "",
        percent: 0,
        message: `Установлена актуальная версия ${app.getVersion()}`,
        canAutoUpdate: true,
        checkedAt: new Date().toISOString(),
      });
    });
    autoUpdater.on("download-progress", (progress) => {
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
      sendStatus({
        state: "downloading",
        percent,
        message: `Загружаем обновление: ${percent}%`,
        canAutoUpdate: true,
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      sendStatus({
        state: "downloaded",
        version: info.version || "",
        percent: 100,
        message: `Версия ${info.version || ""} готова к установке`,
        canAutoUpdate: true,
      });
    });
    autoUpdater.on("error", (error) => {
      sendStatus({
        state: "error",
        message: readableUpdateError(error),
        canAutoUpdate: true,
      });
    });

    startupTimer = setTimeout(() => checkForUpdates().catch(() => {}), STARTUP_CHECK_DELAY_MS);
    startupTimer.unref?.();
    checkTimer = setInterval(() => checkForUpdates().catch(() => {}), CHECK_INTERVAL_MS);
    checkTimer.unref?.();
  }

  function stop() {
    if (startupTimer) clearTimeout(startupTimer);
    if (checkTimer) clearInterval(checkTimer);
    startupTimer = null;
    checkTimer = null;
  }

  return {
    checkForUpdates,
    registerIpc,
    start,
    stop,
  };
}

function untrustedSender() {
  return { ok: false, reason: "untrusted-sender" };
}

function readableUpdateError(error) {
  const raw = String(error?.message || error || "");
  if (/net::|ENOTFOUND|ETIMEDOUT|ECONN/i.test(raw)) {
    return "Не удалось проверить обновления: нет связи с GitHub";
  }
  if (/404|latest\.yml|release/i.test(raw)) {
    return "Обновление пока не опубликовано в GitHub Releases";
  }
  return "Не удалось проверить обновления. Попробуй позже";
}

module.exports = {
  createUpdateManager,
  readableUpdateError,
};
