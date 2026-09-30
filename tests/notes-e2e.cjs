const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({
    args: [path.resolve(__dirname, ".."), "--e2e-test"],
    executablePath: require("electron"),
  });
  const page = await app.firstWindow();
  await require("./navigation-fixture.cjs").enableAllSections(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    await page.waitForSelector("#pageTitle");
    await page.locator('.nav-tab[data-view="study"]:visible').click();
    await page.locator('[data-study-tab="schedule"]').click();
    await page.locator('#studySubjectForm [name="name"]').fill("Математика");
    await page.locator('#studySubjectForm button[type="submit"]').click();
    const subjectId = await page.locator("[data-study-subject-edit]").getAttribute("data-study-subject-edit");
    assert.ok(subjectId);

    await page.locator('[data-study-tab="homework"]').click();
    await page.locator('#studyHomeworkForm [name="subjectId"]').selectOption(subjectId);
    await page.locator('#studyHomeworkForm [name="title"]').fill("Решить задачи по графам");
    await page.locator('#studyHomeworkForm button[type="submit"]').click();
    const stateWithTask = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    const task = stateWithTask.tasks.find((item) => item.title === "Решить задачи по графам");
    assert.ok(task);

    await page.locator("#studyHomeworkFilter").selectOption(subjectId);
    await page.locator("#studyOpenNotes").click();
    assert.equal(await page.locator("#journalView").isVisible(), true);
    assert.equal(await page.locator("#activeDate").isVisible(), false);
    assert.equal(await page.locator("#globalSearchButton").isVisible(), true);
    assert.equal(await page.locator("#noteSubjectFilter").inputValue(), subjectId);
    await page.locator("#noteNew").click();
    await page.locator("#noteTitle").fill("Формула Эйлера");
    await page.locator("#noteBody").fill("V - E + F = 2. Применить к домашнему заданию.");
    await page.locator("#notePinned").check();
    await page.locator("#noteSubjectId").selectOption(subjectId);
    await page.locator("#noteTaskId").selectOption(task.id);
    await page.locator('#noteForm button[type="submit"]').click();
    assert.equal(await page.locator("#noteCount").innerText(), "1 заметка");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    assert.equal(saved.notes.length, 1);
    assert.equal(saved.notes[0].taskId, task.id);
    assert.equal(saved.notes[0].subjectId, subjectId);
    assert.equal(saved.notes[0].pinned, true);

    await page.locator("#noteSearch").fill("Эйлера");
    assert.equal(await page.locator(".notes-list-item").count(), 1);
    await page.locator("#noteSearch").fill("несуществующий запрос");
    assert.equal(await page.locator(".notes-list-item").count(), 0);
    await page.locator("#noteSearch").fill("");
    await page.locator("#notePinnedOnly").click();
    assert.equal(await page.locator(".notes-list-item").count(), 1);
    await page.locator("#notePinnedOnly").click();

    await page.locator("#noteBody").fill("Несохранённый текст");
    await page.locator('[data-notes-tab="journal"]').click();
    assert.equal(await page.locator("#confirmModal").isVisible(), true);
    await page.locator("#confirmCancel").click();
    assert.equal(await page.locator("#noteBody").inputValue(), "Несохранённый текст");
    await page.locator('#noteForm button[type="submit"]').click();
    await page.locator('[data-notes-tab="journal"]').click();
    assert.equal(await page.locator("#journalText").isVisible(), true);
    assert.equal(await page.locator("#activeDate").isVisible(), true);
    await page.locator('[data-notes-tab="notes"]').click();
    await page.locator(".notes-list-item").click();

    await page.locator('.nav-tab[data-view="tasks"]:visible').click();
    await page.locator("#activeDate").fill(task.date);
    await page.locator("#activeDate").dispatchEvent("change");
    const taskRow = page.locator(`[data-task-id="${task.id}"]`);
    await taskRow.locator(".task-note-link").click();
    assert.equal(await page.locator("#journalView").isVisible(), true);
    assert.equal(await page.locator("#noteTitle").inputValue(), "Формула Эйлера");

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator("#noteForm").isVisible(), true);
    assert.equal(await page.locator("#noteList").isVisible(), false);
    if (process.env.CAPTURE_NOTES) {
      const mobilePath = path.join(os.tmpdir(), "parsitasks-notes-mobile.png");
      await page.screenshot({ path: mobilePath, animations: "disabled", timeout: 10000 });
      await page.setViewportSize({ width: 1200, height: 800 });
      const desktopPath = path.join(os.tmpdir(), "parsitasks-notes-desktop.png");
      await page.screenshot({ path: desktopPath, animations: "disabled", timeout: 10000 });
      console.log(`notes screenshots: ${mobilePath}, ${desktopPath}`);
    }
    await page.locator("#noteDelete").click();
    await page.locator("#confirmAccept").click();
    const afterDelete = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    assert.equal(afterDelete.notes.length, 0);
    assert.ok(afterDelete.tombstones.notes[saved.notes[0].id]);
    assert.deepEqual(errors, []);
    console.log("e2e ok - linked notes, search, deletion, unsaved guard, journal, and mobile layout");
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
