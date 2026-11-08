const assert = require("node:assert/strict");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({
    args: [path.resolve(__dirname, ".."), "--e2e-test"],
    executablePath: require("electron"),
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const shots = process.env.ONGOING_SHOTS;

  try {
    await page.waitForSelector("#pageTitle");
    // The strip is on the first screen and offers adding when empty.
    assert.equal(await page.locator("#ongoingStrip").isVisible(), true);
    assert.match(await page.locator("#ongoingChips").innerText(), /Добавить текущее/);

    // An existing task to link later.
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      const now = new Date().toISOString();
      state.tasks.push({ id: "t-existing", title: "Заказать справку", date: null, repeat: "none", priority: "medium", createdAt: now, updatedAt: now });
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
    });
    await page.reload();
    await page.waitForSelector("#pageTitle");

    await page.locator("#ongoingChips button").first().click();
    assert.equal(await page.locator("#ongoingPane").isVisible(), true);
    assert.equal(await page.locator("#ongoingEmpty").isVisible(), true);
    // No empty description box before there is a description.
    await page.locator("#ongoingTitle").fill("Хакатон");
    await page.locator("#ongoingDue").fill("2026-11-20");
    await page.locator("#ongoingForm button[type=submit]").click();
    assert.equal(await page.locator(".ongoing-item").count(), 1);
    assert.equal(await page.locator(".ongoing-item textarea").count(), 0);
    assert.match(await page.locator(".ongoing-due-label").last().innerText(), /Дедлайн/);

    // New task inside the project.
    await page.locator(".ongoing-item-actions input").fill("Собрать команду");
    await page.locator(".ongoing-item-actions input").press("Enter");
    assert.equal(await page.locator(".ongoing-tasks li").count(), 1);
    // Link an existing task.
    await page.locator(".ongoing-item-actions select").selectOption("t-existing");
    assert.equal(await page.locator(".ongoing-tasks li").count(), 2);
    assert.match(await page.locator(".ongoing-progress-label").innerText(), /0 из 2/);

    // Description appears on demand.
    await page.locator(".ongoing-add-body").click();
    await page.locator(".ongoing-body").fill("Дедлайн сдачи презентации в 12:00");
    await page.locator(".ongoing-item-top input").first().focus();
    assert.equal(await page.locator(".ongoing-body").inputValue(), "Дедлайн сдачи презентации в 12:00");
    if (shots) await page.screenshot({ path: path.join(shots, "ongoing-tab.png") });

    // Completing a linked task moves progress.
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      state.tasks.find((task) => task.id === "t-existing").completed = { "2026-11-09": true };
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
    });
    await page.reload();
    await page.waitForSelector("#pageTitle");
    await page.locator('.nav-tab[data-view="tasks"]:visible').first().click();
    const chip = await page.locator("#ongoingChips .ongoing-chip").first().innerText();
    assert.match(chip, /Хакатон · 1\/2 · до 20\.11/);
    if (shots) await page.screenshot({ path: path.join(shots, "ongoing-strip.png") });

    // The project stays out of the regular notes list.
    await page.locator("#ongoingChips .ongoing-chip").first().click();
    await page.locator('[data-notes-tab="notes"]').click();
    assert.equal(await page.locator("#noteList .notes-list-item").count(), 0);

    assert.deepEqual(errors, []);
    console.log("e2e ok - ongoing projects strip, linked tasks, progress and description on demand");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
