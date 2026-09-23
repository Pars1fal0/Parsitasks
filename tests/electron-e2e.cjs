const assert = require("node:assert/strict");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const electronApp = await electron.launch({
    args: [path.resolve(__dirname, ".."), "--e2e-test"],
    executablePath: require("electron"),
  });
  const page = await electronApp.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.waitForSelector("#pageTitle");
    assert.equal(await page.locator("#archivePeriodFilter").evaluate((node) => node.closest(".view")?.id), "archiveView");
    assert.equal(await page.locator("#categoryForm").evaluate((node) => node.closest(".view")?.id), "settingsView");

    await page.locator('.nav-tab[data-view="overview"]:visible').click();
    assert.equal(await page.evaluate(() => window.location.hash), "#calendar/week");
    await page.reload();
    await page.waitForSelector('body[data-view="overview"]');
    assert.equal(await page.locator("#pageTitle").textContent(), "Календарь");
    await page.locator('[data-overview-mode="month"]').click();
    assert.equal(await page.evaluate(() => window.location.hash), "#calendar/month");
    assert.equal(await page.locator("#overviewHeading").textContent(), "Обзор месяца");
    assert.match(await page.locator("#weeklyTaskText").textContent(), /за месяц/);
    await page.reload();
    await page.waitForSelector('body[data-view="overview"]');
    assert.equal(await page.locator("#overviewHeading").textContent(), "Обзор месяца");
    assert.equal(
      await page.locator('[data-overview-mode="month"]').evaluate((node) => node.classList.contains("is-active")),
      true,
    );
    await page.locator("#activeDate").fill("2026-07-20");
    await page.locator("#activeDate").dispatchEvent("change");
    await page.reload();
    await page.waitForSelector('body[data-view="overview"]');
    assert.equal(await page.locator("#activeDate").inputValue(), "2026-07-20");

    await page.locator('.nav-tab[data-view="journal"]:visible').click();
    assert.equal(await page.evaluate(() => window.location.hash), "#journal");
    await page.locator("#journalText").fill("Сегодня проверил дневник дня.\n\nЗапись сохранилась.");
    await page.waitForTimeout(650);
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).journalEntries[0].date),
      "2026-07-20",
    );
    await page.reload();
    await page.waitForSelector('body[data-view="journal"]');
    assert.match(await page.locator("#journalText").textContent(), /Запись сохранилась/);

    assert.equal(await page.locator(".journal-calendar-day").count(), 42);
    await page.locator("#journalSearch").evaluate((node) => node.closest("details")?.querySelector("summary")?.click());
    await page.locator("#journalSearch").fill("дневник");
    assert.equal(await page.locator(".journal-search-result").count(), 1);
    await page.locator("#globalSearchButton").click();
    await page.locator("#globalSearchInput").fill("дневник");
    assert.equal(await page.locator(".global-search-result").count(), 1);
    await page.locator("#globalSearchInput").press("Enter");
    assert.equal(await page.evaluate(() => window.location.hash), "#journal");

    await page.locator('.nav-tab[data-view="nutrition"]:visible').click();
    assert.equal(await page.evaluate(() => window.location.hash), "#nutrition");
    assert.equal(await page.locator(".nutrition-day-column").count(), 7);
    await page.locator("#nutritionAddMeal").click();
    await page.locator("#nutritionMealTitle").fill("Тестовый обед");
    await page.locator("#nutritionMealDate").fill("2026-07-20");
    await page.locator("#nutritionMealType").selectOption("lunch");
    await page.locator("#nutritionMealIngredients").fill("Рис | 100 | г");
    await page.locator("#nutritionMealCalories").fill("350");
    await page.locator("#nutritionMealForm button[type=submit]").click();
    assert.equal(await page.locator(".nutrition-meal-card").count(), 1);
    assert.match(await page.locator(".nutrition-meal-card").textContent(), /Тестовый обед/);
    await page.reload();
    await page.waitForSelector('body[data-view="nutrition"]');
    assert.equal(await page.locator(".nutrition-meal-card").count(), 1);

    await page.locator('.nav-tab[data-view="board"]:visible').click();
    assert.equal(await page.evaluate(() => window.location.hash), "#board");
    await page.locator("#boardAddText").click();
    await page.locator(".board-text-content").fill("Удаляемый объект");
    await page.keyboard.press("Escape");
    await page.locator(".board-text-content").click();
    await page.keyboard.press("Delete");
    assert.equal(await page.locator(".board-item").count(), 0);
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).boardItems.length),
      0,
    );

    await page.locator("#boardAddText").click();
    await page.locator(".board-text-content").fill("Идея для проверки");
    await page.keyboard.press("Escape");
    await page.locator("#boardFontSize").fill("88");
    await page.locator("#boardFontSize").dispatchEvent("change");
    await page.locator("#boardBold").click();
    await page.locator(".board-text-content").dblclick();
    assert.notEqual(await page.locator(".board-text-content").getAttribute("contenteditable"), "false");
    await page.locator(".board-text-content").fill("Отредактированная идея");
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(() => {
        const item = JSON.parse(localStorage.getItem("rhythm-day-state-v1")).boardItems[0];
        return item.text === "Отредактированная идея"
          && item.fontSize === 88
          && item.fontWeight === 700
          && item.height > 140;
      }),
      true,
    );
    await page.locator("#boardAddText").click();
    await page.locator(".board-text-content").last().fill("Второй объект");
    await page.keyboard.press("Escape");
    const boardBox = await page.locator("#boardViewport").boundingBox();
    const itemBoxes = await page.locator(".board-item").evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect();
        return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
      }));
    const marquee = {
      left: Math.max(boardBox.x + 2, Math.min(...itemBoxes.map((box) => box.left)) - 10),
      top: Math.max(boardBox.y + 2, Math.min(...itemBoxes.map((box) => box.top)) - 10),
      right: Math.min(boardBox.x + boardBox.width - 2, Math.max(...itemBoxes.map((box) => box.right)) + 10),
      bottom: Math.min(boardBox.y + boardBox.height - 2, Math.max(...itemBoxes.map((box) => box.bottom)) + 10),
    };
    await page.mouse.move(marquee.right, marquee.bottom);
    await page.mouse.down();
    await page.mouse.move(marquee.left, marquee.top, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.locator(".board-item.is-selected").count(), 2);
    await page.locator('[data-board-text-color="#397ee8"]').click();
    assert.equal(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("rhythm-day-state-v1")).boardItems
          .every((item) => item.type !== "text" || item.color === "#397ee8")),
      true,
    );
    await page.keyboard.press("Delete");
    assert.equal(await page.locator(".board-item").count(), 0);
    await page.locator("#boardUndo").click();
    assert.equal(await page.locator(".board-item").count(), 2);
    await page.locator(".board-item").first().click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("Control+d");
    assert.equal(await page.locator(".board-item").count(), 3);
    const duplicatedBoardItemId = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("rhythm-day-state-v1")).boardItems.at(-1).id);
    await page.keyboard.press("Control+z");
    assert.equal(await page.locator(".board-item").count(), 2);
    assert.equal(
      await page.evaluate((id) =>
        typeof JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tombstones.boardItems[id] === "string",
      duplicatedBoardItemId),
      true,
    );
    await page.keyboard.press("Control+Shift+z");
    assert.equal(await page.locator(".board-item").count(), 3);
    assert.equal(
      await page.evaluate((id) =>
        Object.hasOwn(JSON.parse(localStorage.getItem("rhythm-day-state-v1")).tombstones.boardItems, id),
      duplicatedBoardItemId),
      false,
    );
    await page.locator(".board-item").first().click({ position: { x: 4, y: 4 } });
    await page.locator(".board-item").nth(1).dispatchEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 701,
      shiftKey: true,
    });
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 701 }));
    });
    assert.equal(await page.locator(".board-item.is-selected").count(), 2);
    await page.locator("#boardGroup").click();
    assert.equal(
      await page.evaluate(() => {
        const grouped = JSON.parse(localStorage.getItem("rhythm-day-state-v1")).boardItems.filter((item) => item.groupId);
        return grouped.length === 2 && grouped[0].groupId === grouped[1].groupId;
      }),
      true,
    );
    assert.equal(await page.locator(".board-item.is-selected").count(), 2);
    const groupedWidthsBefore = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("rhythm-day-state-v1")).boardItems.filter((item) => item.groupId).map((item) => item.width));
    await page.locator("#boardFocus").click();
    const groupResizeHandle = await page.locator(".board-multi-bounds .board-resize-handle.is-sw").boundingBox();
    await page.mouse.move(groupResizeHandle.x + groupResizeHandle.width / 2, groupResizeHandle.y + groupResizeHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(groupResizeHandle.x - 84, groupResizeHandle.y + 20, { steps: 6 });
    await page.mouse.up();
    assert.equal(
      await page.evaluate((before) => {
        const widths = JSON.parse(localStorage.getItem("rhythm-day-state-v1")).boardItems
          .filter((item) => item.groupId)
          .map((item) => item.width);
        return widths.every((width, index) => width > before[index]);
      }, groupedWidthsBefore),
      true,
    );
    await page.locator("#boardLock").click();
    assert.equal(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("rhythm-day-state-v1")).boardItems.filter((item) => item.groupId).every((item) => item.locked)),
      true,
    );
    await page.locator("#boardLock").click();
    await page.locator("#boardSendBack").click();
    assert.deepEqual(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("rhythm-day-state-v1")).boardItems.filter((item) => item.groupId).map((item) => item.z)),
      [0, 1],
    );
    await page.locator("#boardBringFront").click();
    assert.deepEqual(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("rhythm-day-state-v1")).boardItems.filter((item) => item.groupId).map((item) => item.z)),
      [1, 2],
    );
    await page.locator("#boardModePan").click();
    assert.equal(await page.locator("#boardViewport").getAttribute("data-mode"), "pan");
    await page.locator("#boardModeSelect").click();
    assert.equal(await page.locator("#boardViewport").getAttribute("data-mode"), "select");
    await page.locator("#boardAddFrame").click();
    await page.locator(".board-frame-title").fill("План запуска");
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(() => {
        const frame = JSON.parse(localStorage.getItem("rhythm-day-state-v1")).boardItems.find((item) => item.type === "frame");
        return frame?.text === "План запуска" && frame.width >= 360 && frame.height >= 240;
      }),
      true,
    );
    assert.equal(await page.locator(".board-item-handle").count(), 0);
    assert.equal(await page.locator(".board-item-delete").count(), 0);
    await page.locator("#boardImageInput").setInputFiles(path.resolve(__dirname, "..", "app", "assets", "icons", "icon-192.png"));
    await page.waitForFunction(() => /Supabase|синхронизац/i.test(document.querySelector("#boardStatus")?.textContent || ""));
    assert.equal(await page.locator(".board-image").count(), 0);
    await page.evaluate(async () => {
      const assetId = "e2e-cached-board-image";
      const blob = await fetch("assets/icons/icon-192.png").then((response) => response.blob());
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("rhythm-board-assets-v1", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("assets")) {
            request.result.createObjectStore("assets", { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("assets", "readwrite");
        transaction.objectStore("assets").put({
          id: assetId,
          blob,
          mime: "image/png",
          name: "icon-192.png",
          updatedAt: new Date().toISOString(),
        });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      const now = new Date().toISOString();
      state.boardItems.push(window.RhythmBoardModel.createImageItem({
        assetId,
        height: 192,
        mime: "image/png",
        name: "icon-192.png",
        remotePath: "test-user/e2e-cached-board-image.png",
        width: 192,
        x: 30,
        y: 30,
        z: 20,
      }, { createId: () => "e2e-image-item", now }));
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
    });
    await page.reload();
    await page.waitForSelector('body[data-view="board"]');
    await page.waitForFunction(() => {
      const image = document.querySelector(".board-image-content");
      return image?.complete && image.naturalWidth > 0;
    });
    assert.equal(await page.locator(".board-image-placeholder").getAttribute("hidden"), "");
    await page.mouse.move(boardBox.x + boardBox.width / 2, boardBox.y + boardBox.height / 2);
    await page.mouse.wheel(0, 10000);
    await page.waitForTimeout(80);
    assert.match(await page.locator("#boardZoomLabel").textContent(), /^2(?:\.0)?%$/);

    await page.locator('.nav-tab[data-view="settings"]:visible').click();
    assert.equal(await page.evaluate(() => window.location.hash), "#settings");
    assert.equal(await page.locator(".settings-accordion").first().getAttribute("open"), null);
    assert.equal(await page.locator("#remoteSyncPushButton").isDisabled(), true);
    assert.equal(await page.locator("#remoteSyncPullButton").isDisabled(), true);
    await page.locator(".settings-accordion").first().locator("summary").click();
    await page.locator('.accent-option:has(input[value="blue"])').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), "blue");
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-ui-v1")).accentPreference),
      "blue",
    );
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--teal").trim()),
      "#5aa7ff",
    );
    await page.locator("#timeZoneSetting").fill("Asia/Yekaterinburg");
    await page.locator("#timeZoneSetting").dispatchEvent("change");
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).profile.timeZone),
      "Asia/Yekaterinburg",
    );
    await page.locator("#mcpJournalRead").evaluate((node) => node.closest("details")?.querySelector("summary")?.click());
    await page.locator("#mcpJournalRead").selectOption("off");
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).profile.journalAccess.read),
      false,
    );
    await page.evaluate(() => {
      window.__verificationResult = null;
      window.confirmAction({
        confirmLabel: "Delete",
        title: "Verification test",
        verificationLabel: "Enter email",
        verificationText: "owner@example.com",
      }).then((value) => {
        window.__verificationResult = value;
      });
    });
    assert.equal(await page.locator("#confirmVerification").isVisible(), true);
    assert.equal(await page.locator("#confirmAccept").isDisabled(), true);
    await page.locator("#confirmVerificationInput").fill("OWNER@example.com");
    assert.equal(await page.locator("#confirmAccept").isDisabled(), false);
    await page.locator("#confirmAccept").click();
    assert.equal(await page.evaluate(() => window.__verificationResult), true);

    await page.setViewportSize({ height: 780, width: 390 });
    await page.waitForFunction(() => [
      ".task-filter-disclosure",
      ".quick-task-disclosure",
      ".timeline-unscheduled-panel",
    ].every((selector) => !document.querySelector(selector)?.hasAttribute("open")));
    assert.equal(await page.locator(".task-filter-disclosure").getAttribute("open"), null);
    assert.equal(await page.locator(".quick-task-disclosure").getAttribute("open"), null);
    assert.equal(await page.locator(".timeline-unscheduled-panel").getAttribute("open"), null);

    await page.locator(".nav-more-summary").click();
    await page.locator('.nav-more-menu .nav-tab[data-view="board"]').click();
    await page.waitForTimeout(100);
    const boardContentVisible = await page.locator(".board-item").first().evaluate((node) => {
      const item = node.getBoundingClientRect();
      const viewport = document.querySelector("#boardViewport").getBoundingClientRect();
      return item.right > viewport.left && item.left < viewport.right && item.bottom > viewport.top && item.top < viewport.bottom;
    });
    assert.equal(boardContentVisible, true, "board content must stay in view after a mobile resize");
    await page.locator(".nav-more-summary").click();
    await page.locator('.nav-more-menu .nav-tab[data-view="archive"]').click();
    const archiveToolbarFits = await page.locator(".archive-toolbar").evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
    assert.equal(archiveToolbarFits, true, "archive filters must fit the mobile viewport");

    await page.locator('.nav-tab[data-view="overview"]:visible').click();
    await page.locator('[data-overview-mode="week"]').click();
    assert.equal(await page.locator(".focus-board").evaluate((node) => getComputedStyle(node).display), "none");
    assert.equal(
      await page.locator("#overviewView .metric-panel").first().evaluate((node) => getComputedStyle(node).display),
      "none",
      "summary metrics must not push the selected calendar period below the fold on mobile",
    );
    await page.locator("#updateBanner").evaluate((node) => { node.hidden = false; });
    const updateBox = await page.locator("#updateBanner").boundingBox();
    assert.ok(updateBox && updateBox.x >= 0 && updateBox.x + updateBox.width <= 390.5, "update banner must fit mobile");
    await page.locator("#updateBanner").evaluate((node) => { node.hidden = true; });

    await page.locator('.nav-tab[data-view="habits"]:visible').click();
    await page.locator("#openHabitForm").click();
    const formBox = await page.locator("#habitFormPanel").boundingBox();
    assert.ok(formBox, "habit form should be visible");
    assert.ok(formBox.x >= 0 && formBox.x + formBox.width <= 390.5, "habit form must fit the mobile viewport");
    assert.equal(await page.locator("#habitFormPanel").getAttribute("role"), "dialog");
    assert.equal(await page.locator("#habitFormPanel").getAttribute("aria-modal"), "true");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#habitFormPanel").getAttribute("role"), null);

    for (const width of [320, 360]) {
      await page.setViewportSize({ height: 720, width });
      const bodyFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      assert.equal(bodyFits, true, `page must not overflow at ${width}px`);
      const navigationBox = await page.locator(".nav-tabs").boundingBox();
      assert.ok(
        navigationBox && navigationBox.x >= 0 && navigationBox.x + navigationBox.width <= width + 0.5,
        `navigation must fit ${width}px`,
      );
      const mobileLabels = await page.locator(".nav-tabs > .nav-tab[data-mobile-label] span").evaluateAll((nodes) =>
        nodes.map((node) => getComputedStyle(node, "::after").content.replaceAll('"', "")),
      );
      assert.deepEqual(mobileLabels, ["Задачи", "Время", "Привыч.", "Кален."]);
    }

    await page.locator('.nav-tab[data-view="tasks"]:visible').click();
    await page.locator("#openTaskForm").click();
    const scheduleModesFit = await page.locator(".schedule-mode-control").evaluate((node) =>
      node.scrollWidth <= node.clientWidth + 1,
    );
    assert.equal(scheduleModesFit, true, "task schedule modes must fit 320px without horizontal scrolling");
    await page.keyboard.press("Escape");

    await page.setViewportSize({ height: 780, width: 390 });
    await page.locator('.nav-tab[data-view="timeline"]:visible').click();
    assert.equal(await page.locator(".timeline-hour-slot").count(), 24);
    assert.equal(await page.locator(".timeline-hour-slot").first().getAttribute("data-hour"), "0");
    assert.equal(await page.locator(".timeline-hour-slot").last().getAttribute("data-hour"), "23");
    await page.locator('[data-timeline-scale="compact"]').click();
    const compactHeight = await page.locator(".timeline-hour-slot").first().evaluate((node) => node.getBoundingClientRect().height);
    await page.locator('[data-timeline-scale="large"]').click();
    const largeHeight = await page.locator(".timeline-hour-slot").first().evaluate((node) => node.getBoundingClientRect().height);
    assert.ok(largeHeight > compactHeight, "large timeline scale should increase the touch target");
    assert.equal(await page.locator('[data-timeline-scale="large"]').getAttribute("aria-pressed"), "true");
    await page.goBack();
    await page.waitForSelector('body[data-view="tasks"]');
    assert.equal(await page.evaluate(() => window.location.hash), "#tasks");

    await page.locator('.nav-tab[data-view="tasks"]:visible').click();
    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      window.__restoreStorageSetItem = () => { Storage.prototype.setItem = originalSetItem; };
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === "rhythm-day-state-v1") throw new DOMException("Quota exceeded", "QuotaExceededError");
        return originalSetItem.call(this, key, value);
      };
    });
    await page.locator(".quick-task-disclosure").evaluate((node) => { node.open = true; });
    await page.locator("#quickTaskInput").fill("Проверить сохранение");
    await page.locator("#quickTaskForm").evaluate((form) => form.requestSubmit());
    assert.match(await page.locator("#saveStatus").textContent(), /хранилище заполнено/i);
    assert.equal(await page.locator(".task-item").filter({ hasText: "Проверить сохранение" }).count(), 1);
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-ui-v1") || "{}").remoteSyncPending),
      true,
      "a failed local write must still queue the in-memory change for cloud sync",
    );
    await page.evaluate(() => window.__restoreStorageSetItem?.());
    assert.deepEqual(pageErrors, []);

    console.log("e2e ok - journal, archive, calendar periods, sync states, mobile dialogs, timeline scale, and quota recovery");
  } finally {
    await electronApp.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
