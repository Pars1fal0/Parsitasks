const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files"] });
  try {
    const context = await browser.newContext({ timezoneId: "Europe/Saratov", locale: "ru-RU" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.clock.install({ time: new Date("2026-10-21T22:30:00Z") });
    await page.addInitScript(() => {
      if (localStorage.getItem("rhythm-day-state-v1")) return;
      const stamp = "2026-10-21T08:00:00Z";
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify({ schemaVersion: 26, defaultsSeeded: true,
        profile: { timeZone: "America/Los_Angeles" },
        notes: [{ id: "audit-note", title: "Audit note", body: "Saved body", createdAt: stamp, updatedAt: stamp }],
        tasks: [], habits: [], boardItems: [], studySubjects: [{ id: "math", name: "Math" }],
        studyLessons: [{ id: "practice", subjectId: "math", weekday: 3, weekType: "all", lessonType: "practice", startTime: "17:00", endTime: "18:00" }],
      }));
    });
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1"; url.hash = "tasks";
    await page.goto(url.href); await page.locator("#pageTitle").waitFor();
    assert.equal(await page.evaluate(() => currentToday), "2026-10-21");
    await page.locator("#quickTaskInput").fill("Audit завтра"); await page.locator("#quickTaskInput").press("Enter");
    assert.equal(await page.evaluate(() => state.tasks[0].date), "2026-10-22");
    await page.evaluate(() => { location.hash = "study"; });
    await page.locator("#studyJumpToHomeworkForm").click();
    await page.locator('#studyHomeworkForm [name="subjectId"]').selectOption("math");
    assert.equal(await page.locator('#studyHomeworkForm [name="date"]').inputValue(), "2026-10-21");
    assert.equal(await page.locator('#studyHomeworkForm [name="time"]').inputValue(), "17:00");
    await page.locator("#studyHomeworkCancel").click();

    await page.evaluate(() => { location.hash = "journal"; });
    await page.locator(".notes-list-item").click();
    await page.locator("#noteBody").fill("Important unsaved draft");
    await page.evaluate(() => {
      window.auditSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "rhythm-day-state-v1") throw new DOMException("Audit quota", "QuotaExceededError");
        return window.auditSetItem.call(this, key, value);
      };
    });
    await page.locator("#noteDelete").click(); await page.locator("#confirmAccept").click();
    assert.equal(await page.evaluate(() => state.notes.length), 1);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).notes.length), 1);
    assert.match(await page.locator("#noteStatus").textContent(), /Не удалось удалить/);
    assert.equal(await page.locator("#noteBody").inputValue(), "Important unsaved draft");
    assert.ok(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.includes("note-draft"))));
    await page.reload(); await page.locator("#noteBody").waitFor();
    assert.equal(await page.locator("#noteBody").inputValue(), "Important unsaved draft");
    await page.locator('#noteForm button[type="submit"]').click();

    await page.evaluate(() => { location.hash = "board"; }); await page.locator("#boardView").waitFor({ state: "visible" });
    await page.evaluate(() => {
      boardAssets.prepareImage = async (file) => ({ blob: file, mime: "image/png", name: "audit.png", width: 1, height: 1 });
      boardAssets.uploadPrepared = async () => new Promise((resolve) => { window.auditUpload = resolve; });
    });
    const file = { name: "audit.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMJkAAAAASUVORK5CYII=", "base64") };
    await page.locator("#boardImageInput").setInputFiles(file); await page.waitForFunction(() => Boolean(window.auditUpload));
    await page.evaluate(() => {
      state.boardItems.push({ id: "concurrent-card", type: "text", text: "Created while uploading", width: 240, height: 160, x: 0, y: 0 });
      saveState(); boardView.render(); window.auditUpload("synthetic-owner/audit.png");
    });
    await page.waitForFunction(() => !document.querySelector("#boardAddImage").disabled);
    assert.ok(await page.evaluate(() => state.boardItems.some((item) => item.id === "concurrent-card")));
    assert.equal(await page.evaluate(() => state.boardItems.filter((item) => item.type === "image").length), 1);
    await page.locator("#boardUndo").click();
    assert.deepEqual(await page.evaluate(() => state.boardItems.map((item) => item.id)), ["concurrent-card"]);

    await page.evaluate(() => { window.auditUpload = null; });
    await page.locator("#boardImageInput").setInputFiles(file); await page.waitForFunction(() => Boolean(window.auditUpload));
    await page.evaluate(() => {
      state.boardItems.push({ id: "other-board", type: "board", text: "Other board", title: "Other board" });
      saveState(); boardView.render();
    });
    await page.locator("#boardSpaceSelect").selectOption("other-board");
    assert.equal(await page.locator("#boardSpaceSelect").inputValue(), "", "board switching stays guarded during upload");
    await page.evaluate(() => window.auditUpload("synthetic-owner/second.png"));
    await page.waitForFunction(() => !document.querySelector("#boardAddImage").disabled);
    assert.equal(await page.evaluate(() => state.boardItems.find((item) => item.type === "image").boardId), "");
    await page.locator("#boardSpaceSelect").selectOption("other-board");
    assert.equal(await page.locator("#boardSpaceSelect").inputValue(), "other-board");
    assert.deepEqual(errors, []);
    await context.close();
    console.log("Audit regressions passed: account clock, homework, note deletion recovery, concurrent board upload and target board isolation; all network blocked.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
