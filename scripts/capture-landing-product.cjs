const path = require("node:path");
const { _electron: electron } = require("playwright-core");

function toDateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const electronApp = await electron.launch({
    args: [root, "--e2e-test"],
    executablePath: require("electron"),
  });
  const page = await electronApp.firstWindow();

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector("#pageTitle");
    const previewDate = new Date();
    previewDate.setDate(previewDate.getDate() + 1);
    const dateKey = toDateKey(previewDate);
    const todayKey = toDateKey(new Date());

    await page.evaluate(({ activeDate, currentToday }) => {
      const createdAt = `${activeDate}T00:00:00.000Z`;
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify({
        schemaVersion: 15,
        defaultsSeeded: true,
        profile: { timeZone: "Europe/Moscow" },
        categories: [
          { id: "focus", name: "Фокус", color: "#28b995", createdAt },
          { id: "work", name: "Работа", color: "#5388e8", createdAt },
          { id: "team", name: "Команда", color: "#a677df", createdAt },
          { id: "personal", name: "Личное", color: "#d8904b", createdAt },
        ],
        tasks: [
          { id: "landing-plan", title: "Разобрать план релиза", date: activeDate, categoryId: "work", priority: "high", repeat: "none", scheduleMode: "block", startTime: "00:45", endTime: "02:15", time: "02:15", completed: {}, createdAt },
          { id: "landing-focus", title: "Глубокая работа", date: activeDate, categoryId: "focus", priority: "high", repeat: "none", scheduleMode: "block", startTime: "01:30", endTime: "03:15", time: "03:15", completed: {}, createdAt },
          { id: "landing-call", title: "Созвон с командой", date: activeDate, categoryId: "team", priority: "medium", repeat: "none", scheduleMode: "block", startTime: "03:45", endTime: "04:30", time: "04:30", completed: {}, createdAt },
          { id: "landing-deck", title: "Подготовить презентацию", date: activeDate, categoryId: "personal", priority: "medium", repeat: "none", scheduleMode: "block", startTime: "05:00", endTime: "06:30", time: "06:30", completed: {}, createdAt },
          { id: "landing-ticket", title: "Заказать билеты", date: activeDate, categoryId: "personal", priority: "low", repeat: "none", scheduleMode: "none", time: "", completed: {}, createdAt },
        ],
        habits: [],
        goals: [],
        taskOrder: { [activeDate]: ["landing-plan", "landing-focus", "landing-call", "landing-deck", "landing-ticket"] },
      }));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate, activeView: "timeline", currentToday }));
      localStorage.setItem("rhythm-timeline-scale", "normal");
      location.hash = "#timeline";
    }, { activeDate: dateKey, currentToday: todayKey });

    await page.reload();
    await page.waitForSelector("#pageTitle");
    const timelineTab = page.locator('.nav-tab[data-view="timeline"]:visible').first();
    if (await timelineTab.count()) await timelineTab.click();
    await page.locator("#activeDate").fill(dateKey);
    await page.locator("#activeDate").dispatchEvent("change");
    await page.waitForSelector(".timeline-task.is-scheduled");
    await page.waitForFunction(() => document.querySelectorAll(".timeline-task.is-scheduled").length === 4);
    await page.evaluate(() => document.activeElement?.blur());
    await page.screenshot({ path: path.join(root, "app", "assets", "images", "landing-product.png") });
    console.log("landing product screenshot updated");
  } finally {
    await electronApp.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
