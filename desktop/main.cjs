const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, session, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { createUpdateManager } = require("./update-manager.cjs");
const reminderPolicy = require("../app/src/platform/reminder-policy.js");

const appRoot = path.join(__dirname, "..", "app");
const isSmokeTest = process.argv.includes("--smoke-test");
const isE2eTest = process.argv.includes("--e2e-test");
const isAutomationTest = isSmokeTest || isE2eTest;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let backgroundNoticeShown = false;
let reminderSnapshot = [];
let reminderQuietHours = reminderPolicy.normalizeQuietHours();
let lastFileBackupAt = 0;
let updateManager = null;
const sentReminders = new Set();
const FILE_BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_FILE_BACKUPS = 20;
const MAX_FILE_BACKUP_BYTES = 25 * 1024 * 1024;
const MAX_REMINDERS = 5000;

if (isAutomationTest) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("in-process-gpu");
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rhythm-day-smoke-"));
  const smokeDocuments = path.join(smokeRoot, "documents");
  fs.mkdirSync(smokeDocuments, { recursive: true });
  app.setPath("userData", path.join(smokeRoot, "userData"));
  app.setPath("documents", smokeDocuments);
}

app.setAppUserModelId("local.rhythm-day.tracker");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: isAutomationTest ? 320 : 900,
    minHeight: isAutomationTest ? 600 : 640,
    show: !isSmokeTest,
    title: "Parsitasks",
    backgroundColor: "#090d10",
    icon: path.join(appRoot, "assets", "icons", "icon-256.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!isSmokeTest) {
      mainWindow.show();
    }
  });

  if (!isAutomationTest) {
    mainWindow.on("close", (event) => {
      if (isQuitting) return;
      event.preventDefault();
      mainWindow.hide();
      showBackgroundNotice();
    });
  }

  if (isSmokeTest) require("./smoke-test.cjs").attachSmokeTest(app, mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === mainWindow.webContents.getURL() || isInternalAppNavigation(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) shell.openExternal(url).catch(() => {});
  });

  mainWindow.loadFile(
    path.join(appRoot, "index.html"),
    isAutomationTest ? { query: { automation: "1" } } : undefined,
  );
}

function isInternalAppNavigation(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") return false;
    const target = path.resolve(fileURLToPath(parsed));
    const relative = path.relative(appRoot, target).replaceAll("\\", "/");
    return ["auth.html", "index.html", "landing.html"].includes(relative);
  } catch {
    return false;
  }
}

function createTray() {
  if (isAutomationTest || tray) return;

  const image = nativeImage.createFromPath(path.join(appRoot, "assets", "icons", "icon-256.png"));
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip("Parsitasks");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Открыть Parsitasks",
        click: showMainWindow,
      },
      {
        label: "Проверить напоминания",
        click: checkReminders,
      },
      { type: "separator" },
      {
        label: "Выйти",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showMainWindow);
}

