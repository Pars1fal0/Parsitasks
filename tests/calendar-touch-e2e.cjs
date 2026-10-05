const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-calendar-touch-"));
  try {
    for (const width of [390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, locale: "ru-RU", timezoneId: "Europe/Saratov" });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(6000);
      const errors = []; page.on("pageerror", (error) => errors.push(error.message));
      const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
      url.search = "automation=1"; url.hash = "calendar/day";
      await page.goto(url.href); await page.locator("#pageTitle").waitFor();
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
        Object.assign(state, { tasks: [
          { id: "touch-short", title: "Отправить преподавателю готовую работу", date: "2026-10-06", repeat: "none", scheduleMode: "block", startTime: "09:00", endTime: "09:15", time: "09:15", completed: {} },
          { id: "touch-long", title: "Подготовить презентацию", date: "2026-10-06", repeat: "none", scheduleMode: "block", startTime: "10:00", endTime: "11:00", time: "11:00", completed: {} },
          { id: "touch-untimed", title: "Задача без времени", date: "2026-10-06", repeat: "none", completed: {} },
        ], habits: [], goals: [], studyLessons: [], studySubjects: [] });
        localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
        localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-06", activeView: "overview", overviewMode: "day", currentToday: new Date().toLocaleDateString("en-CA") }));
      });
      await page.reload(); await page.locator(".calendar-time-grid.is-day").waitFor();
      const grid = page.locator(".calendar-time-scroll");
      const metrics = () => grid.evaluate((node) => ({ top: node.scrollTop, height: parseFloat(getComputedStyle(node.closest("#calendarSchedule")).getPropertyValue("--calendar-hour-height")), scale: visualViewport.scale, pageY: scrollY }));
      const client = await context.newCDPSession(page);
      const touch = (type, points) => client.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 3, radiusY: 3 })) });
      const settle = () => page.waitForTimeout(100);
      const pinch = async (ratio) => {
        const bounds = await grid.boundingBox(), y = bounds.y + bounds.height / 2;
        const center = bounds.x + bounds.width / 2, half = 45;
        await touch("touchStart", [[center - half, y]]);
        await touch("touchStart", [[center - half, y], [center + half, y]]);
        for (let step = 1; step <= 6; step++) {
          const span = half * (1 + (ratio - 1) * step / 6);
          await touch("touchMove", [[center - span, y], [center + span, y]]);
        }
        await touch("touchEnd", [[center - half, y]]);
        await touch("touchMove", [[center - half, y - 20]]);
        await touch("touchEnd", []); await settle();
        return bounds.height / 2;
      };
      const before = await metrics(); const anchor = await pinch(1.7); const after = await metrics();
      assert.ok(after.height > before.height * 1.5, "native two-finger stream must enlarge the hours");
      assert.equal(after.scale, 1, "pinch must not enlarge the browser page");
      assert.ok(Math.abs((before.top + anchor - 48) / before.height - (after.top + anchor - 48) / after.height) < .03, "pinch keeps the same time under its midpoint");
      assert.equal(after.pageY, before.pageY, "pinch must not scroll the page");
      assert.equal(await page.locator("body.has-floating-task-form").count(), 0, "pinch must not accidentally open the editor");
      await pinch(.45); assert.ok((await metrics()).height < after.height);
      await page.waitForTimeout(500);
      await page.locator(".calendar-touch-options > summary").click();
      await page.getByRole("button", { name: "Сбросить масштаб часов", exact: true }).click();
      assert.equal((await metrics()).height, 72);
      await page.locator(".calendar-touch-options > summary").click();
      const dimensions = await grid.boundingBox();
      assert.ok(dimensions.y + dimensions.height <= 844 - 68, "the grid fits above bottom navigation");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      // Native one-finger pan must scroll the grid instead of creating a task.
      await grid.evaluate((node) => { node.scrollTop = 8 * 72; });
      const bounds = await grid.boundingBox(); const panBefore = await metrics();
      await touch("touchStart", [[bounds.x + 12, bounds.y + 230]]);
      for (let step = 1; step <= 8; step++) { await touch("touchMove", [[bounds.x + 12, bounds.y + 230 - step * 12]]); await page.waitForTimeout(16); }
      await touch("touchEnd", []); await page.waitForTimeout(600);
      assert.ok((await metrics()).top > panBefore.top + 40);
      assert.equal(await page.locator("body.has-floating-task-form").count(), 0);
      await grid.evaluate((node) => { node.scrollTop = 8.5 * 72; });
      const short = page.locator('.calendar-time-event[data-event-id="touch-short"]');
      await short.locator(".calendar-event-open").tap();
      await page.locator("#calendarEventPreview.is-interactive").waitFor({ state: "visible" });
      assert.ok((await page.locator("#calendarEventPreview strong").textContent()).includes("готовую работу"));
      await page.screenshot({ path: path.join(captures, `day-actions-${width}.png`) });
      await page.locator("#calendarEventPreview").getByRole("button", { name: "Выполнить", exact: true }).tap();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks.find((task) => task.id === "touch-short").completed["2026-10-06"]), true);
      const long = page.locator('.calendar-time-event[data-event-id="touch-long"]');
      await grid.evaluate((node) => { node.scrollTop = 9 * 72; });
      const card = await long.locator(".calendar-event-open").boundingBox();
      await touch("touchStart", [[card.x + card.width / 2, card.y + 20]]);
      await page.waitForTimeout(520);
      assert.equal(await long.evaluate((node) => node.classList.contains("is-touch-moving")), true);
      await touch("touchMove", [[card.x + card.width / 2, card.y + 20 + 36]]);
      await touch("touchEnd", []); await page.waitForTimeout(550);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks.find((task) => task.id === "touch-long").startTime), "10:30");
      assert.equal(await page.locator("body.has-floating-task-form").count(), 0);
      await page.evaluate(() => { location.hash = "calendar/week"; window.scrollTo(0, 0); });
      await page.locator(".calendar-week-strip").waitFor();
      await pinch(1.4);
      await page.screenshot({ path: path.join(captures, `week-${width}.png`) });
      const savedHeight = (await metrics()).height;
      await page.reload(); await page.locator(".calendar-week-strip").waitFor();
      assert.ok(Math.abs((await metrics()).height - savedHeight) < .01, "scale survives reload");
      await page.getByRole("button", { name: "Все дни", exact: true }).click();
      const weekBounds = await grid.boundingBox();
      await pinch(1.1);
      assert.ok((await grid.evaluate((node) => node.scrollWidth)) > weekBounds.width, "full week remains horizontally scrollable");
      assert.equal((await metrics()).scale, 1);
      await page.waitForTimeout(500);
      await page.locator(".calendar-touch-options > summary").click();
      await page.locator(".calendar-touch-options .study-layer-toggle input").uncheck();
      await page.locator(".calendar-week-strip").waitFor();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForFunction(() => !document.querySelector(".calendar-touch-options"));
      assert.equal(await page.locator("#overviewView > .toolbar .study-layer-toggle").count(), 1, "desktop restores the original study switch");
      await page.locator("#overviewView > .toolbar .study-layer-toggle input").check();
      await page.locator('.calendar-time-event[data-event-id="touch-long"] .calendar-event-open').click();
      await page.locator("#taskTitle").waitFor({ state: "visible" });
      assert.equal(await page.locator("#taskTitle").inputValue(), "Подготовить презентацию", "desktop retains direct editing");
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("Mobile calendar native touch checks passed. Captures: " + captures);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
