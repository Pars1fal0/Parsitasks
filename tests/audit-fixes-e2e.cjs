const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-audit-fixes-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Europe/Saratov" });
    let uploadStarts = 0;
    await context.route(/^https?:/, async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const data = pathname === "/api/google-drive/status" ? { configured: true, connected: true }
        : pathname === "/api/google-drive/upload-start" ? (uploadStarts++, { session: "synthetic-session", chunkSize: 5242880 })
          : pathname === "/api/google-drive/upload-chunk" ? { complete: true, file: { id: "synthetic-file", name: "Synthetic.txt", mime: "text/plain", size: 4, url: "https://drive.google.com/file/d/synthetic-file/view" } } : null;
      if (data) await route.fulfill({ json: data }); else await route.abort();
    });
    const a = await context.newPage(); a.setDefaultTimeout(6000);
    const errors = []; a.on("pageerror", (error) => errors.push(error.message));
    await a.clock.install({ time: new Date("2026-10-05T10:00:00+04:00") });
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html")); url.search = "automation=1"; url.hash = "tasks";
    await a.goto(url.href); await require("./navigation-fixture.cjs").enableAllSections(a);
    await a.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      Object.assign(state, { tasks: [
        { id: "short", title: "Короткая задача", date: "2026-10-05", repeat: "none", scheduleMode: "block", startTime: "10:00", endTime: "10:15", time: "10:15", completed: {} },
        { id: "untimed", title: "Дело без времени", date: "2026-10-05", repeat: "none", completed: {}, dueDate: "2026-10-05" },
      ], habits: [], goals: [], notes: [{ id: "note", title: "Совместная заметка", body: "Начальный текст", createdAt: "2026-10-05T05:00:00.000Z", updatedAt: "2026-10-05T05:00:00.000Z" }],
        studySubjects: [{ id: "math", name: "Математика", color: "#7ca6ff" }],
        studyLessons: [{ id: "practice", subjectId: "math", weekday: 1, weekType: "all", lessonType: "practice", startTime: "15:00", endTime: "16:30" }], studyFiles: [] });
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
    });
    await a.reload(); await a.locator("#pageTitle").waitFor();
    const b = await context.newPage(); b.setDefaultTimeout(6000); b.on("pageerror", (error) => errors.push(error.message));
    await b.goto(url.href); await b.locator("#pageTitle").waitFor();
    const stored = () => a.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    const quick = async (page, title) => { await page.locator("#quickTaskInput").fill(title); await page.locator("#quickTaskForm").evaluate((form) => form.requestSubmit()); };
    await quick(a, "Задача А"); await b.getByText("Задача А", { exact: true }).waitFor();
    await quick(b, "Задача Б"); await a.getByText("Задача Б", { exact: true }).waitFor();
    assert.ok((await stored()).tasks.some((item) => item.title === "Задача А"));
    assert.ok((await stored()).tasks.some((item) => item.title === "Задача Б"));
    await a.locator('[data-task-id="untimed"] .check-button').click();
    await quick(b, "Задача после отметки"); await a.getByText("Задача после отметки", { exact: true }).waitFor();
    await a.locator("#appToast").getByRole("button", { name: "Отменить", exact: true }).click();
    assert.notEqual((await stored()).tasks.find((item) => item.id === "untimed").completed["2026-10-05"], true);
    assert.ok((await stored()).tasks.some((item) => item.title === "Задача после отметки"), "undo must keep later edits from another tab");
    const go = async (page, hash) => { await page.evaluate((value) => { location.hash = value; window.scrollTo(0, 0); }, hash); await page.locator(hash.startsWith("calendar/") ? "#overviewView" : `#${hash}View`).waitFor({ state: "visible" }); };
    for (const page of [a, b]) { await go(page, "journal"); await page.locator(".notes-list-item").click(); }
    await a.locator("#noteBody").fill("Черновик вкладки А");
    await b.locator("#noteBody").fill("Сохранённый текст Б"); await b.locator('#noteForm [type="submit"]').click();
    await a.reload(); await a.locator("#noteBody").waitFor({ state: "visible" });
    assert.equal(await a.locator("#noteBody").inputValue(), "Черновик вкладки А", "the other tab must not clear this draft");
    await a.locator('#noteForm [type="submit"]').click();
    assert.deepEqual((await stored()).notes.map((note) => note.body).sort(), ["Сохранённый текст Б", "Черновик вкладки А"]);
    await b.close();
    const failWrites = () => a.evaluate(() => { window.originalWrite = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "rhythm-day-state-v1") throw new DOMException("Full", "QuotaExceededError"); return window.originalWrite.call(this, key, value); }; });
    const resumeWrites = () => a.evaluate(() => { Storage.prototype.setItem = window.originalWrite; });
    await a.locator('[data-notes-tab="journal"]').click();
    await failWrites(); await a.locator("#journalText").fill("Несохранённый дневник"); await a.locator("#journalText").dispatchEvent("blur");
    assert.ok((await a.locator("#journalStatus").textContent()).includes("Не удалось сохранить"));
    assert.equal((await stored()).journalEntries.some((entry) => entry.text === "Несохранённый дневник"), false);
    await a.reload(); await a.locator('[data-notes-tab="journal"]').click();
    assert.equal(await a.locator("#journalText").innerText(), "Несохранённый дневник");
    await a.locator("#journalText").dispatchEvent("blur");
    assert.ok((await stored()).journalEntries.some((entry) => entry.text === "Несохранённый дневник"));
    await go(a, "study"); await a.locator("#studyJumpToHomeworkForm").click();
    await a.locator('#studyHomeworkForm [name="subjectId"]').selectOption("math");
    assert.equal(await a.locator('#studyHomeworkForm [name="date"]').inputValue(), "2026-10-05");
    assert.equal(await a.locator('#studyHomeworkForm [name="time"]').inputValue(), "15:00");
    const ids = await a.locator("dialog.study-create-dialog").evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length); assert.ok(ids.every((id) => !id.includes("[object")));
    await a.locator("dialog.study-create-dialog[open] .study-dialog-close").click();
    await a.locator('[data-study-tab="schedule"]').click();
    await a.locator('[data-study-lesson-delete="practice"]').locator("xpath=ancestor::details/summary").click();
    await a.locator('[data-study-lesson-delete="practice"]').click(); await failWrites(); await a.locator("#confirmAccept").click();
    assert.equal(await a.locator('[data-study-lesson-delete="practice"]').count(), 1);
    assert.equal((await stored()).studyLessons.length, 1); await resumeWrites();
    await go(a, "calendar/week");
    for (const width of [390, 320]) {
      await a.setViewportSize({ width, height: 844 }); await a.locator(".calendar-week-strip").waitFor();
      assert.equal(await a.locator(".calendar-week-strip-day").count(), 7);
      const grid = await a.locator(".calendar-time-scroll").evaluate((node) => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }));
      assert.ok(grid.scrollWidth <= grid.width + 1, "compact week must not require horizontal scrolling");
      assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await a.screenshot({ path: path.join(captures, `week-${width}.png`), animations: "disabled" });
    }
    await a.locator('.calendar-time-event[data-event-id="short"] .calendar-event-open').click();
    const complete = a.locator("#calendarEventPreview.is-interactive").getByRole("button", { name: "Выполнить", exact: true });
    await complete.waitFor(); assert.ok((await complete.boundingBox()).height >= 44);
    const popup = await a.locator("#calendarEventPreview").boundingBox();
    assert.ok(popup.x >= 0 && popup.x + popup.width <= 320, "touch actions must fit the narrow viewport");
    await a.screenshot({ path: path.join(captures, "short-event-actions.png"), animations: "disabled" });
    await complete.click(); assert.equal((await stored()).tasks.find((item) => item.id === "short").completed["2026-10-05"], true);
    await a.locator(".calendar-untimed-jump").click(); assert.ok(await a.locator(".calendar-untimed").isVisible());
    await a.setViewportSize({ width: 1440, height: 1000 });
    await a.evaluate(() => {
      remoteAuth.getSession = () => ({ user: { id: "synthetic-upload-account" }, access_token: "synthetic-token" });
      remoteAuth.ensureFreshSession = async () => remoteAuth.getSession();
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1")); state._localOwner = "synthetic-upload-account";
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
    });
    await go(a, "study"); await a.locator('[data-study-tab="materials"]').click();
    await a.waitForFunction(() => document.querySelector("#studyDriveStatus").textContent.includes("подключён"));
    await a.locator("#studyNewMaterial").click();
    await a.locator('#studyMaterialForm [type="file"]').setInputFiles({ name: "Synthetic.txt", mimeType: "text/plain", buffer: Buffer.from("test") });
    await failWrites(); await a.locator('#studyMaterialForm [type="submit"]').click();
    await a.getByRole("button", { name: "Сохранить загруженный файл", exact: true }).waitFor();
    assert.equal((await stored()).studyFiles.length, 0);
    await resumeWrites(); await a.getByRole("button", { name: "Сохранить загруженный файл", exact: true }).click();
    await a.waitForFunction(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).studyFiles.length === 1);
    assert.equal(uploadStarts, 1, "metadata retry must not create another Drive upload");
    assert.equal((await stored()).studyFiles[0].googleId, "synthetic-file");
    assert.deepEqual(errors, []);
    console.log("Audit fixes passed on synthetic data. Captures: " + captures);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
