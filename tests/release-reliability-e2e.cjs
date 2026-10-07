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
    await page.evaluate((hash) => { location.hash = hash; }, view === "overview" ? "calendar" : view);
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
    const futureRaw = await page.evaluate(() => {
      const future = { ...JSON.parse(localStorage.getItem("rhythm-day-state-v1")), schemaVersion: SCHEMA_VERSION + 1, futureOnly: { keep: "unknown-data" } };
      future.tasks = [{ id: "future-safe", title: "Дело из новой версии", date: activeDate, repeat: "none", completed: {} }];
      const raw = JSON.stringify(future);
      localStorage.setItem("rhythm-day-state-v1", raw);
      return raw;
    });
    await page.reload(); await page.waitForSelector("#pageTitle");
    await go("tasks"); await page.locator('[data-task-pane="day"]').click();
    assert.match(await page.locator("#saveStatus").innerText(), /более новой версией/);
    assert.ok(await page.locator("#saveStatus").isVisible());
    await page.locator('[data-task-id="future-safe"] .check-button').click();
    assert.equal(await page.evaluate(() => localStorage.getItem("rhythm-day-state-v1")), futureRaw);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const view of ["tasks", "habits", "overview"]) {
        await go(view);
        assert.ok(await page.locator("#saveStatus").isVisible());
        const layout = await page.evaluate(() => {
          const status = document.querySelector("#saveStatus").getBoundingClientRect();
          const search = document.querySelector("#globalSearchButton").getBoundingClientRect();
          return { fits: document.documentElement.scrollWidth <= innerWidth + 1,
            separate: status.right <= search.left || status.bottom <= search.top || status.top >= search.bottom };
        });
        assert.ok(layout.fits && layout.separate, `critical save status fits ${view} at ${width}px: ${JSON.stringify(layout)}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await go("tasks");
    const exportPayload = async () => page.evaluate(async () => {
      const create = URL.createObjectURL;
      const click = HTMLAnchorElement.prototype.click;
      let exported;
      try {
        URL.createObjectURL = (blob) => { exported = blob; return create.call(URL, blob); };
        HTMLAnchorElement.prototype.click = () => {};
        exportData();
        return JSON.parse(await exported.text());
      } finally { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; }
    });
    assert.equal((await exportPayload()).state.futureOnly.keep, "unknown-data");
    assert.equal(await page.evaluate(() => localStorage.getItem("rhythm-day-state-v1")), futureRaw);
    await page.evaluate(() => localStorage.setItem("rhythm-day-state-v1", "{future-corrupt"));
    await page.reload(); await page.waitForSelector("#pageTitle");
    assert.match(await page.locator("#saveStatus").innerText(), /более новой версией/);
    assert.equal(await page.evaluate(() => localStorage.getItem("rhythm-day-state-v1")), "{future-corrupt");
    assert.equal((await exportPayload()).state.futureOnly.keep, "unknown-data");
    await page.screenshot({ path: path.join(capture, "newer-schema-mobile.png"), animations: "disabled" });
    assert.deepEqual(errors, []);
    console.log(`e2e ok - storage quota rollback, backup restore, corrupt-state recovery, incompatible schemas, lossless future export and invalid import; screenshots: ${capture}`);
  } catch (error) {
    await page.screenshot({ path: path.join(capture, "failed.png"), fullPage: true }).catch(() => {});
    console.error(`release reliability failure screenshot: ${capture}`); throw error;
  } finally {
    await app.evaluate(({ app: main }) => main.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
