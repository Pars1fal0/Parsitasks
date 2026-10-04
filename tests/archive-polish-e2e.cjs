const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-archive-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Europe/Saratov", locale: "ru-RU" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-04T10:00:00+04:00") });
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1";
    url.hash = "archive";
    await page.goto(url.href);
    await page.locator("#archiveView").waitFor({ state: "visible" });
    const tasks = [
      { id: "plan", title: "Подготовить план на следующую неделю", date: "2026-10-04", repeat: "none", checklist: [{ id: "first", title: "Собрать заметки" }], completed: { "2026-10-04": true } },
      { id: "work", title: "Отправить презентацию проекта", categoryId: "work", priority: "high", date: "2026-10-04", repeat: "none", completed: { "2026-10-04": true } },
      { id: "series", title: "Почитать перед сном", categoryId: "personal", date: "2026-10-01", repeat: "daily", completed: { "2026-10-03": true, "2026-10-01": true } },
      { id: "long", title: "Подготовить материалы для обсуждения учебного проекта и согласовать подробный план следующего этапа", categoryId: "study", date: "2026-10-03", repeat: "none", completed: { "2026-10-03": true } },
      { id: "old", title: "Забрать заказ", date: "2026-09-01", repeat: "none", completed: { "2026-09-01": true } },
    ];
    await page.evaluate((tasks) => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      Object.assign(state, {
        tasks, habits: [], goals: [], notes: [], studySubjects: [], studyLessons: [], studyFiles: [],
        categories: [
          { id: "work", name: "Работа", color: "#60a5fa" },
          { id: "personal", name: "Личное", color: "#f472b6" },
          { id: "study", name: "Учёба", color: "#fbbf24" },
        ],
      });
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-04", activeView: "archive", currentToday: "2026-10-04" }));
    }, tasks);
    await page.reload();
    await page.locator("#archiveView").waitFor({ state: "visible" });
    const rows = page.locator("#archiveList .archive-item");
    assert.equal(await rows.count(), 6);
    assert.equal(await page.locator(".archive-date-header").count(), 4);
    assert.equal(await rows.locator("p").filter({ hasText: /Без категории|Средний/ }).count(), 0);
    assert.equal(await rows.locator("p").filter({ hasText: /октября/ }).count(), 0);
    assert.equal(await rows.locator(".restore-task use").first().getAttribute("href"), "#icon-undo");
    await page.locator("#archiveSearch").fill("презентацию");
    await page.waitForFunction(() => document.querySelectorAll("#archiveList .archive-item").length === 1);
    await page.locator("#clearArchiveFilter").click();
    assert.equal(await rows.count(), 6);
    await page.locator("#archiveCategoryFilter").selectOption("personal");
    assert.equal(await rows.count(), 2);
    await page.locator("#clearArchiveFilter").click();
    await page.locator("#archivePeriodFilter").selectOption("week");
    assert.equal(await rows.count(), 5);
    await page.locator("#clearArchiveFilter").click();
    assert.equal(await rows.count(), 6);
    await rows.first().locator(".archive-select-hit-area").click();
    assert.equal(await rows.first().locator(".archive-item-select").isChecked(), true);
    assert.equal(await rows.first().evaluate((node) => node.classList.contains("is-selected")), true);
    assert.equal(await page.locator("#archiveBulkRestore").isVisible(), true);
    assert.equal(await page.locator("#archiveSelectAll").evaluate((node) => node.indeterminate), true);
    await page.waitForFunction(() => {
      const style = getComputedStyle(document.querySelector(".archive-item input:checked"));
      return style.backgroundColor === style.borderColor;
    });
    assert.ok(await rows.first().locator("input").evaluate((node) => {
      const style = getComputedStyle(node), mark = getComputedStyle(node, "::before");
      return style.appearance === "none" && style.borderRadius === "5px" && style.backgroundColor === style.borderColor && mark.opacity === "1";
    }), "checked input uses the shared custom treatment");
    assert.ok(await page.locator("#archiveSelectAll").evaluate((node) => getComputedStyle(node, "::before").maskImage === "none"), "partial selection uses a dash");
    await rows.first().locator("input").focus();
    await rows.first().locator("input").press("Space");
    assert.equal(await rows.first().locator("input").isChecked(), false, "custom appearance preserves keyboard selection");
    await rows.first().locator("input").press("Space");
    await page.locator("#archiveSelectAll").check();
    assert.equal(await page.locator(".archive-item.is-selected").count(), 6);
    await page.locator("#archiveSelectAll").uncheck();
    assert.equal(await page.locator(".archive-item.is-selected").count(), 0);
    await page.evaluate(() => { document.documentElement.dataset.accent = "violet"; });
    const glowSize = await page.locator("body").evaluate((node) => getComputedStyle(node).backgroundSize);
    assert.ok(glowSize.startsWith("100% 900px"));
    const beforeGrowth = await page.screenshot({ clip: { x: 1100, y: 480, width: 20, height: 20 } });
    await page.evaluate(() => {
      const spacer = document.createElement("div"); spacer.id = "archive-glow-spacer"; spacer.style.height = "4000px";
      document.querySelector("#archiveList").append(spacer);
    });
    const afterGrowth = await page.screenshot({ clip: { x: 1100, y: 480, width: 20, height: 20 } });
    assert.deepEqual(beforeGrowth, afterGrowth, "growing the archive does not stretch the glow");
    await page.evaluate(() => document.querySelector("#archive-glow-spacer").remove());
    for (const width of [1440, 900, 680, 390, 320]) {
      await page.setViewportSize({ width, height: width > 900 ? 1000 : 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no page overflow at ${width}`);
      if (width <= 680) {
        const category = await page.locator("#archiveCategoryFilter").boundingBox();
        const period = await page.locator("#archivePeriodFilter").boundingBox();
        const reset = await page.locator("#clearArchiveFilter").boundingBox();
        assert.ok(Math.abs(category.y - period.y) < 1 && Math.abs(category.y - reset.y) < 1, "filters and reset stay on one row");
      }
      for (const row of await rows.all()) {
        assert.ok(await row.evaluate((node) => {
          const outer = node.getBoundingClientRect();
          return [...node.children].every((child) => {
            const rect = child.getBoundingClientRect();
            return rect.left >= outer.left - 1 && rect.right <= outer.right + 1 && rect.bottom <= outer.bottom + 1;
          });
        }), `row contents fit at ${width}`);
      }
      for (const button of await rows.locator("button").all()) {
        const box = await button.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, "accessible action hit area");
        assert.ok(await button.getAttribute("aria-label"));
      }
      await page.screenshot({ path: path.join(captures, `archive-${width}.png`) });
    }
    await page.locator("#archiveSelectAll").check();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "bulk actions fit narrow mobile");
    await page.screenshot({ path: path.join(captures, "archive-320-selection.png") });
    await page.locator("#archiveSelectAll").uncheck();
    await page.emulateMedia({ forcedColors: "active" });
    assert.equal(await page.locator("#archiveSelectAll").evaluate((node) => getComputedStyle(node).appearance), "auto", "system high contrast retains native checkbox rendering");
    await page.emulateMedia({ forcedColors: "none" });
    await page.evaluate(() => { location.hash = "calendar/day"; });
    await page.locator("#overviewView").waitFor({ state: "visible" });
    for (const check of await page.locator("#overviewView input[type='checkbox']:visible").all()) {
      assert.equal(await check.evaluate((node) => getComputedStyle(node).appearance), "none", "calendar uses the shared checkbox");
    }
    await page.evaluate(() => { location.hash = "tasks"; });
    const checklist = page.locator('[data-checklist-task-id="plan"]');
    await checklist.locator("summary").click();
    const subtaskCheck = checklist.locator("input[type='checkbox']");
    assert.equal(await subtaskCheck.evaluate((node) => getComputedStyle(node).appearance), "none");
    await subtaskCheck.check();
    assert.equal(await subtaskCheck.isChecked(), true);
    await page.screenshot({ path: path.join(captures, "checkbox-subtask.png") });
    await page.evaluate(() => { location.hash = "settings"; });
    await page.locator('details[aria-labelledby="appearanceHeading"] > summary').click();
    await page.locator("#themePreference").selectOption("light");
    await page.locator('.accent-option.is-rose').click();
    await page.locator('details[aria-labelledby="notificationsSettingsHeading"] > summary').click();
    const quiet = page.locator("#quietHoursEnabled");
    assert.equal(await quiet.evaluate((node) => getComputedStyle(node).appearance), "none");
    await quiet.check();
    assert.equal(await quiet.isChecked(), true);
    await page.locator('details[aria-labelledby="navigationSettingsHeading"] > summary').click();
    const navChecks = page.locator("#navigationPreferences input[type='checkbox']");
    assert.ok(await navChecks.count() > 0);
    for (const check of await navChecks.all()) assert.equal(await check.evaluate((node) => getComputedStyle(node).appearance), "none");
    await page.screenshot({ path: path.join(captures, "checkbox-settings-light.png") });
    await page.evaluate(() => { location.hash = "archive"; });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(captures, "archive-light.png") });
    await page.locator("#archiveSearch").fill("Нет такой задачи");
    await page.locator("#archiveEmpty.is-visible").waitFor();
    assert.equal(await page.locator("#archiveBulkBar").isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(`Archive checks passed. Captures: ${captures}`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
