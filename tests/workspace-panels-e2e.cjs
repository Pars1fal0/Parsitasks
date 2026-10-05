const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-workspace-panels-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Europe/Saratov" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(6000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-05T10:00:00+04:00") });
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1"; url.hash = "goals";
    await page.goto(url.href); await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      const now = new Date().toISOString();
      Object.assign(state, {
        tasks: [{ id: "task", title: "Подготовить презентацию", date: "2026-10-05", repeat: "none", completed: {} }], habits: [], studySubjects: [], studyLessons: [], studyFiles: [],
        goals: [
          { id: "goal", title: "Запустить личный проект", dueDate: "2026-10-20", status: "active", steps: [{ id: "step", title: "Собрать материалы", done: false }, { id: "next", title: "Подготовить первую версию", done: false }], linkedTaskIds: ["task"], createdAt: now, updatedAt: now },
          { id: "second", title: "Регулярно заниматься английским", dueDate: "", status: "active", steps: [{ id: "plan", title: "Составить план", done: true }, { id: "practice", title: "Начать практику", done: false }], createdAt: now, updatedAt: now },
        ],
        notes: [
          { id: "note", title: "Идеи для личного проекта", body: "Собрать материалы и выбрать первый полезный сценарий.\n\nСледующий шаг: подготовить короткую презентацию и обсудить её с командой.", pinned: true, createdAt: now, updatedAt: now },
          { id: "other", title: "Что важно на этой неделе", body: "Завершить текущие дела и оставить время для отдыха.", pinned: false, createdAt: now, updatedAt: now },
        ],
        boardItems: [
          { id: "text", type: "text", text: "Проект на октябрь", color: "#17191d", fontSize: 24, fontWeight: 600, x: 0, y: 0, width: 400, height: 50 },
          { id: "link", type: "link", sourceType: "task", sourceId: "task", backgroundColor: "#ffffff", x: 0, y: 100, width: 240, height: 156 },
          { id: "colored", type: "link", sourceType: "note", sourceId: "note", backgroundColor: "#efeaff", x: 280, y: 100, width: 240, height: 156 },
        ],
      });
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-05", activeView: "goals", currentToday: "2026-10-05", themePreference: "dark", accentPreference: "violet" }));
    });
    await page.reload();
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    const go = async (view) => {
      await page.evaluate((hash) => { location.hash = hash; window.scrollTo(0, 0); }, view);
      await page.locator(`#${view}View`).waitFor({ state: "visible" });
    };
    const fits = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "page must not overflow horizontally");
    const capture = async (name) => { await fits(); await page.screenshot({ path: path.join(captures, name + ".png"), animations: "disabled" }); };
    for (const theme of ["dark", "light"]) {
      await go("settings");
      await page.locator("#themePreference").evaluate((field) => { field.closest("details").open = true; });
      await page.locator("#themePreference").selectOption(theme);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await go("goals");
        assert.equal(await page.locator(".goal-item").count(), 2);
        assert.ok(await page.locator(".goal-metrics").evaluate((node) => node.clientHeight < 100));
        await capture(`goals-${theme}-${width}`);
        await go("journal");
        if (width <= 760 && await page.locator("#noteForm").isVisible()) await page.locator("#noteBack").click();
        await page.locator('.notes-list-item').filter({ hasText: "Идеи для личного проекта" }).click();
        await capture(`notes-${theme}-${width}`);
        await go("board");
        if (width > 600) {
          await page.locator("#boardFocus").click();
          assert.ok(await page.locator("#boardViewport").evaluate((node) => getComputedStyle(node).backgroundColor !== "rgb(255, 255, 255)" || document.documentElement.dataset.theme === "light"));
          assert.equal(await page.locator('.board-linked-card:not(.is-theme-surface)').evaluate((node) => getComputedStyle(node).backgroundColor), "rgb(239, 234, 255)", "custom card colors are preserved");
          const colorMatches = await page.locator('.board-item[data-id="text"] .board-text-content').evaluate((node) => getComputedStyle(node).color === getComputedStyle(document.body).color);
          assert.ok(colorMatches, "neutral board text follows the theme");
        } else assert.equal(await page.locator("#boardCardList").isVisible(), true);
        await capture(`board-${theme}-${width}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go("journal");
    await page.locator('.notes-list-item').filter({ hasText: "Идеи для личного проекта" }).click();
    await page.locator("#noteBody").fill("Обновлённая заметка\n\nВажный следующий шаг.");
    await page.locator('#noteForm [type="submit"]').click();
    assert.match((await stored()).notes.find((note) => note.id === "note").body, /Обновлённая/);
    await page.locator('[data-note-mode="read"]').click();
    assert.match(await page.locator("#noteReadView").innerText(), /следующий шаг/);
    await go("goals");
    await page.locator('[data-goal-id="goal"] .goal-details summary').click();
    await page.locator('[data-goal-id="goal"] .goal-step input').first().check({ force: true });
    assert.equal((await stored()).goals.find((goal) => goal.id === "goal").steps[0].done, true);
    await page.locator("#openGoalForm").click();
    await page.locator("#goalTitle").fill("Новая цель");
    await page.locator("#goalCheckpointInput").fill("Первый шаг"); await page.locator("#addGoalCheckpoint").click();
    await page.locator('#goalForm [type="submit"]').click();
    assert.equal((await stored()).goals.find((goal) => goal.title === "Новая цель").steps.length, 1);
    await go("board");
    await page.locator("#boardFocus").click();
    await page.locator("#boardAddMenu > summary").click(); await page.locator("#boardAddLink").click();
    await page.locator("#boardSourceSearch").fill("Новая цель");
    await capture("board-picker-light");
    await page.locator('[data-board-source="goal"]').click();
    assert.ok((await stored()).boardItems.some((item) => item.sourceType === "goal"));
    assert.equal((await stored()).boardItems.find((item) => item.id === "link").backgroundColor, "#ffffff", "theme changes do not rewrite board data");
    assert.deepEqual(errors, []);
    console.log("Workspace panel checks passed. Captures: " + captures);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
