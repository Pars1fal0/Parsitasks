const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const electronApp = await electron.launch({
    args: [path.resolve(__dirname, ".."), "--e2e-test"],
    executablePath: require("electron"),
  });
  const page = await electronApp.firstWindow();

  try {
    await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const now = new Date();
      const dateKey = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const previousKey = [yesterday.getFullYear(), String(yesterday.getMonth() + 1).padStart(2, "0"), String(yesterday.getDate()).padStart(2, "0")].join("-");
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify({
        schemaVersion: 13,
        defaultsSeeded: true,
        profile: { timeZone: "Europe/Moscow" },
        categories: [
          { id: "work", name: "Работа", color: "#4f8cff", createdAt: `${dateKey}T06:00:00.000Z` },
          { id: "health", name: "Здоровье", color: "#19b394", createdAt: `${dateKey}T06:01:00.000Z` },
        ],
        tasks: [
          { id: "block-a", title: "Обсудить макет", date: dateKey, categoryId: "work", priority: "high", repeat: "none", scheduleMode: "block", startTime: "09:00", endTime: "10:15", time: "10:15", completed: {}, createdAt: `${dateKey}T06:10:00.000Z` },
          { id: "block-b", title: "Подготовить материалы", date: dateKey, categoryId: "work", priority: "medium", repeat: "none", scheduleMode: "block", startTime: "09:30", endTime: "10:30", time: "10:30", completed: {}, createdAt: `${dateKey}T06:11:00.000Z` },
          { id: "unscheduled", title: "Позвонить врачу", date: dateKey, categoryId: "health", priority: "medium", repeat: "none", scheduleMode: "none", completed: {}, createdAt: `${dateKey}T06:12:00.000Z` },
          { id: "archived", title: "Завершённая задача", date: previousKey, categoryId: "work", priority: "low", repeat: "none", scheduleMode: "none", completed: { [previousKey]: true }, createdAt: `${previousKey}T06:00:00.000Z` },
        ],
        habits: [
          { id: "habit-check", title: "Разминка", type: "check", repeat: "daily", startDate: previousKey, logs: {}, createdAt: `${previousKey}T06:00:00.000Z` },
          { id: "habit-number", title: "Вода", type: "number", goal: 8, step: 1, unit: "стаканов", repeat: "daily", startDate: previousKey, logs: { [dateKey]: 3 }, createdAt: `${previousKey}T06:01:00.000Z` },
        ],
        goals: [
          { id: "goal-1", title: "Подготовить релиз", deadline: dateKey, status: "active", checkpoints: [{ id: "step-1", title: "Проверить интерфейс", done: true }, { id: "step-2", title: "Собрать приложение", done: false }], createdAt: `${previousKey}T06:02:00.000Z` },
        ],
        taskOrder: { [dateKey]: ["block-a", "block-b", "unscheduled"] },
      }));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: dateKey, activeView: "tasks" }));
    });
    await page.reload();
    await page.waitForSelector("#pageTitle");
    await page.evaluate(fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"));
    const views = ["tasks", "timeline", "habits", "goals", "overview", "study", "journal", "board", "archive", "settings"];
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      for (const view of views) {
        const directTab = page.locator(`.nav-tab[data-view="${view}"]:visible`).first();
        if (await directTab.count()) {
          await directTab.click();
        } else {
          await page.locator(".nav-more-summary:visible").click();
          await page.locator(`.nav-more-menu .nav-tab[data-view="${view}"]`).click();
        }
        await page.waitForTimeout(20);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 1, `${view} must not overflow horizontally at ${width}px`);
        const screenshot = await page.screenshot();
        assert.ok(screenshot.length > 10_000, `${view} screenshot must not be blank`);
        if (width === 390 && view === "tasks") {
          const dateBox = await page.locator("#activeDate").boundingBox();
          assert.ok(dateBox.width >= 145, "mobile date field must show the full date");
        }
        if (process.env.CAPTURE_AUDIT) {
          await page.screenshot({ path: path.join(os.tmpdir(), `parsitasks-audit-${view}-${width}.png`), animations: "disabled" });
        }
        const audit = await page.evaluate(async () => window.axe.run(document));
        const blocking = audit.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
        assert.deepEqual(
          blocking.map((violation) =>
            `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`),
          [],
          `${view} has blocking accessibility violations at ${width}px`,
        );
      }
    }
    await page.setViewportSize({ width: 320, height: 700 });
    await page.locator('.nav-tab[data-view="tasks"]:visible').click();
    const compactDateBox = await page.locator("#activeDate").boundingBox();
    assert.ok(compactDateBox.width >= 130, "date field must remain readable at 320px");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "tasks must fit 320px");
    if (process.env.CAPTURE_AUDIT) {
      await page.screenshot({ path: path.join(os.tmpdir(), "parsitasks-audit-tasks-320.png"), animations: "disabled" });
    }
    console.log("e2e ok - accessibility, nonblank rendering, and horizontal fit");
  } finally {
    await electronApp.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
