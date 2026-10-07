const assert = require("node:assert/strict");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const electronApp = await electron.launch({
    args: [path.resolve(__dirname, ".."), "--e2e-test"],
    executablePath: require("electron"),
  });
  const page = await electronApp.firstWindow();
  await require("./navigation-fixture.cjs").enableAllSections(page);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.waitForSelector("#pageTitle");
    const activeDate = await page.evaluate(() => {
      const date = new Date();
      const dateKey = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify({
        categories: [],
        tasks: [
          { id: "task-1", title: "First task", date: dateKey, priority: "high", repeat: "none", completed: {}, createdAt: `${dateKey}T08:00:00.000Z` },
          { id: "task-2", title: "Timed task", date: dateKey, priority: "medium", repeat: "none", scheduleMode: "block", startTime: "18:00", endTime: "19:00", time: "18:00", completed: {}, createdAt: `${dateKey}T08:01:00.000Z` },
        ],
        habits: [
          { id: "habit-1", title: "First habit", type: "check", repeat: "daily", startDate: "2020-01-01", createdAt: "2020-01-01T08:00:00.000Z", logs: {} },
          { id: "habit-2", title: "Second habit", type: "check", repeat: "daily", startDate: "2020-01-01", createdAt: "2020-01-01T08:01:00.000Z", logs: {} },
        ],
        goals: [],
      }));
      return dateKey;
    });
    await page.reload();
    await page.waitForSelector("#pageTitle");
    await page.locator("#activeDate").fill(activeDate);
    await page.locator("#activeDate").dispatchEvent("change");
    await page.setViewportSize({ width: 320, height: 720 });

    await require("./navigation-fixture.cjs").navigate(page, "tasks");
    const taskCard = page.locator(".task-item").first();
    await taskCard.locator(".task-more > summary").click();
    await waitForDisclosurePosition(taskCard.locator(".task-more"));
    assertMenuFits(await menuBounds(taskCard.locator(".task-more-menu")), "task menu");
    assert.ok((await taskCard.locator(".task-more-menu").boundingBox()).height > 100, "task menu must not collapse on mobile");
    await page.mouse.click(1, 1);
    assert.equal(await taskCard.locator(".task-more").getAttribute("open"), null, "outside click must close task menu");

    await require("./navigation-fixture.cjs").navigate(page, "habits");
    const habitCards = page.locator(".habit-item");
    await habitCards.first().locator(".habit-more > summary").click();
    await habitCards.nth(1).locator(".habit-more > summary").click();
    await waitForDisclosurePosition(habitCards.nth(1).locator(".habit-more"));
    assert.equal(await habitCards.first().locator(".habit-more").getAttribute("open"), null, "opening another menu must close the previous one");
    assertMenuFits(await menuBounds(habitCards.nth(1).locator(".habit-more-menu")), "habit menu");
    await page.keyboard.press("Escape");
    assert.equal(await habitCards.nth(1).locator(".habit-more").getAttribute("open"), null, "Escape must close habit menu");

    await page.setViewportSize({ width: 1440, height: 800 });
    await require("./navigation-fixture.cjs").navigate(page, "timeline");
    const timelineTask = page.locator(".timeline-task.is-scheduled").first();
    await timelineTask.scrollIntoViewIfNeeded();
    await timelineTask.locator(".timeline-menu-button").click();
    assertMenuFits(await menuBounds(timelineTask.locator(".timeline-task-menu")), "timeline menu");
    assert.deepEqual(pageErrors, []);

    console.log("e2e ok - card menus stay visible and dismiss consistently");
  } finally {
    await electronApp.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function menuBounds(locator) {
  return locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      bottom: rect.bottom,
      hitInside: node.contains(hit),
      left: rect.left,
      right: rect.right,
      top: rect.top,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      menuHeight: rect.height,
      trigger: node.closest("details")?.querySelector("summary")?.getBoundingClientRect().toJSON(),
      maxHeight: getComputedStyle(node).maxHeight,
      position: getComputedStyle(node).position,
      classes: node.closest("details")?.className,
    };
  });
}

async function waitForDisclosurePosition(locator) {
  await locator.evaluate((node) => new Promise((resolve, reject) => {
    const isPositioned = () => node.classList.contains("menu-opens-up") || node.classList.contains("menu-opens-down");
    if (isPositioned()) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Disclosure menu was not positioned"));
    }, 2000);
    const observer = new MutationObserver(() => {
      if (!isPositioned()) return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve();
    });
    observer.observe(node, { attributeFilter: ["class"] });
  }));
}

function assertMenuFits(bounds, label) {
  assert.ok(bounds.top >= 0, `${label} must stay below the viewport top: ${JSON.stringify(bounds)}`);
  assert.ok(bounds.bottom <= bounds.viewportHeight, `${label} must stay above the viewport bottom`);
  assert.ok(
    bounds.left >= 0 && bounds.right <= bounds.viewportWidth,
    `${label} must fit horizontally: ${JSON.stringify(bounds)}`,
  );
  assert.equal(bounds.hitInside, true, `${label} must render above surrounding cards`);
}
