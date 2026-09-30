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
    await page.setViewportSize({ width: 1024, height: 768 });
    const todayKey = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      const today = new Date();
      const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const due = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 11);
      const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
      const now = today.toISOString();
      state.tasks.push({ id: "board-task", title: "Подготовить доклад", date: dateKey, repeat: "none", completed: {}, createdAt: now, updatedAt: now });
      state.notes.push({ id: "board-note", title: "Тезисы выступления", body: "Проверить аргументы", pinned: true, createdAt: now, updatedAt: now });
      state.goals.push({ id: "board-goal", title: "Сдать проект", dueDate, steps: [{ id: "step-1", title: "Проверка", done: false }], status: "active", createdAt: now, updatedAt: now });
      state.studySubjects.push({ id: "board-subject", name: "Математика", color: "#56c8a6", teacher: "Преподаватель", createdAt: now, updatedAt: now });
      state.studyFiles.push({ id: "board-file", googleId: "board-test-file", name: "Методичка", mime: "application/pdf", subjectId: "board-subject", createdAt: now, updatedAt: now });
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      return dateKey;
    });
    await page.reload();
    await page.waitForSelector("#pageTitle");
    await page.locator('.nav-tab[data-view="board"]:visible').click();
    assert.equal(await page.locator("#boardEmpty").isVisible(), true);
    await page.locator('[data-board-template="study"]').click();
    assert.equal(await page.locator(".board-frame").count(), 3);
    assert.equal(await page.locator("#boardEmpty").isVisible(), false);

    await page.locator("#boardAddMenu summary").click();
    await page.locator("#boardAddLink").click();
    await page.locator("#boardSourceSearch").fill("доклад");
    assert.equal(await page.locator(".board-source-result").count(), 1);
    await page.locator('[data-board-source="task"]').click();
    const taskCard = page.locator('.board-linked-card').filter({ hasText: "Подготовить доклад" });
    assert.equal(await taskCard.count(), 1);
    assert.match(await taskCard.innerText(), /В работе/);
    const taskNode = page.locator('.board-item.board-link').filter({ hasText: "Подготовить доклад" });
    await page.locator("#boardFocus").click();
    await taskCard.click();
    const beforeResize = await taskCard.evaluate((card) => ({
      title: parseFloat(getComputedStyle(card.querySelector("strong")).fontSize),
      button: parseFloat(getComputedStyle(card.querySelector("button")).fontSize),
    }));
    const resizeHandle = await taskNode.locator('[data-board-resize="se"]').boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(resizeHandle.x >= 0 && resizeHandle.y >= 0 && resizeHandle.x + resizeHandle.width <= viewport.width && resizeHandle.y + resizeHandle.height <= viewport.height, "resize handle must be inside the viewport");
    await page.mouse.move(resizeHandle.x + resizeHandle.width / 2, resizeHandle.y + resizeHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeHandle.x + resizeHandle.width / 2 + 120, resizeHandle.y + resizeHandle.height / 2 + 78, { steps: 8 });
    await page.mouse.up();
    const afterResize = await taskCard.evaluate((card) => ({
      title: parseFloat(getComputedStyle(card.querySelector("strong")).fontSize),
      button: parseFloat(getComputedStyle(card.querySelector("button")).fontSize),
    }));
    assert.ok(afterResize.title > beforeResize.title * 1.3, "card title should scale with resize");
    assert.ok(afterResize.button > beforeResize.button * 1.3, "card action should scale with resize");
    await page.locator('[data-board-link-color="#efeaff"]').click();
    assert.equal(await taskCard.evaluate((card) => getComputedStyle(card).backgroundColor), "rgb(239, 234, 255)");
    let state = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    assert.equal(state.boardItems.find((item) => item.sourceId === "board-task").type, "link");
    assert.equal(state.boardItems.find((item) => item.sourceId === "board-task").backgroundColor, "#efeaff");

    await page.locator("#boardAddMenu summary").click();
    await page.locator("#boardAddLink").click();
    await page.locator("#boardSourceType").selectOption("task");
    assert.equal(await page.locator(".board-source-result").count(), 0);
    await page.locator("#boardSourceType").selectOption("note");
    await page.locator('[data-board-source="note"]').click();
    assert.match(await page.locator(".board-linked-card").last().innerText(), /Тезисы выступления/);
    if (process.env.CAPTURE_BOARD) {
      await page.screenshot({ path: path.join(os.tmpdir(), "parsitasks-board-desktop.png"), animations: "disabled" });
    }

    await page.locator("#boardAddMenu summary").click();
    await page.locator("#boardAddLink").click();
    await page.locator("#boardSourceType").selectOption("goal");
    assert.equal(await page.locator('[data-board-source="goal"]').count(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    const pickerFits = await page.locator("#boardSourcePicker").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    });
    assert.equal(pickerFits, true);
    if (process.env.CAPTURE_BOARD) {
      await page.screenshot({ path: path.join(os.tmpdir(), "parsitasks-board-picker-mobile.png"), animations: "disabled" });
    }
    await page.locator("#boardSourceSearch").press("Escape");
    assert.equal(await page.locator("#boardSourcePicker").isVisible(), false);

    if (process.env.CAPTURE_BOARD) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.equal(await page.locator("#boardAreaNav").isVisible(), true);
      await page.locator("#boardAreaSelect").selectOption({ label: "Материалы" });
      assert.equal(await page.locator('.board-linked-card').filter({ hasText: "Подготовить доклад" }).isVisible(), true);
      await page.waitForTimeout(2200);
      await page.screenshot({ path: path.join(os.tmpdir(), "parsitasks-board-mobile.png"), animations: "disabled" });
    }
    await page.setViewportSize({ width: 1200, height: 800 });

    await page.evaluate((dateKey) => {
      const next = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      next.tasks.find((item) => item.id === "board-task").completed[dateKey] = true;
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(next));
    }, todayKey);
    await page.reload();
    await page.waitForSelector("#boardViewport");
    assert.match(await taskCard.innerText(), /Выполнена/);
    await taskCard.locator(".board-link-open").click();
    assert.equal(await page.locator("#tasksView").isVisible(), true);
    assert.equal(await page.locator("#taskTitle").inputValue(), "Подготовить доклад");

    await page.locator("#closeTaskForm").click();
    await page.locator('.nav-tab[data-view="board"]:visible').click();
    await taskCard.click();
    await page.locator("#boardDelete").click();
    state = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    assert.equal(state.boardItems.some((item) => item.sourceId === "board-task"), false);
    assert.equal(state.tasks.some((item) => item.id === "board-task"), true);
    await page.locator("#boardUndo").click();
    await page.locator('.board-linked-card').filter({ hasText: "Тезисы выступления" }).locator(".board-link-open").click();
    assert.equal(await page.locator("#journalView").isVisible(), true);
    assert.equal(await page.locator("#noteTitle").inputValue(), "Тезисы выступления");
    await page.locator('.nav-tab[data-view="board"]:visible').click();

    for (const [type, title, view, target] of [
      ["goal", "Сдать проект", "#goalsView", '[data-goal-id="board-goal"]'],
      ["subject", "Математика", "#studyView", '[data-study-subject-id="board-subject"]'],
      ["material", "Методичка", "#studyView", '[data-study-file-id="board-file"]'],
    ]) {
      await page.locator("#boardAddMenu summary").click();
      await page.locator("#boardAddLink").click();
      await page.locator("#boardSourceType").selectOption(type);
      await page.locator(`[data-board-source="${type}"]`).click();
      await page.locator("#boardFocus").click();
      await page.locator(".board-linked-card").filter({ hasText: title }).locator(".board-link-open").click();
      assert.equal(await page.locator(view).isVisible(), true);
      assert.equal(await page.locator(target).isVisible(), true);
      await page.locator('.nav-tab[data-view="board"]:visible').click();
    }
    state = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    assert.equal(state.boardItems.length, 8);
    assert.deepEqual(errors, []);
    console.log("e2e ok - board templates, linked cards, live status, search, navigation, and mobile fit");
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
