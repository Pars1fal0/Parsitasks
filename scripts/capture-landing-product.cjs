const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");
const sharp = require("sharp");

const appDirectory = path.resolve(__dirname, "../app");
const day = "2026-11-19";
const due = "2026-11-20";
const title = "Подготовить доклад";

async function capture(page, name, image) {
  await page.evaluate(() => {
    document.activeElement?.blur();
    return document.fonts.ready;
  });
  await page.mouse.move(0, 0);
  const screenshot = await image();
  const result = await sharp(screenshot).webp({ lossless: true })
    .toFile(path.join(appDirectory, "assets/images", `landing-${name}.webp`));
  console.log(`${name}: ${result.width} × ${result.height}`);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", args: ["--allow-file-access-from-files"] });
  try {
    const context = await browser.newContext({
      viewport: { width: 1120, height: 860 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
      timezoneId: "Europe/Moscow",
    });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    await page.clock.install({ time: new Date(`${day}T15:05:00+03:00`) });
    const url = pathToFileURL(path.join(appDirectory, "index.html"));
    url.search = "automation=1";
    url.hash = "study";
    await page.goto(url.href);
    await page.waitForFunction(() => window.render && window.normalizeState);
    await page.evaluate(({ day, due, title }) => {
      const habits = [
        { id: "read", title: "Чтение", type: "check" },
        { id: "walk", title: "Прогулка", type: "check" },
      ].map((habit, index) => ({
        ...habit, startDate: "2026-11-01", repeat: "daily",
        logs: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [
          `2026-11-${String(i + 1).padStart(2, "0")}`, (i + index) % 4 !== 0,
        ])),
      }));
      window.state = window.normalizeState({
        defaultsSeeded: true,
        profile: { timeZone: "Europe/Moscow", planning: { start: "15:00", end: "19:00", duration: 60 } },
        categories: [{ id: "focus", name: "Учёба", color: "#36c4a0" }, { id: "home", name: "Личное", color: "#dba36b" }],
        tasks: [
          { id: "report", title, date: due, dueDate: due, dueTime: "10:00", studySubjectId: "literature", studyDetails: "Собрать примеры и подготовить выступление.", categoryId: "focus", repeat: "none" },
          { id: "walk-task", title: "Прогулка", date: day, categoryId: "home", repeat: "none", scheduleMode: "block", startTime: "17:30", endTime: "18:15", time: "18:15", completed: { [day]: true } },
          { id: "review", title: "Повторить конспект", date: "2026-11-02", repeat: "daily", repeatUntil: "2026-11-18",
            completed: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [
              `2026-11-${String(i + 2).padStart(2, "0")}`, i % 3 !== 0,
            ])) },
        ],
        habits,
        studySubjects: [{ id: "literature", name: "Литература", color: "#77a4ed" }],
        studyLessons: [{ id: "lecture", subjectId: "literature", weekday: 4, startTime: "14:00", endTime: "15:30", lessonType: "lecture" }],
      });
      window.updateSetting("themePreference", "dark");
      window.activeDate = day;
      window.activeView = "study";
      window.render();
    }, { day, due, title });

    const homework = page.locator("#studyHomeworkList .study-item").filter({ hasText: title });
    const assignmentPanel = page.locator('[aria-labelledby="studyHomeworkHeading"]');
    await homework.waitFor({ state: "visible" });
    await page.setViewportSize({ width: 620, height: 780 });
    await capture(page, "assignment", () => assignmentPanel.screenshot({ animations: "disabled" }));
    await page.setViewportSize({ width: 376, height: 820 });
    await capture(page, "assignment-mobile", () => assignmentPanel.screenshot({ animations: "disabled" }));
    await page.setViewportSize({ width: 1120, height: 860 });
    await homework.locator("summary").click();
    await homework.getByRole("button", { name: "Найти время для подготовки", exact: true }).click();
    const planner = page.locator(".calendar-planner-dialog");
    await planner.getByLabel("Период поиска").selectOption("day");
    await planner.locator(".planner-slot").first().click();
    await planner.getByLabel("Начало работы").fill("16:00");
    const plan = planner.getByRole("button", { name: "Запланировать", exact: true });
    assert.ok(await plan.isEnabled());
    const capturePlan = (name) => capture(page, name, async () => {
      const box = await planner.boundingBox();
      const results = await planner.locator(".planner-results").boundingBox();
      const preview = await planner.locator(".planner-preview").boundingBox();
      const top = results.y - 32;
      const bottom = Math.min(box.y + box.height, preview.y + preview.height + 18);
      return page.screenshot({ clip: { x: box.x, y: top, width: box.width, height: bottom - top }, animations: "disabled" });
    });
    await capturePlan("planning");
    await page.setViewportSize({ width: 376, height: 920 });
    await capturePlan("planning-mobile");
    await page.setViewportSize({ width: 1120, height: 860 });
    await plan.click();
    await page.waitForFunction(() => window.state.tasks.find((task) => task.id === "report")?.startTime === "16:00");
    assert.equal(await page.evaluate(() => window.state.tasks.find((task) => task.id === "report").dueDate), due);

    await page.locator('[data-overview-mode="day"]').click();
    const event = page.locator('.calendar-time-event[data-event-id="report"]');
    await event.waitFor({ state: "visible" });
    const showAfternoon = (hour) => page.locator(".calendar-time-scroll").evaluate((scroller, hour) => {
      const hourHeight = Number.parseFloat(getComputedStyle(document.querySelector("#calendarSchedule")).getPropertyValue("--calendar-hour-height"));
      scroller.scrollTop = hour * hourHeight;
    }, hour);
    await showAfternoon(15.85);
    await capture(page, "overview", async () => {
      const eventBox = await event.boundingBox();
      return page.screenshot({ clip: { x: 0, y: 0, width: 1120, height: Math.ceil(eventBox.y + eventBox.height + 55) }, animations: "disabled" });
    });
    await page.setViewportSize({ width: 420, height: 820 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await showAfternoon(14.8);
    await capture(page, "overview-mobile", async () => {
      const eventBox = await event.boundingBox();
      const schedule = await page.locator(".calendar-schedule-toolbar").boundingBox();
      const top = Math.floor(schedule.y);
      return page.screenshot({ clip: { x: 12, y: top, width: 396, height: Math.ceil(eventBox.y + eventBox.height + 25) - top }, animations: "disabled" });
    });

    assert.equal(await page.evaluate((day) => window.toggleCalendarTaskDone("report", day), day), true);
    await page.evaluate((day) => {
      for (const habit of window.state.habits) habit.logs[day] = true;
    }, day);
    await page.locator('[data-overview-mode="year"]').click();
    await page.locator(`.heatmap-cell.is-perfect-day[data-date="${day}"]`).waitFor({ state: "visible" });
    await page.locator("#appToast .toast-close").click();
    const heatmap = page.locator(".heatmap-panel");
    await heatmap.scrollIntoViewIfNeeded();
    await capture(page, "progress", async () => {
      const box = await heatmap.boundingBox();
      const details = await heatmap.locator(".heatmap-inspector").boundingBox();
      return page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: details.y - box.y }, animations: "disabled" });
    });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
