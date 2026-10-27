const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");
const sharp = require("sharp");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files"] });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-heatmap-halves-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Europe/Saratov", reducedMotion: "reduce" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    await page.clock.install({ time: new Date("2026-10-28T10:00:00+04:00") });
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1"; url.hash = "calendar/year";
    await page.goto(url.href); await page.waitForFunction(() => typeof window.normalizeState === "function");
    await page.evaluate(() => {
      const tasks = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"].flatMap((date) => [0, 1].map((index) => ({
        id: `${date}-${index}`, title: "Пример", date, repeat: "none", completed: { [date]: date !== "2026-10-21" || index === 0 },
      })));
      state = normalizeState({ tasks, habits: [{ id: "water", title: "Вода", type: "number", goal: 2, repeat: "daily", startDate: "2026-10-20",
        logs: { "2026-10-20": 1, "2026-10-21": 2, "2026-10-22": 2 },
        freezeDays: { "2026-10-23": { active: true, reason: "Отдых", updatedAt: "2026-10-23T08:00:00Z" } } }] });
      activeDate = "2026-10-28"; activeView = "overview"; overviewMode = "year"; render();
    });
    assert.equal(await page.locator(".heatmap-cell").count(), 10, "data range starts at the first scheduled task");
    assert.equal(await page.locator('.heatmap-cell[data-date="2026-10-23"]').evaluate((node) => node.classList.contains("has-frozen-habit")), true);
    assert.equal(await page.locator(".heatmap-legend-frozen").textContent(), "Заморозка");
    assert.equal(await page.locator('.heatmap-cell[data-date="2026-10-28"]').getAttribute("aria-current"), "date");
    await page.locator('[data-heatmap-range="year"]').click();
    assert.equal(await page.locator(".heatmap-cell").count(), 365);
    const cases = [["2026-10-18", false, false], ["2026-10-19", true, false], ["2026-10-20", true, false], ["2026-10-21", false, true], ["2026-10-22", true, true]];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["dark", "light"]) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        const labelsFit = await page.locator(".heatmap-months").evaluateAll((rows) => rows.every((row) => {
          const labels = [...row.children];
          return labels.every((node, index) => node.textContent.length === 3 && node.scrollWidth <= node.clientWidth + 1
            && (!index || labels[index - 1].getBoundingClientRect().right <= node.getBoundingClientRect().left + 1));
        }));
        assert.ok(labelsFit, `month labels fit without overlap: ${theme}/${width}`);
        const habitsColor = await page.locator(".heatmap-legend-habits").evaluate((node) => getComputedStyle(node, "::before").backgroundColor.match(/\d+/g).slice(0, 3).map(Number));
        assert.deepEqual(habitsColor, theme === "dark" ? [255, 128, 104] : [217, 100, 74], "habits retain the original coral legend color");
        const today = page.locator('.heatmap-cell[data-date="2026-10-28"]');
        const beforeHover = await today.boundingBox(); await today.hover();
        const afterHover = await today.boundingBox();
        assert.ok(Math.abs(beforeHover.width - afterHover.width) < 0.1 && Math.abs(beforeHover.height - afterHover.height) < 0.1);
        assert.equal(await today.evaluate((node) => getComputedStyle(node).transform), "none");
        await page.mouse.move(0, 0);
        for (const [date, tasksGold, habitsGold] of cases) {
          const cell = page.locator(`.heatmap-cell[data-date="${date}"]`);
          assert.deepEqual(await cell.evaluate((node) => [node.classList.contains("is-tasks-complete"), node.classList.contains("is-habits-complete"), node.classList.contains("is-perfect-day")]), [tasksGold, habitsGold, tasksGold && habitsGold]);
          const { data, info } = await sharp(await cell.screenshot({ scale: "css", animations: "disabled" })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          for (const [fraction, expected] of [[0.3, tasksGold], [0.7, habitsGold]]) {
            const index = (Math.floor(info.height * fraction) * info.width + Math.floor(info.width / 2)) * info.channels;
            assert.equal(data.subarray(index, index + 3).equals(Buffer.from([230, 185, 79])), expected, `${date}: ${theme}/${width}, half ${fraction}`);
          }
        }
        await page.locator(".heatmap-panel").screenshot({ path: path.join(captures, `${theme}-${width}.png`), animations: "disabled" });
      }
    }
    await page.locator('[data-heatmap-range="tracking"]').click();
    assert.equal(await page.locator(".heatmap-cell").count(), 10, "the compact range remains available after resizing");
    await page.locator(".heatmap-panel").screenshot({ path: path.join(captures, "tracking-mobile.png"), animations: "disabled" });
    assert.deepEqual(errors, []);
    console.log(`Golden heatmap halves passed. Captures: ${captures}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
