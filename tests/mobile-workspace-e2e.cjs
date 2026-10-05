const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-mobile-workspace-"));
  try {
    for (const width of [320, 390, 1440]) {
      const mobile = width < 680;
      const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 1000 }, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce", locale: "ru-RU", timezoneId: "Europe/Saratov" });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(6000);
      const errors = []; page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date("2026-10-05T10:00:00+04:00"));
      const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
      url.search = "automation=1"; url.hash = "tasks";
      await page.goto(url.href); await page.locator("#pageTitle").waitFor();
      assert.ok(await page.evaluate(() => Boolean(document.querySelector(".quick-task-disclosure").compareDocumentPosition(document.querySelector(".workspace-setup-banner")) & Node.DOCUMENT_POSITION_FOLLOWING)), "quick input comes before optional setup");
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
        Object.assign(state, {
          tasks: [
            { id: "project", title: "Подготовить презентацию проекта и согласовать материалы с командой", date: "2026-10-05", repeat: "none", completed: {}, checklist: [{ id: "a", title: "Собрать аргументы и примеры" }, { id: "b", title: "Проверить иллюстрации" }] },
            { id: "short", title: "Отправить преподавателю готовую работу", date: "2026-10-05", repeat: "none", scheduleMode: "block", startTime: "09:00", endTime: "09:15", time: "09:15", completed: {} },
            { id: "adjacent", title: "Проверить ответ преподавателя", date: "2026-10-05", repeat: "none", scheduleMode: "block", startTime: "09:15", endTime: "09:30", time: "09:30", completed: {} },
            { id: "homework", title: "Решить задачи 4-12", date: "2026-10-05", dueDate: "2026-10-08", dueTime: "11:30", repeat: "none", studySubjectId: "math", completed: {} },
            { id: "daily", title: "Повторить английские слова", date: "2026-10-01", repeat: "daily", completed: { "2026-10-01": true, "2026-10-02": true, "2026-10-03": true } },
          ],
          habits: [{ id: "water", title: "Вода", type: "number", goal: 3000, step: 100, unit: "мл", repeat: "daily", startDate: "2026-10-01", logs: { "2026-10-05": 1200 } }],
          studySubjects: [{ id: "math", name: "Дискретная математика", color: "#79a9ff" }],
          studyLessons: [{ id: "lecture", subjectId: "math", weekday: 1, weekType: "all", lessonType: "lecture", teacher: "Светлана Александровна", room: "1/201", startTime: "13:40", endTime: "15:10" }],
          notes: [{ id: "note", title: "Важные договорённости", body: "Проверить источники.\n\n".repeat(50), createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-05T06:00:00Z" }],
          goals: [], taskOrder: {},
        });
        localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
        localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-05", currentToday: "2026-10-05", activeView: "tasks" }));
      });
      await page.reload(); await page.locator('[data-task-id="project"]').waitFor();
      const go = async (hash) => {
        await page.evaluate((value) => { document.activeElement?.blur(); location.hash = value; window.scrollTo(0, 0); }, hash);
        await page.locator(`#${hash.startsWith("calendar/") ? "overview" : hash}View`).waitFor({ state: "visible" });
        if (hash.startsWith("calendar/")) await page.waitForFunction((mode) => document.querySelector("#overviewView").dataset.mode === mode, hash.split("/")[1]);
        const close = page.locator("#appToast .toast-close"); if (await close.isVisible()) await close.click();
      };
      const capture = async (name) => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: no page horizontal overflow at ${width}`);
        await page.screenshot({ path: path.join(captures, `${width}-${name}.png`), animations: "disabled" });
      };
      const checklist = page.locator('[data-checklist-task-id="project"]');
      await capture("tasks");
      await checklist.locator("summary").click();
      if (mobile) {
        const itemBox = await page.locator('[data-task-id="project"]').boundingBox();
        assert.ok((await checklist.boundingBox()).width >= itemBox.width - 30, "checklist uses the whole task row");
      }
      await checklist.locator('[name="title"]').fill("Проверить итог");
      await checklist.locator('[name="title"]').press("Enter");
      await page.getByRole("button", { name: "Удалить подзадачу: Проверить итог", exact: true }).click();
      await capture("subtasks");

      await go("habits");
      const water = page.locator('[data-habit-id="water"]');
      if (mobile) {
        assert.equal(await water.locator(".habit-quick-adds").isVisible(), false);
        await water.locator(".habit-number-more > summary").click();
      }
      await water.getByRole("button", { name: "+250 мл", exact: true }).click();
      assert.equal(await water.locator('input[type="number"]').inputValue(), "1450");
      if (mobile) {
        assert.equal(await water.locator(".habit-quick-adds").isVisible(), false);
        await water.locator(".habit-number-more > summary").click();
        await water.getByRole("button", { name: "Вода: убрать 100 мл", exact: true }).click();
        assert.equal(await water.locator('input[type="number"]').inputValue(), "1350");
        await water.locator(".habit-number-more > summary").click();
        await water.locator(".habit-number-more > summary").press("Escape");
        assert.equal(await water.locator(".habit-quick-adds").isVisible(), false);
      }
      await capture("habits");
      await page.locator("#openHabitForm").click();
      if (mobile) {
        await page.setViewportSize({ width, height: 500 });
        await page.locator("#habitTitle").fill("С телефоном");
        const actions = await page.locator("#habitForm .form-actions").boundingBox();
        assert.ok(actions.y >= 0 && actions.y + actions.height <= 490, "habit actions remain above reduced viewport edge");
        await capture("habit-keyboard");
        await page.locator('#habitForm [type="submit"]').click();
        await page.setViewportSize({ width, height: 844 });
      } else await page.locator("#closeHabitForm").click();

      await go("goals"); await page.locator("#openGoalForm").click();
      const goalLinks = page.locator("#goalForm details.goal-link-section");
      assert.equal(await goalLinks.first().evaluate((node) => node.open), !mobile);
      if (mobile) {
        await page.setViewportSize({ width, height: 500 });
        await goalLinks.first().locator("summary").click();
        await page.locator("#goalTaskSearch").fill("презентацию");
        const actions = await page.locator("#goalForm .form-actions").boundingBox();
        assert.ok(actions.y + actions.height <= 490, "goal links cannot push the footer under the keyboard");
        await capture("goal-keyboard");
        await page.setViewportSize({ width, height: 844 });
      }
      if (mobile) await page.locator("#goalForm .form-mobile-cancel").click();
      else await page.locator("#closeGoalForm").click();
      if (await page.locator("#confirmModal").isVisible()) await page.locator("#confirmAccept").click();

      await go("study");
      if (mobile) assert.ok((await page.locator("#studyHomeworkList .study-item").first().boundingBox()).y < 350, "homework starts near the top");
      await capture("homework");
      await page.locator('[data-study-tab="schedule"]').click();
      await page.locator('[data-study-schedule-mode="day"]').click();
      if (mobile) {
        assert.equal(await page.locator("#activeDate").isVisible(), false, "one date navigation in study");
        assert.ok((await page.locator("#studyScheduleList .study-item").first().boundingBox()).y < 480, "first lesson is not buried under controls");
      }
      await capture("schedule");
      await page.getByLabel("Дата расписания", { exact: true }).fill("2026-10-06");
      await page.getByLabel("Дата расписания", { exact: true }).dispatchEvent("change");
      assert.equal(await page.locator("#activeDate").inputValue(), "2026-10-06");
      await page.getByLabel("Дата расписания", { exact: true }).fill("2026-10-05");
      await page.getByLabel("Дата расписания", { exact: true }).dispatchEvent("change");
      await page.locator(".study-period-menu > summary").click();
      assert.equal(await page.getByRole("button", { name: "История ДЗ", exact: true }).isVisible(), true);
      await page.getByRole("button", { name: "История ДЗ", exact: true }).click();
      assert.equal(await page.locator(".study-period-menu").evaluate((node) => node.open), false);

      await go("calendar/day");
      if (mobile) {
        const scroller = page.locator(".calendar-time-scroll");
        await scroller.evaluate((node) => { node.scrollTop = 8 * 72; });
        const short = page.locator('[data-event-id="short"]');
        const size = await short.boundingBox();
        assert.ok(size.height < 20, "15-minute events keep their exact time scale");
        await page.touchscreen.tap(size.x + size.width / 2, size.y + size.height - 1);
        await page.getByRole("dialog", { name: "События рядом", exact: true }).waitFor();
        const choices = page.locator(".calendar-event-choice");
        assert.equal(await choices.count(), 2);
        assert.ok((await choices.first().boundingBox()).height >= 56);
        await capture("nearby-events");
        await choices.first().click();
        await page.locator("#calendarEventPreview").getByRole("button", { name: "Выполнить", exact: true }).click();
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks.find((task) => task.id === "short").completed["2026-10-05"]), true);
        await go("calendar/week");
        await page.locator(".calendar-touch-options > summary").click();
        await page.getByLabel("Количество дней в сетке", { exact: true }).selectOption("three");
        assert.equal(await page.locator(".calendar-time-column:visible").count(), 3);
        assert.equal(await scroller.evaluate((node) => node.scrollWidth > node.clientWidth + 1), false);
        await capture("three-days");
      }
      await go("calendar/month");
      if (mobile) {
        await page.locator(".calendar-month-jump").click();
        assert.equal(await page.locator("#calendarDayAgenda").evaluate((node) => document.activeElement === node), true);
      }
      await go("calendar/year");
      assert.ok(await page.evaluate(() => Boolean(document.querySelector(".calendar-period-metrics").compareDocumentPosition(document.querySelector(".activity-charts")) & Node.DOCUMENT_POSITION_FOLLOWING)), "period summary is above the charts");
      await page.getByLabel("День для статистики", { exact: true }).fill("2026-10-02");
      await page.getByLabel("День для статистики", { exact: true }).dispatchEvent("change");
      assert.match(await page.locator(".heatmap-inspector p").textContent(), /задачи 1 из 1/);
      await capture("statistics");

      await go("journal"); await page.locator(".notes-list-item").first().click();
      await page.locator('[data-note-mode="read"]').click();
      assert.equal(await page.locator("#noteTitle").evaluate((node) => node.readOnly), true);
      if (mobile) {
        assert.equal(await page.locator('#noteForm [type="submit"]').isVisible(), false);
        assert.equal(await page.locator("#noteDelete").isVisible(), false);
        assert.equal(await page.locator("#journalView > .toolbar").isVisible(), false);
      }
      await capture("note-read");
      await page.locator('[data-note-mode="edit"]').click();
      assert.equal(await page.locator('#noteForm [type="submit"]').isVisible(), true);
      assert.equal(await page.locator("#noteTitle").evaluate((node) => node.readOnly), false);

      await go("archive");
      if (mobile) {
        assert.equal(await page.locator(".archive-series").count(), 1);
        assert.equal(await page.locator(".archive-series .archive-item:visible").count(), 0);
        await page.locator(".archive-series > summary").click();
        assert.equal(await page.locator(".archive-series .archive-item:visible").count(), 3);
        await page.locator("#archiveSelectAll").check();
        assert.equal(await page.locator("#archiveSelectAll").isChecked(), true);
        await page.getByLabel("Группировать повторяющиеся задачи", { exact: true }).uncheck();
        assert.equal(await page.locator(".archive-series").count(), 0);
      } else assert.equal(await page.getByLabel("Группировать повторяющиеся задачи", { exact: true }).isChecked(), false);
      await capture("archive");
      await go("settings");
      const backup = page.locator('[data-settings-section="backup"]');
      if (await backup.count()) await backup.click();
      const before = await page.evaluate(() => localStorage.getItem("rhythm-day-state-v1"));
      await page.locator("#importFile").setInputFiles({ name: "replacement.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ tasks: [], notes: [{ id: "import", title: "Одна заметка" }] })) });
      await page.locator("#confirmModal").waitFor({ state: "visible" });
      assert.equal(await page.locator(".confirm-details dt").count(), 11);
      assert.match(await page.locator("#confirmMessage").textContent(), /будут заменены/);
      await capture("import-preview");
      await page.locator("#confirmCancel").click();
      assert.equal(await page.evaluate(() => localStorage.getItem("rhythm-day-state-v1")), before);
      await page.locator("#timeZoneSetting").evaluate((input) => {
        for (let node = input.parentElement; node; node = node.parentElement) if (node.tagName === "DETAILS") node.open = true;
      });
      await page.locator("#timeZoneSetting").scrollIntoViewIfNeeded();
      if (mobile) {
        const field = await page.locator("#timeZoneSetting").boundingBox();
        const row = await page.locator("#timeZoneSetting").locator("..").boundingBox();
        assert.ok(field.width >= row.width - 5, "time zone uses a full-width field");
      }
      await capture("settings-time-zone");
      await page.locator("#globalSearchButton").click();
      await page.locator("#globalSearchInput").fill("презентацию");
      const result = page.locator(".global-search-result").first();
      await result.waitFor();
      if (mobile) {
        const body = await result.locator(".global-search-result-body").boundingBox();
        const bounds = await result.boundingBox();
        assert.ok(body.width > bounds.width * .8, "result type does not steal title width");
      }
      await capture("search");
      await page.keyboard.press("Escape");
      await go("archive"); await page.locator("#archiveSelectAll").check();
      await page.locator("#archiveBulkDelete").click();
      await page.locator("#confirmModal").waitFor({ state: "visible" });
      assert.equal(await page.locator(".confirm-details").count(), 0, "new confirmations do not retain import details");
      await page.locator("#confirmCancel").click();
      const authUrl = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/auth.html" : "../app/auth.html"));
      await page.goto(authUrl.href);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "dark");
      await capture("auth");
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Mobile workspace flows passed at ${width}px`);
    }
    console.log(`Captures: ${captures}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
