const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const observe = process.argv.includes("--observe");
  const findings = [];
  const check = (name, passed, evidence) => {
    findings.push({ name, passed: Boolean(passed), evidence });
    if (!observe) assert.ok(passed, `${name}: ${JSON.stringify(evidence)}`);
  };
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU", timezoneId: "Europe/Saratov" });
    const appUrl = process.argv.find((arg) => arg.startsWith("--app-url="))?.slice(10);
    if (appUrl && !["127.0.0.1", "localhost"].includes(new URL(appUrl).hostname)) throw new Error("Only an isolated local preview may be tested");
    const allowedOrigin = appUrl ? new URL(appUrl).origin : "";
    await context.route(/^https?:/, (route) => new URL(route.request().url()).origin === allowedOrigin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-02T10:00:00+04:00"));
    const url = appUrl ? new URL(appUrl) : pathToFileURL(path.resolve(__dirname, "../app/index.html"));
    url.search = "automation=1";
    url.hash = "habits";
    await page.goto(url.href);
    await page.waitForSelector("#pageTitle");
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    const seed = async (view = "habits", extra = {}) => {
      await page.evaluate(({ view, extra }) => {
        if (window.savedWrite) Storage.prototype.setItem = window.savedWrite;
        const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
        Object.assign(state, { tasks: [], habits: [
          { id: "check", title: "Зарядка", type: "check", repeat: "daily", startDate: "2026-09-01", logs: {}, goal: 1 },
          { id: "water", title: "Вода", type: "number", repeat: "daily", startDate: "2026-09-01", logs: { "2026-10-02": 300 }, goal: 2000, unit: "мл" },
        ], goals: [], notes: [], studySubjects: [], studyLessons: [], studyFiles: [], taskOrder: {}, habitOrder: [] }, extra);
        localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
        localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-02", activeView: view }));
        history.replaceState(null, "", `?automation=1#${view}`);
      }, { view, extra });
      await page.reload();
      await page.waitForSelector(`body[data-view="${view}"]`);
    };
    const failWrites = () => page.evaluate(() => {
      window.savedWrite = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "rhythm-day-state-v1") throw new DOMException("Quota exceeded", "QuotaExceededError");
        return window.savedWrite.call(this, key, value);
      };
    });
    const resumeWrites = () => page.evaluate(() => { Storage.prototype.setItem = window.savedWrite; });
    const closeToast = async () => { if (await page.locator("#appToast .toast-close").isVisible()) await page.locator("#appToast .toast-close").click(); };
    const habit = (id) => page.locator(`#habitList [data-habit-id="${id}"]`);

    await seed();
    await failWrites();
    await habit("check").locator(".check-button").click();
    check("failed checkbox reverts instead of claiming completion", !(await habit("check").locator(".check-button").getAttribute("class")).includes("is-checked"), await page.locator("#appToast").innerText());
    await closeToast();
    await habit("water").getByRole("button", { name: "Вода: добавить 100 мл", exact: true }).click();
    check("failed numeric habit restores its previous value", (await habit("water").locator('input[type="number"]').inputValue()) === "300", await habit("water").innerText());
    await closeToast();
    await page.locator("#openHabitForm").click();
    await page.locator("#habitTitle").fill("Несохранённая привычка");
    await page.locator('#habitForm button[type="submit"]').click();
    check("failed habit create keeps the editor text", await page.locator("#habitFormPanel").isVisible() && await page.locator("#habitTitle").inputValue() === "Несохранённая привычка", { rows: await page.locator("#habitList .habit-item").count(), toast: await page.locator("#appToast").innerText() });
    if (!observe) {
      assert.equal(await page.locator("#habitList .habit-item").count(), 2);
      assert.match(await page.locator("#habitForm .form-save-error").innerText(), /Не удалось сохранить/);
      for (const width of [320, 390, 599, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator("#habitForm .form-save-error").scrollIntoViewIfNeeded();
        const bounds = await page.locator("#habitForm .form-save-error").evaluate((el) => {
          const box = el.getBoundingClientRect();
          return { left: box.left, right: box.right, overflow: el.scrollWidth > el.clientWidth };
        });
        check(`inline save error fits ${width}px`, bounds.left >= 0 && bounds.right <= width && !bounds.overflow, bounds);
        const capture = process.argv.find((arg) => arg.startsWith("--capture="))?.slice(10);
        if (capture && width === 320) {
          fs.mkdirSync(capture, { recursive: true });
          await page.screenshot({ path: path.join(capture, "habit-save-error-320.png") });
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await resumeWrites();
      await page.locator('#habitForm button[type="submit"]').click();
      assert.equal((await state()).habits.length, 3);
      assert.deepEqual((await state()).habits.find((item) => item.id === "check").logs, {});
      assert.equal((await state()).habits.find((item) => item.id === "water").logs["2026-10-02"], 300);
    }

    await seed();
    await page.locator("#openHabitFreeze").click();
    await page.locator("#habitFreezeList .habit-freeze-choice").first().click();
    await page.locator("#habitFreezeReason").selectOption("Болезнь");
    await failWrites();
    await page.locator("#habitFreezeSubmit").click();
    check("failed freeze keeps selection and reason in an open dialog", await page.locator("#habitFreezeDialog").isVisible(), { frozen: await page.locator("#habitList .is-frozen").count(), toast: await page.locator("#appToast").innerText() });
    if (!observe) {
      assert.equal(await page.locator("#habitFreezeReason").inputValue(), "Болезнь");
      assert.equal(await page.locator("#habitFreezeList input:checked").count(), 1);
      assert.equal(await page.locator("#habitList .is-frozen").count(), 0);
      await resumeWrites();
      await page.locator("#habitFreezeSubmit").click();
      assert.equal(await page.locator("#habitList .is-frozen").count(), 1);
      await failWrites();
      await closeToast();
      await habit("check").locator(".habit-frozen-row button").click();
      assert.equal(await page.locator("#habitList .is-frozen").count(), 1);
      await resumeWrites();
      await page.reload();
      assert.equal(await page.locator("#habitList .is-frozen").count(), 1);
    }
    if (!observe) {
      for (const action of ["archive", "delete", "edit", "reorder"]) {
        await seed();
        const before = (await state()).habits;
        await failWrites();
        if (action === "reorder") {
          await habit("check").locator(".habit-drag-handle").press("ArrowDown");
          assert.deepEqual(await page.locator("#habitList .habit-item").evaluateAll((items) => items.map((item) => item.dataset.habitId)), ["check", "water"]);
        } else {
          await habit("check").locator(".habit-actions > summary").click();
          await habit("check").locator(`.${action}-habit`).click();
          if (action === "delete") await page.locator("#confirmAccept").click();
          if (action === "edit") {
            await page.locator("#habitTitle").fill("Изменённая зарядка");
            await page.locator('#habitForm button[type="submit"]').click();
            assert.equal(await page.locator("#habitTitle").inputValue(), "Изменённая зарядка");
            assert.match(await page.locator("#habitForm .form-save-error").innerText(), /Не удалось сохранить/);
          }
          assert.equal(await habit("check").isVisible(), true);
          assert.equal(await habit("check").locator("h3").innerText(), "Зарядка");
        }
        assert.deepEqual((await state()).habits, before);
        check(`habit ${action} rolls back on failure`, true, { count: before.length });
      }

      await seed("habits", { habits: [{ id: "archived", title: "Архивная привычка", type: "check", repeat: "daily", startDate: "2026-09-01", archived: true, archivedFromDate: "2026-09-30", logs: {} }] });
      await failWrites();
      await page.locator("#habitArchivePanel > summary").click();
      await page.getByRole("button", { name: "Вернуть в активные", exact: true }).click();
      assert.equal(await page.locator("#habitArchiveList .habit-archive-item").count(), 1);
      assert.equal(await page.locator("#habitList .habit-item").count(), 0);
      await closeToast();
      if ((await page.locator("#habitArchivePanel").getAttribute("open")) === null) await page.locator("#habitArchivePanel > summary").click();
      await page.locator("#habitArchiveList").getByRole("button", { name: "Удалить", exact: true }).click();
      await page.locator("#confirmAccept").click();
      assert.equal(await page.locator("#habitArchiveList .habit-archive-item").count(), 1);
      check("archive restore and permanent delete roll back", true, {});

      await page.setViewportSize({ width: 1440, height: 1000 });
      for (const action of ["complete", "duplicate", "unschedule", "delete", "postpone-next", "shift"]) {
        await seed("timeline", { tasks: [{ id: "block", title: "Подготовить доклад", date: "2026-10-02", repeat: "none", scheduleMode: "block", startTime: "10:00", endTime: "11:00", time: "11:00", completed: {}, notified: {}, priority: "medium" }] });
        await failWrites();
        const card = () => page.locator('#timelineView [data-task-id="block"]');
        if (action === "shift") await card().locator(".timeline-task-main").press("Alt+ArrowDown");
        else {
          await card().locator(".timeline-menu-button").click();
          await card().locator(`[data-action="${action}"]`).click();
        }
        assert.equal(await card().count(), 1);
        assert.equal(await card().evaluate((el) => el.classList.contains("is-time-block")), true);
        assert.match(await card().innerText(), /10:00.*11:00/);
        assert.doesNotMatch(await page.locator("#appToast").innerText(), /Задача выполнена|продублирована|удалена|теперь без времени|перенесена на|Блок обновлен|Перенесено на/);
        await resumeWrites();
        await closeToast();
        await card().locator(".timeline-menu-button").click();
        await card().locator('[data-action="complete"]').click();
        const saved = (await state()).tasks;
        assert.equal(saved.length, 1);
        assert.equal(saved[0].date, "2026-10-02");
        assert.equal(saved[0].startTime, "10:00");
        assert.equal(saved[0].endTime, "11:00");
        assert.equal(saved[0].completed["2026-10-02"], true);
        await page.reload();
        assert.equal(await card().count(), 1);
        check(`timeline ${action} rolls back and retry survives reload`, true, saved[0].title);
      }

      for (const action of ["shift", "skip", "stop"]) {
        await seed("timeline", { tasks: [{ id: "repeat", title: "Повторяющийся доклад", date: "2026-09-01", repeat: "daily", time: "10:00", scheduleMode: "deadline", completed: {}, excludedDates: {}, notified: {} }] });
        await failWrites();
        const card = () => page.locator('#timelineView [data-task-id="repeat"]');
        if (action === "shift") await card().locator(".timeline-task-main").press("Alt+ArrowDown");
        else {
          await card().locator(".timeline-menu-button").click();
          await card().locator('[data-action="delete"]').click();
        }
        await page.locator(action === "stop" ? "#confirmAccept" : "#confirmSecondary").click();
        assert.equal(await card().count(), 1);
        assert.match(await card().innerText(), /10:00/);
        await resumeWrites();
        await closeToast();
        await card().locator(".timeline-menu-button").click();
        await card().locator('[data-action="complete"]').click();
        const saved = (await state()).tasks;
        assert.equal(saved.length, 1);
        assert.deepEqual(saved[0].excludedDates, {});
        assert.equal(saved[0].repeatUntil, "");
        assert.equal(saved[0].time, "10:00");
        assert.equal(saved[0].completed["2026-10-02"], true);
        check(`recurring timeline ${action} rolls back`, true, {});
      }
    }
    check("no browser runtime errors", errors.length === 0, errors);
    const release = appUrl ? await (await page.request.get(`${allowedOrigin}/release.json`)).json() : null;
    const output = { browser: browser.version(), appUrl: url.href, buildHash: release?.buildHash || null, syntheticDate: "2026-10-02", findings };
    const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
    if (outputArg) fs.writeFileSync(outputArg.slice(9), JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