function showMainWindow() {
  if (!mainWindow) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function showBackgroundNotice() {
  if (backgroundNoticeShown || !Notification.isSupported()) return;
  backgroundNoticeShown = true;
  new Notification({
    title: "Parsitasks работает в фоне",
    body: "Окно закрыто, но напоминания останутся активными через трей.",
    silent: true,
  }).show();
}

function createMenu() {
  const template = [
    {
      label: "Файл",
      submenu: [
        {
          label: "Скрыть в трей",
          click: () => mainWindow?.hide(),
        },
        {
          label: "Выйти",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: "Вид",
      submenu: [
        {
          label: "Обновить",
          role: "reload",
        },
        {
          label: "Масштаб +",
          role: "zoomIn",
        },
        {
          label: "Масштаб -",
          role: "zoomOut",
        },
        {
          label: "Сбросить масштаб",
          role: "resetZoom",
        },
      ],
    },
    {
      label: "Окно",
      submenu: [
        {
          label: "Свернуть",
          role: "minimize",
        },
        {
          label: "Показать",
          click: showMainWindow,
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.on("reminders:sync", (event, payload) => {
    if (!isTrustedIpcEvent(event)) return;
    reminderSnapshot = normalizeReminderSnapshot(payload);
    reminderQuietHours = reminderPolicy.normalizeQuietHours(payload?.quietHours);
    checkReminders();
  });

  ipcMain.handle("reminders:test", (event) => {
    if (!isTrustedIpcEvent(event)) return { ok: false, reason: "untrusted-sender" };
    showNotification({
      id: `test-${Date.now()}`,
      title: "Напоминания активны",
      body: "Parsitasks сможет напоминать о задачах, пока приложение работает в фоне.",
    });
    return true;
  });

  ipcMain.handle("backups:write-file", async (event, payload) => {
    if (!isTrustedIpcEvent(event)) return { ok: false, reason: "untrusted-sender" };
    return writeFileBackup(payload);
  });

  ipcMain.handle("backups:info", async (event) => {
    if (!isTrustedIpcEvent(event)) return { ok: false, reason: "untrusted-sender" };
    return getFileBackupInfo();
  });

  ipcMain.handle("backups:open-folder", async (event) => {
    if (!isTrustedIpcEvent(event)) return { ok: false, reason: "untrusted-sender" };
    const info = await getFileBackupInfo();
    const backupDir = info.latest?.path ? path.dirname(info.latest.path) : getFileBackupDir();
    await fs.promises.mkdir(backupDir, { recursive: true });
    if (isSmokeTest) return { ok: true, path: backupDir, smoke: true };
    const error = await shell.openPath(backupDir);
    if (!error) return { ok: true, path: backupDir };
    try {
      shell.showItemInFolder(backupDir);
      return { ok: true, path: backupDir, fallback: "showItemInFolder", error };
    } catch {
      return { ok: false, path: backupDir, error };
    }
  });
}

// Study materials are stored as Google Drive links; Calendar OAuth is handed off to the web version.
const EXTERNAL_HOSTS = new Set(["github.com", "parsitasks.ru", "www.parsitasks.ru", "drive.google.com", "docs.google.com"]);

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && EXTERNAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function isTrustedIpcEvent(event) {
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && event?.sender === mainWindow.webContents
    && event?.senderFrame === mainWindow.webContents.mainFrame
  );
}

function configureSessionSecurity() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

function normalizeReminderSnapshot(payload) {
  if (!Array.isArray(payload?.reminders)) return [];
  return payload.reminders.slice(0, MAX_REMINDERS).flatMap((reminder) => {
    const id = String(reminder?.id || "").slice(0, 240);
    const title = String(reminder?.title || "").slice(0, 240);
    const reminderAt = String(reminder?.reminderAt || "");
    const dueAt = String(reminder?.dueAt || "");
    if (!id || !title || !Number.isFinite(Date.parse(reminderAt)) || !Number.isFinite(Date.parse(dueAt))) return [];
    return [{
      id,
      title,
      category: String(reminder?.category || "").slice(0, 120),
      reminderAt,
      dueAt,
      taskId: String(reminder?.taskId || "").slice(0, 240),
      habitId: String(reminder?.habitId || "").slice(0, 240),
      reminderKind: ["task-work", "habit"].includes(reminder?.reminderKind) ? reminder.reminderKind : "task",
      dateKey: /^\d{4}-\d{2}-\d{2}$/.test(reminder?.dateKey) ? reminder.dateKey : "",
    }];
  });
}

async function writeFileBackup(payload) {
  const now = Date.now();
  if (now - lastFileBackupAt < FILE_BACKUP_INTERVAL_MS) {
    return { ok: false, reason: "throttled" };
  }

  if (!payload?.state || typeof payload.state !== "object") {
    return { ok: false, reason: "invalid-payload" };
  }

  const backup = {
    app: "Parsitasks",
    schemaVersion: payload.schemaVersion || 1,
    exportedAt: new Date(now).toISOString(),
    state: payload.state,
  };

  let serialized;
  try {
    serialized = JSON.stringify(backup, null, 2);
  } catch {
    return { ok: false, reason: "invalid-payload" };
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_FILE_BACKUP_BYTES) {
    return { ok: false, reason: "payload-too-large" };
  }

  const backupDir = getFileBackupDir();
  const fileName = `parsitasks-${new Date(now).toISOString().replace(/[:.]/g, "-")}.json`;
  const filePath = path.join(backupDir, fileName);

  await fs.promises.mkdir(backupDir, { recursive: true });
  await fs.promises.writeFile(filePath, serialized, "utf8");
  lastFileBackupAt = now;
  await pruneFileBackups(backupDir);

  return { ok: true, path: filePath };
}

function getFileBackupDir() {
  return path.join(app.getPath("documents"), "Parsitasks", "backups");
}

function getLegacyFileBackupDir() {
  return path.join(app.getPath("documents"), "Ритм дня", "backups");
}

async function getFileBackupInfo() {
  const backupDir = getFileBackupDir();
  const backupDirs = [...new Set([backupDir, getLegacyFileBackupDir()])];
  const backups = (await Promise.all(backupDirs.map(async (directory) => {
    try {
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      return Promise.all(
        entries
          .filter((entry) => entry.isFile() && /^(?:ritm-dnya|parsitasks)-.*\.json$/i.test(entry.name))
          .map(async (entry) => {
            const filePath = path.join(directory, entry.name);
            const stat = await fs.promises.stat(filePath);
            return { name: entry.name, path: filePath, mtimeMs: stat.mtimeMs };
          }),
      );
    } catch {
      return [];
    }
  }))).flat();
  const latest = backups.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
  return { ok: true, path: latest?.path ? path.dirname(latest.path) : backupDir, latest };
}

async function pruneFileBackups(backupDir) {
  const entries = await fs.promises.readdir(backupDir, { withFileTypes: true });
  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^(?:ritm-dnya|parsitasks)-.*\.json$/i.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(backupDir, entry.name);
        const stat = await fs.promises.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      }),
  );

  backups
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(MAX_FILE_BACKUPS)
    .forEach((backup) => {
      fs.promises.unlink(backup.filePath).catch(() => {});
    });
}

function checkReminders() {
  if (isAutomationTest) return;
  if (!Notification.isSupported()) return;

  const now = Date.now();
  if (reminderPolicy.nextAllowed(new Date(now), reminderQuietHours).getTime() > now) return;
  reminderSnapshot.forEach((reminder) => {
    const reminderAt = Date.parse(reminder.reminderAt);
    const dueAt = Date.parse(reminder.dueAt);
    if (!Number.isFinite(reminderAt) || !Number.isFinite(dueAt)) return;
    if (reminderAt > now || dueAt < now - 86400000) return;
    if (sentReminders.has(reminder.id)) return;

    sentReminders.add(reminder.id);
    showNotification({
      id: reminder.id,
      title: reminder.title,
      body: reminderBody(reminder),
      reminder,
    });
    mainWindow?.webContents.send("reminders:delivered", reminder);
  });
}

function reminderBody(reminder) {
  const due = new Date(reminder.dueAt);
  const time = due.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const parts = [`${reminder.reminderKind === "task-work" ? "начать в" : "до"} ${time}`];
  if (reminder.category) parts.push(reminder.category);
  return parts.join(" · ");
}

function showNotification({ title, body, reminder }) {
  const notification = new Notification({ title, body, icon: path.join(appRoot, "assets", "icons", "icon-256.png") });
  notification.on("click", () => {
    showMainWindow();
    if (reminder) mainWindow?.webContents.send("reminders:clicked", reminder);
  });
  notification.show();
}

app.whenReady().then(() => {
  configureSessionSecurity();
  updateManager = createUpdateManager({
    app,
    ipcMain,
    shell,
    getMainWindow: () => mainWindow,
    isAutomationTest,
    validateSender: isTrustedIpcEvent,
  });
  updateManager.registerIpc();
  registerIpc();
  createMenu();
  createTray();
  createWindow();
  updateManager.start();
  setInterval(checkReminders, 15000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  updateManager?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  if (isQuitting || isAutomationTest) {
    app.quit();
  }
});
