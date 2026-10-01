const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({ args: [path.resolve(__dirname, ".."), "--e2e-test"], executablePath: require("electron") });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  const capture = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-release-reliability-"));
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
  const go = async (view) => {
    await page.evaluate((hash) => { location.hash = hash; }, view);
    await page.locator(`#${view}View`).waitFor({ state: "visible" });
  };
  const openData = async () => {
    await go("settings");
    await page.locator("#dataSettingsHeading").evaluate((heading) => { heading.closest("details").open = true; });
  };
  try {
    await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      state.tasks = [{ id: "current", title: "Текущее дело", date: day(0), repeat: "none", completed: {} }];
      state.goals = []; state.taskOrder = {};
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      localStorage.setItem("rhythm-day-backup-v1", JSON.stringify({ app: "Parsitasks", exportedAt: new Date().toISOString(),
        state: { ...state, tasks: [{ id: "backup", title: "Восстановленное дело", date: day(-1), repeat: "none", completed: {} }] } }));
    });
    await page.reload(); await page.waitForSelector("#pageTitle");
    await page.locator('[data-task-pane="backlog"]').click();
    assert.match(await page.locator("#taskEmpty").innerText(), /Сегодняшние остаются/);
    await openData();
    await page.evaluate(() => {
      window.restoreStorageWrite = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "rhythm-day-state-v1") throw new DOMException("Quota exceeded", "QuotaExceededError");
        return window.restoreStorageWrite.call(this, key, value);
      };
    });
    await page.locator("#settingsRestoreBackupButton").click(); await page.locator("#confirmAccept").click();
    assert.equal((await stored()).tasks[0].id, "current");
    assert.match(await page.locator("#appToast").innerText(), /Не удалось записать/);
    await go("tasks"); await page.locator('[data-task-pane="day"]').click();
    assert.match(await page.locator("#taskList").innerText(), /Текущее дело/);
    await page.evaluate(() => { Storage.prototype.setItem = window.restoreStorageWrite; });
    await openData(); await page.locator("#settingsRestoreBackupButton").click(); await page.locator("#confirmAccept").click();
    assert.equal((await stored()).tasks[0].id, "backup");
    assert.match(await page.locator("#appToast").innerText(), /Данные восстановлены/);
    await page.evaluate(() => localStorage.setItem("rhythm-day-state-v1", '{"tasks":{}}'));
    await page.reload(); await page.waitForSelector("#pageTitle");
    assert.equal((await stored()).tasks[0].id, "backup");
    assert.equal(await page.evaluate(() => localStorage.getItem("rhythm-day-corrupt-state-v1")), '{"tasks":{}}');
    await page.setViewportSize({ width: 390, height: 844 }); await go("tasks");
    await page.locator('[data-task-pane="backlog"]').click();
    assert.equal(await page.locator("#taskBacklogBadge").innerText(), "1");
    assert.match(await page.locator("#historicalTaskList").innerText(), /Восстановленное дело/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(capture, "recovered-backlog-mobile.png"), animations: "disabled" });
    await openData();
    await page.locator("#importFile").setInputFiles({ name: "invalid-study.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ studyLessons: {} })) });
    assert.equal((await stored()).tasks[0].id, "backup");
    assert.match(await page.locator("#appToast").innerText(), /Не удалось импортировать/);
    assert.deepEqual(errors, []);
    console.log(`e2e ok - storage quota rollback, backup restore, corrupt-state recovery, unfinished explanation and invalid import; screenshots: ${capture}`);
  } catch (error) {
    await page.screenshot({ path: path.join(capture, "failed.png"), fullPage: true }).catch(() => {});
    console.error(`release reliability failure screenshot: ${capture}`); throw error;
  } finally {
    await app.evaluate(({ app: main }) => main.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
