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
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const key = "rhythm-day-state-v1";
      const state = JSON.parse(localStorage.getItem(key));
      const date = document.querySelector("#activeDate").value;
      state.tasks = state.tasks.filter((task) => !String(task.id).startsWith("e2e-timeline-"));
      state.tasks.push(
        {
          id: "e2e-timeline-unscheduled",
          title: "Перетащить без времени",
          date,
          time: "",
          scheduleMode: "none",
          startTime: "",
          endTime: "",
          categoryId: "",
          priority: "high",
          repeat: "none",
          reminderOffset: "none",
          completed: {},
          acknowledgedOverdue: {},
          excludedDates: {},
          notified: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "e2e-timeline-block",
          title: "Проверить живой размер",
          date,
          time: "11:00",
          scheduleMode: "block",
          startTime: "10:00",
          endTime: "11:00",
          categoryId: "",
          priority: "medium",
          repeat: "none",
          reminderOffset: "none",
          completed: {},
          acknowledgedOverdue: {},
          excludedDates: {},
          notified: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      );
      localStorage.setItem(key, JSON.stringify(state));
      location.hash = "#timeline";
    });
    await page.reload();
    await page.waitForSelector('body[data-view="timeline"]');
    await page.locator(".timeline-unscheduled-panel").evaluate((node) => { node.open = true; });
    await page.evaluate(() => scrollTo(0, 0));

    const unscheduledCard = page.locator('[data-task-id="e2e-timeline-unscheduled"]');
    assert.equal(await unscheduledCard.locator(".timeline-unscheduled-drag-handle").count(), 1);
    const firstSlot = page.locator('.timeline-hour-slot[data-hour="0"]');
    const unscheduledBox = await unscheduledCard.locator(".timeline-unscheduled-drag-handle").boundingBox();
    const firstSlotBox = await firstSlot.boundingBox();
    assert.ok(unscheduledBox && firstSlotBox, "unscheduled task and first timeline slot should be visible");
    await page.mouse.move(unscheduledBox.x + unscheduledBox.width / 2, unscheduledBox.y + unscheduledBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(firstSlotBox.x + 90, firstSlotBox.y + firstSlotBox.height / 2, { steps: 10 });
    assert.equal(await firstSlot.evaluate((node) => node.classList.contains("is-drop-target")), true);
    await page.mouse.up();
    await page.waitForFunction(() => {
      const task = JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks.find((item) => item.id === "e2e-timeline-unscheduled");
      return task?.scheduleMode === "block" && task.startTime === "00:30" && task.priority === "high";
    });
    const scheduledFromUnscheduled = page.locator('[data-task-id="e2e-timeline-unscheduled"]');
    assert.equal(await scheduledFromUnscheduled.evaluate((node) => node.classList.contains("is-time-block")), true);
    assert.equal(await scheduledFromUnscheduled.locator(".timeline-resize-handle").count(), 2);
    assert.equal(await scheduledFromUnscheduled.evaluate((node) => node.classList.contains("is-just-scheduled")), true);

    await page.locator('[data-timeline-scale="large"]').click();
    let blockCard = page.locator('[data-task-id="e2e-timeline-block"]');
    await blockCard.scrollIntoViewIfNeeded();
    const scrollBeforeMove = await page.evaluate(() => scrollY);
    const blockBox = await blockCard.boundingBox();
    assert.ok(blockBox, "time block should be visible");
    await page.mouse.move(blockBox.x + 90, blockBox.y + blockBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(blockBox.x + 90, blockBox.y + blockBox.height / 2 + 36, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => {
      const task = JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks.find((item) => item.id === "e2e-timeline-block");
      return task?.startTime === "10:15";
    });
    await page.waitForTimeout(80);
    const scrollAfterMove = await page.evaluate(() => scrollY);
    assert.ok(Math.abs(scrollAfterMove - scrollBeforeMove) <= 2, `timeline scroll changed from ${scrollBeforeMove} to ${scrollAfterMove}`);

    blockCard = page.locator('[data-task-id="e2e-timeline-block"]');
    const endHandle = blockCard.locator(".timeline-resize-handle.is-end");
    const handleBox = await endHandle.boundingBox();
    assert.ok(handleBox, "end resize handle should be visible");
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2 - 108, { steps: 8 });
    const liveHeight = await blockCard.evaluate((node) => node.getBoundingClientRect().height);
    assert.ok(liveHeight <= 34, `15-minute live preview should be compact, got ${liveHeight}px`);
    assert.equal(await blockCard.evaluate((node) => node.classList.contains("is-tiny-block")), true);
    await page.mouse.up();
    await page.waitForFunction(() => {
      const task = JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tasks.find((item) => item.id === "e2e-timeline-block");
      return task?.startTime === "10:15" && task.endTime === "10:30";
    });

    blockCard = page.locator('[data-task-id="e2e-timeline-block"]');
    assert.equal(await blockCard.locator('.timeline-menu-item[data-action="create-neighbor"]').count(), 1);
    await blockCard.locator(".timeline-create-neighbor-button").click();
    assert.equal(await page.locator("#taskStartTime").inputValue(), "10:15");
    assert.equal(await page.locator("#taskEndTime").inputValue(), "10:30");
    assert.equal(await page.locator("#taskScheduleBlock").isChecked(), true);
    await page.locator("#closeTaskForm").click();
    assert.equal(await page.locator("#confirmModal").isVisible(), false, "prefilled untouched block is not an unsaved edit");

    const viewedDate = await page.locator("#activeDate").inputValue();
    await blockCard.locator(".timeline-menu-button").click();
    assert.equal(await blockCard.locator('.timeline-menu-item[data-action="postpone-next"]').isVisible(), true);
    await blockCard.locator('.timeline-menu-item[data-action="postpone-next"]').click();
    const movedDate = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1"))
      .tasks.find((item) => item.id === "e2e-timeline-block").date);
    assert.notEqual(movedDate, viewedDate);
    assert.equal(await page.locator('[data-task-id="e2e-timeline-block"]').count(), 0);
    await page.locator("#appToast button", { hasText: "Отменить" }).click();
    assert.equal(await page.locator('[data-task-id="e2e-timeline-block"]').count(), 1);
    await page.locator("#timelineJumpToTask").click();
    await page.waitForFunction(() => scrollY > 200);

    await require("./navigation-fixture.cjs").navigate(page, "journal");
    await page.locator('[data-notes-tab="journal"]').click();
    const editor = page.locator("#journalText");
    await editor.fill("Итог дня");
    await editor.press("Control+a");
    await page.locator('[data-journal-format="h1"]').click();
    assert.equal(await editor.locator("h1").textContent(), "Итог дня");
    await page.waitForTimeout(650);
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).journalEntries.some((entry) => entry.text === "# Итог дня")),
      true,
    );
    await editor.fill("Важный фрагмент");
    await editor.press("Control+a");
    await page.locator('[data-journal-format="body"]').click();
    await editor.press("Control+a");
    await page.locator('[data-journal-format="bold"]').click();
    assert.equal(await editor.locator("strong, b").textContent(), "Важный фрагмент");
    await page.waitForTimeout(650);
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).journalEntries.some((entry) => entry.text === "**Важный фрагмент**")),
      true,
    );

    assert.deepEqual(pageErrors, []);
    console.log("e2e ok - occupied-time creation, unscheduled pointer drag, live resize, scroll preservation, and journal formatting");
  } finally {
    await electronApp.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
