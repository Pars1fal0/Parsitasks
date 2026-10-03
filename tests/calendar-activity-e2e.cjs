const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");
const axePath = require.resolve("axe-core/axe.min.js");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-activity-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Europe/Saratov" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage(); const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-03T10:00:00+04:00") });
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1"; url.hash = "calendar/day";
    await page.goto(url.href); await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      const completed = {}; const water = {}; const walk = {};
      for (let index = 0; index < 30; index++) {
        const date = new Date(2026, 8, 4 + index, 12);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        completed[key] = index % 3 !== 0; water[key] = index % 3 !== 0 ? 1000 : 500; walk[key] = index % 2 === 0;
      }
      Object.assign(state, { tasks: [
        { id: "repeat", title: "Повторить материал", date: "2026-09-04", repeat: "daily", completed },
        { id: "early", title: "Ранний звонок", date: "2026-10-03", repeat: "none", scheduleMode: "block", startTime: "00:15", endTime: "01:00", time: "01:00", completed: {} },
        { id: "late", title: "Поздняя встреча", date: "2026-10-03", repeat: "none", scheduleMode: "block", startTime: "23:00", endTime: "23:45", time: "23:45", completed: {} },
        { id: "last-minute", title: "Закрыть день", date: "2026-10-03", repeat: "none", time: "23:59", completed: {} },
      ], habits: [
        { id: "water", title: "Вода", type: "number", goal: 1000, unit: "мл", repeat: "daily", startDate: "2026-09-04", logs: water },
        { id: "walk", title: "Прогулка", type: "check", repeat: "daily", startDate: "2026-09-04", logs: walk },
      ], studySubjects: [], studyLessons: [], goals: [] });
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-03", activeView: "overview" }));
    });
    await page.reload(); await page.waitForSelector(".calendar-time-day");
    const stateBefore = await page.evaluate(() => localStorage.getItem("rhythm-day-state-v1"));
    const fits = async () => {
      assert.ok(await page.locator(".calendar-time-scroll").evaluate((node) => node.scrollHeight <= node.clientHeight + 2), "24 hours fit without vertical scrolling");
      const body = await page.locator('.calendar-time-day[data-date="2026-10-03"]').boundingBox();
      for (const id of ["early", "late", "last-minute"]) {
        const event = await page.locator(`.calendar-time-event[data-event-id="${id}"]`).boundingBox();
        assert.ok(event.y >= body.y && event.y + event.height <= body.y + body.height + 2, `${id} fits inside full day`);
      }
    };
    await fits();
    await page.locator('[data-calendar-scale="detail"]').click();
    assert.ok(await page.locator(".calendar-time-scroll").evaluate((node) => node.scrollHeight > node.clientHeight * 2), "detailed scale is still available");
    await page.locator('[data-calendar-scale="fit"]').click(); await fits();
    await page.screenshot({ path: path.join(captures, "day-desktop.png") });
    await page.locator('[data-overview-mode="week"]').click(); await fits();
    await page.locator('[data-overview-mode="year"]').click();
    await page.waitForSelector(".activity-chart-frame canvas");
    const values = await page.evaluate(() => {
      const [tasks, habits] = [...document.querySelectorAll(".activity-chart-frame canvas")].map((canvas) => window.RhythmCharts.Chart.getChart(canvas));
      return { tasks: tasks.data.datasets[0].data, planned: tasks.data.datasets[1].data, habits: habits.data.datasets[0].data };
    });
    assert.equal(values.tasks.length, 30); assert.equal(values.tasks.reduce((sum, value) => sum + value, 0), 20);
    assert.equal(values.planned.at(-1), 4); assert.equal(values.habits.at(-1), 50);
    assert.equal(await page.locator('[data-activity-chart="habits"] .activity-chart-metric strong').textContent(), "58%");
    const taskCanvas = page.locator('[data-activity-chart="tasks"] canvas');
    await taskCanvas.focus();
    await taskCanvas.press("Home");
    assert.equal(await page.locator('[data-activity-chart="tasks"] .activity-chart-tooltip').getAttribute("data-date"), "2026-09-04");
    await taskCanvas.press("ArrowRight");
    assert.equal(await page.locator('[data-activity-chart="tasks"] .activity-chart-tooltip').getAttribute("data-date"), "2026-09-05");
    await taskCanvas.press("End");
    assert.equal(await page.locator('[data-activity-chart="tasks"] .activity-chart-tooltip').getAttribute("data-date"), "2026-10-03");
    await taskCanvas.press("Escape");
    assert.equal(await page.locator('[data-activity-chart="tasks"] .activity-chart-tooltip').isVisible(), false);
    await page.locator('[data-chart-days="7"]').click();
    assert.equal(await page.evaluate(() => window.RhythmCharts.Chart.getChart(document.querySelector(".activity-chart-frame canvas")).data.labels.length), 7);
    await page.locator('[data-chart-days="90"]').click();
    assert.equal(await page.evaluate(() => window.RhythmCharts.Chart.getChart(document.querySelector(".activity-chart-frame canvas")).data.labels.length), 90);
    await page.locator('[data-chart-days="30"]').click();
    await page.evaluate(fs.readFileSync(axePath, "utf8"));
    const accessibility = await page.evaluate(() => window.axe.run("#activityCharts", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }).then((result) => result.violations));
    assert.deepEqual(accessibility.map((entry) => ({ id: entry.id, nodes: entry.nodes.map((node) => node.target) })), [], "activity charts are accessible");
    for (const width of [1440, 800, 599, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("#activityCharts").scrollIntoViewIfNeeded();
      await page.waitForTimeout(550);
      const plotted = await page.evaluate(() => [...document.querySelectorAll(".activity-chart-frame canvas")].map((node) => {
        const chart = window.RhythmCharts.Chart.getChart(node);
        const data = chart.data.datasets[0].data;
        const index = data.findIndex((value) => value > 0);
        return index < 0 || Math.abs(chart.getDatasetMeta(0).data[index].y - chart.scales.y.getPixelForValue(data[index])) < 2;
      }));
      assert.ok(plotted.every(Boolean), "animation completes and points represent actual data, not a flat baseline");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no page overflow at ${width}`);
      const canvas = page.locator('[data-activity-chart="tasks"] canvas');
      const box = await canvas.boundingBox();
      const target = await canvas.evaluate((node) => { const chart = window.RhythmCharts.Chart.getChart(node); return { x: chart.scales.x.getPixelForValue(29), y: chart.chartArea.top + 60 }; });
      await page.mouse.move(box.x + target.x, box.y + target.y);
      assert.equal(await page.locator('[data-activity-chart="tasks"] .activity-chart-tooltip').getAttribute("data-date"), "2026-10-03");
      const colored = await canvas.evaluate((node) => {
        const pixels = node.getContext("2d").getImageData(0, 0, node.width, node.height).data;
        let count = 0; for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 1] > pixels[index] * 1.3 && pixels[index + 3] > 100) count++;
        return count;
      }); assert.ok(colored > 100, "chart canvas contains a rendered data line");
      await page.screenshot({ path: path.join(captures, `statistics-${width}.png`) });
    }
    await page.evaluate(() => { location.hash = "calendar/week"; }); await page.waitForSelector(".calendar-time-day");
    await fits();
    await page.locator(".calendar-time-scroll").scrollIntoViewIfNeeded();
    const mobileSchedule = await page.locator(".calendar-time-scroll").boundingBox();
    assert.ok(mobileSchedule.height < 500, "full-day height adapts to mobile header and bottom navigation");
    const selectedHeading = await page.locator(".calendar-time-heading.is-selected").boundingBox();
    assert.ok(selectedHeading.x >= mobileSchedule.x && selectedHeading.x + selectedHeading.width <= mobileSchedule.x + mobileSchedule.width + 1, "selected weekday stays visible after returning from statistics on mobile");
    await page.screenshot({ path: path.join(captures, "week-mobile.png") });
    await page.evaluate(() => { location.hash = "habits"; }); await page.locator("#habitsView").waitFor({ state: "visible" });
    for (const width of [320, 390, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const check = await page.locator('[data-habit-id="walk"] .check-button').boundingBox();
      const title = await page.locator('[data-habit-id="walk"] h3').boundingBox();
      assert.ok(check.x + check.width <= title.x + 1, `habit check is on the left at ${width}`);
      assert.ok(Math.abs(check.y + check.height / 2 - (title.y + title.height / 2)) < 18, `check aligns at ${width}: ${JSON.stringify({ check, title })}`);
    }
    assert.equal(await page.evaluate(() => localStorage.getItem("rhythm-day-state-v1")), stateBefore, "displaying charts and calendar changes no workspace data");
    await page.locator('[data-habit-id="walk"] .check-button').click();
    assert.equal(await page.locator('[data-habit-id="walk"] .check-button').getAttribute("aria-pressed"), "true");
    await page.locator('[data-habit-id="walk"] .check-button').click();
    assert.equal(await page.locator('[data-habit-id="walk"] .check-button').getAttribute("aria-pressed"), "false");
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce", locale: "ru-RU", timezoneId: "Europe/Saratov" });
    await touchContext.route(/^https?:/, (route) => route.abort());
    const touchPage = await touchContext.newPage();
    await touchPage.clock.install({ time: new Date("2026-10-03T10:00:00+04:00") });
    await touchPage.addInitScript((state) => {
      localStorage.setItem("rhythm-day-state-v1", state);
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-03", activeView: "overview" }));
    }, stateBefore);
    const touchUrl = new URL(url.href); touchUrl.hash = "calendar/year";
    await touchPage.goto(touchUrl.href); await touchPage.waitForSelector(".activity-chart-frame canvas");
    const touchCanvas = touchPage.locator('[data-activity-chart="tasks"] canvas');
    await touchCanvas.scrollIntoViewIfNeeded();
    assert.equal(await touchCanvas.evaluate((node) => window.RhythmCharts.Chart.getChart(node).options.animation), false, "reduced motion disables chart animation");
    const touchBox = await touchCanvas.boundingBox();
    const touchTarget = await touchCanvas.evaluate((node) => { const chart = window.RhythmCharts.Chart.getChart(node); return { x: chart.scales.x.getPixelForValue(29), y: chart.chartArea.top + 40 }; });
    await touchPage.touchscreen.tap(touchBox.x + touchTarget.x, touchBox.y + touchTarget.y);
    assert.equal(await touchPage.locator('[data-activity-chart="tasks"] .activity-chart-tooltip').getAttribute("data-date"), "2026-10-03");
    await touchContext.close();
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1")); state.tasks = []; state.habits = [];
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state)); location.hash = "calendar/year";
    });
    await page.reload(); await page.locator("#activityCharts").waitFor({ state: "visible" });
    assert.equal(await page.locator(".activity-chart-empty").count(), 2); assert.equal(await page.locator(".activity-chart-frame canvas").count(), 0);
    assert.deepEqual(errors, []);
    console.log(`calendar and activity charts ok; isolated screenshots: ${captures}`);
    await context.close();
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
