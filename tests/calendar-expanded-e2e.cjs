const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-calendar-expanded-"));
  try {
    for (const width of [320, 390, 1440]) {
      const mobile = width < 680;
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: mobile, hasTouch: mobile, locale: "ru-RU", timezoneId: "Europe/Saratov" });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(7000);
      const errors = []; page.on("pageerror", (error) => errors.push(error.message));
      const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
      url.search = "automation=1"; url.hash = "calendar/day";
      await page.goto(url.href); await page.locator("#pageTitle").waitFor();
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
        Object.assign(state, { tasks: [
          { id: "expanded-block", title: "Собрать материалы для выступления", date: "2026-10-06", repeat: "none", scheduleMode: "block", startTime: "10:00", endTime: "11:00", time: "11:00", completed: {} },
          { id: "expanded-short", title: "Отправить письмо", date: "2026-10-06", repeat: "none", scheduleMode: "block", startTime: "12:00", endTime: "12:15", time: "12:15", completed: {} },
          { id: "expanded-untimed", title: "Проверить список покупок", date: "2026-10-06", dueDate: "2026-10-07", repeat: "none", completed: {} },
        ], habits: [], goals: [], studyLessons: [], studySubjects: [] });
        localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
        localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-06", activeView: "overview", overviewMode: "day", currentToday: new Date().toLocaleDateString("en-CA") }));
      });
      await page.reload(); await page.locator(".calendar-time-grid.is-day").waitFor();
      const root = page.locator("#calendarSchedule");
      const grid = root.locator(".calendar-time-scroll");
      const metrics = () => grid.evaluate((node) => ({ top: node.scrollTop, height: parseFloat(getComputedStyle(node.closest("#calendarSchedule")).getPropertyValue("--calendar-hour-height")), pageY: scrollY, scale: visualViewport.scale }));
      await grid.evaluate((node) => { node.scrollTop = 9 * parseFloat(getComputedStyle(node.closest("#calendarSchedule")).getPropertyValue("--calendar-hour-height")); });
      const before = await metrics();
      await root.getByRole("button", { name: "Развернуть календарь", exact: true }).click();
      await page.locator("#calendarSchedule.is-expanded").waitFor();
      assert.ok(Math.abs((await metrics()).top - before.top) < 2, "expansion preserves the visible time");
      const bounds = await grid.boundingBox();
      assert.ok(bounds.height > 650 && bounds.y + bounds.height <= 844, "expanded grid uses the app viewport");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.evaluate(() => document.fullscreenElement), null, "no native fullscreen permission is needed");
      await root.locator(".calendar-untimed-jump").click();
      await root.getByRole("button", { name: "Закрыть дела без времени" }).waitFor({ state: "visible" });
      assert.ok(await root.locator(".calendar-untimed").getByText("Проверить список покупок", { exact: true }).isVisible());
      await root.getByRole("button", { name: "Закрыть дела без времени" }).click();
      assert.equal(await root.locator(".calendar-untimed").isVisible(), false);

      const task = page.locator('.calendar-time-event[data-event-id="expanded-block"]');
      if (mobile) {
        const client = await context.newCDPSession(page);
        const touch = (type, points) => client.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 3, radiusY: 3 })) });
        const hold = async (card) => {
          const box = await card.locator(".calendar-event-open").boundingBox();
          await touch("touchStart", [[box.x + box.width / 2, box.y + Math.min(20, box.height / 2)]]);
          await page.waitForTimeout(520); await touch("touchEnd", []); await page.waitForTimeout(500);
        };
        const resize = async (card, edge, delta, cancel = false) => {
          const handle = await card.locator(`.calendar-event-resize.is-${edge}`).boundingBox();
          const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
          await touch("touchStart", [[x, y]]);
          await touch("touchMove", [[x, y + delta]]);
          await touch(cancel ? "touchCancel" : "touchEnd", []);
          await page.waitForTimeout(550);
        };
        const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks.find((item) => item.id === "expanded-block"));
        await hold(task);
        assert.equal(await task.locator(".calendar-event-resize.is-start").isVisible(), true);
        await page.screenshot({ path: path.join(captures, `selected-${width}.png`) });
        await resize(task, "end", 18);
        assert.equal((await saved()).endTime, "11:15");
        await resize(task, "start", 18);
        assert.equal((await saved()).startTime, "10:15");
        await resize(task, "end", 36, true);
        assert.equal((await saved()).endTime, "11:15", "cancelled resize does not write data");
        await root.getByRole("button", { name: "Готово", exact: true }).click();
        assert.equal(await task.locator(".calendar-event-resize.is-start").isVisible(), false);
        const short = page.locator('.calendar-time-event[data-event-id="expanded-short"]');
        await hold(short);
        await resize(short, "start", 150);
        await resize(short, "end", -100);
        const shortState = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks.find((item) => item.id === "expanded-short"));
        assert.equal(shortState.startTime, "12:00", "resize cannot invert a quarter-hour task");
        assert.equal(shortState.endTime, "12:15");
        await root.getByRole("button", { name: "Готово", exact: true }).click();
        const anchorY = bounds.height / 2, center = bounds.x + bounds.width / 2, y = bounds.y + anchorY;
        const pinchBefore = await metrics();
        await touch("touchStart", [[center - 40, y], [center + 40, y]]);
        for (let step = 1; step <= 5; step++) await touch("touchMove", [[center - 40 - step * 4, y], [center + 40 + step * 4, y]]);
        await touch("touchEnd", []); await page.waitForTimeout(550);
        const pinchAfter = await metrics();
        assert.ok(pinchAfter.height > pinchBefore.height * 1.4);
        assert.equal(pinchAfter.scale, 1);
        assert.ok(Math.abs((pinchBefore.top + anchorY - 48) / pinchBefore.height - (pinchAfter.top + anchorY - 48) / pinchAfter.height) < .03);
      } else {
        await task.locator(".calendar-event-open").click();
        await page.locator("body.has-floating-task-form").waitFor();
        assert.equal(await page.locator("#taskTitle").inputValue(), "Собрать материалы для выступления");
        await page.locator("#taskTitle").evaluate((node) => { const box = node.getBoundingClientRect(); if (document.elementFromPoint(box.x + 10, box.y + 10) !== node) throw new Error("Task editor is covered by expanded calendar"); });
        await page.locator("#taskTitle").fill("Изменённое название");
        await page.goBack();
        await page.locator("#confirmModal").waitFor({ state: "visible" });
        await page.locator("#confirmCancel").click();
        assert.equal(await root.evaluate((node) => node.classList.contains("is-expanded")), true, "cancelled Back keeps the expanded view and dirty editor");
        assert.equal(await page.locator("#taskTitle").inputValue(), "Изменённое название");
        await page.locator("#closeTaskForm").click();
        await page.locator("#confirmAccept").click();
      }
      await root.locator(".calendar-expanded-modes").getByRole("button", { name: "Неделя", exact: true }).click();
      await root.locator(".calendar-time-grid.is-week").waitFor();
      await root.getByRole("button", { name: "Следующая неделя", exact: true }).click();
      assert.ok((await root.locator(".calendar-schedule-period").textContent()).includes("12"));
      await root.getByRole("button", { name: "Предыдущая неделя", exact: true }).click();
      await grid.evaluate((node) => { node.scrollTop = 7.5 * parseFloat(getComputedStyle(node.closest("#calendarSchedule")).getPropertyValue("--calendar-hour-height")); });
      await page.screenshot({ path: path.join(captures, `week-${width}.png`) });
      const exitMetrics = await metrics();
      await page.goBack();
      await page.locator("#calendarSchedule:not(.is-expanded)").waitFor();
      assert.equal(await page.evaluate(() => location.hash), "#calendar/week", "Back exits the expanded view without changing its current mode");
      const after = await metrics();
      assert.ok(Math.abs(after.top / after.height - exitMetrics.top / exitMetrics.height) < .03, "exit preserves time position and scale");
      assert.equal(after.height, exitMetrics.height);
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      await root.getByRole("button", { name: "Развернуть календарь", exact: true }).click();
      await root.getByRole("button", { name: "Свернуть календарь", exact: true }).click();
      await page.locator("#calendarSchedule:not(.is-expanded)").waitFor();
      if (!mobile) {
        await root.getByRole("button", { name: "Развернуть календарь", exact: true }).click();
        await page.keyboard.press("Escape");
        await page.locator("#calendarSchedule:not(.is-expanded)").waitFor();
      }
      assert.equal(await page.locator("body.has-floating-task-form").count(), 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("Expanded calendar and native touch resizing checks passed. Captures: " + captures);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
