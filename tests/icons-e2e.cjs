const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");
const sharp = require("sharp");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-icons-"));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Europe/Saratov" });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-04T10:00:00+04:00") });
    const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/index.html" : "../app/index.html"));
    url.search = "automation=1"; url.hash = "tasks";
    await page.goto(url.href); await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      Object.assign(state, {
        tasks: [
          { id: "plain", title: "Задача для проверки значков", date: "2026-10-04", repeat: "none", completed: {}, checklist: [{ id: "one", title: "Подзадача" }] },
          { id: "block", title: "Короткая задача", date: "2026-10-04", repeat: "none", completed: {}, scheduleMode: "block", startTime: "11:45", endTime: "12:00", time: "12:00" },
        ],
        habits: [{ id: "water", title: "Вода", type: "number", goal: 3000, unit: "мл", repeat: "daily", startDate: "2026-10-01", logs: {}, freezeDays: {} }],
        studySubjects: [{ id: "math", name: "Математика", color: "#7ca6ff" }],
        studyLessons: [{ id: "practice", subjectId: "math", weekday: 5, weekType: "all", lessonType: "practice", startTime: "11:30", endTime: "13:00" }],
        studyFiles: [], goals: [], notes: [],
        boardItems: [{ id: "card", type: "text", text: "Тестовая карточка", x: 0, y: 0, width: 240, height: 160 }],
      });
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
      localStorage.setItem("rhythm-day-ui-v1", JSON.stringify({ activeDate: "2026-10-04", activeView: "tasks", themePreference: "dark" }));
    });
    await page.reload(); await page.waitForSelector("#tasksView:visible");
    const audit = async () => {
      const issues = await page.evaluate(() => {
        const problems = [];
        for (const use of document.querySelectorAll("use")) {
          const href = use.getAttribute("href");
          if (href?.startsWith("#icon-") && !document.getElementById(href.slice(1))) problems.push("Missing " + href);
        }
        for (const svg of document.querySelectorAll("button .ui-icon, summary .ui-icon")) {
          if (!svg.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) continue;
          const bounds = svg.getBoundingClientRect();
          const control = svg.closest("button, summary"), box = control.getBoundingClientRect();
          const shape = svg.getBBox();
          if (shape.width + shape.height <= 0) problems.push("Blank " + control.outerHTML.slice(0, 150));
          if (bounds.left < box.left - 1 || bounds.right > box.right + 1 || bounds.top < box.top - 1 || bounds.bottom > box.bottom + 1) problems.push("Overflow " + control.outerHTML.slice(0, 150));
          if (!control.textContent.trim() && !control.getAttribute("aria-label") && !control.title) problems.push("No name " + control.outerHTML.slice(0, 150));
        }
        return problems;
      });
      assert.deepEqual(issues, []);
    };
    await page.locator(".task-more > summary").first().click();
    await audit();
    await page.locator(".task-more > summary").first().click();
    await page.screenshot({ path: path.join(captures, "tasks-desktop.png") });
    await page.locator("#openTaskForm").click(); await audit();
    await page.locator("#closeTaskForm").click();
    if (await page.locator("#confirmModal").isVisible()) await page.locator("#confirmAccept").click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const hash of ["tasks", "habits", "calendar/day", "study", "goals", "journal", "board", "archive", "settings"]) {
        await page.evaluate((value) => { location.hash = value; window.scrollTo(0, 0); }, hash);
        const view = hash.startsWith("calendar/") ? "overview" : hash;
        await page.locator("#" + view + "View").waitFor({ state: "visible" });
        await audit();
        if (["tasks", "habits", "board"].includes(hash) && width !== 320) await page.screenshot({ path: path.join(captures, hash + "-" + width + ".png") });
      }
    }
    await page.evaluate(() => {
      const catalogue = document.createElement("section");
      catalogue.id = "iconCatalogue";
      Object.assign(catalogue.style, { position: "fixed", inset: "0", zIndex: "9999", overflow: "auto", display: "grid", gridTemplateColumns: "repeat(8, 100px)", gap: "12px", padding: "24px", background: "#131516", color: "#e9eced", alignContent: "start" });
      for (const symbol of document.querySelectorAll(".icon-sprite symbol")) {
        const cell = document.createElement("div");
        Object.assign(cell.style, { display: "grid", justifyItems: "center", gap: "12px", padding: "12px 0", fontSize: "11px" });
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("ui-icon"); svg.style.width = "24px"; svg.style.height = "24px";
        const use = document.createElementNS(svg.namespaceURI, "use");
        use.setAttribute("href", "#" + symbol.id); svg.append(use);
        const label = document.createElement("span"); label.textContent = symbol.id.slice(5);
        cell.append(svg, label); catalogue.append(cell);
      }
      document.body.append(catalogue);
    });
    await page.setViewportSize({ width: 940, height: 750 });
    const count = await page.locator("#iconCatalogue svg").count();
    assert.ok(count > 50);
    for (const svg of await page.locator("#iconCatalogue svg").all()) {
      const png = await svg.screenshot();
      const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let ink = 0;
      for (let i = 0; i < data.length; i += 3) if (data[i] > 100 && data[i + 1] > 100 && data[i + 2] > 100) ink++;
      assert.ok(ink > 8, "Each symbol has visible pixels");
    }
    await page.screenshot({ path: path.join(captures, "catalogue.png") });
    assert.deepEqual(errors, []);
    console.log("Icon checks passed: " + count + " symbols, desktop/mobile, isolated profile. Captures: " + captures);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
