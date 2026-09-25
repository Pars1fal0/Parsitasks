const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({ args: [path.resolve(__dirname, ".."), "--e2e-test"], executablePath: require("electron") });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.waitForSelector("#pageTitle");
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      const now = new Date().toISOString();
      state.habits = [
        { id: "freeze-check", title: "Зарядка", type: "check", repeat: "daily", startDate: "2026-09-20", goal: 1, logs: { "2026-09-24": true }, createdAt: now, updatedAt: now },
        { id: "freeze-number", title: "Вода", type: "number", repeat: "daily", startDate: "2026-09-20", goal: 10, unit: "стаканов", logs: { "2026-09-25": 4 }, createdAt: now, updatedAt: now },
      ];
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(state));
    });
    await page.reload();
    await page.waitForSelector("#pageTitle");
    await page.locator('.nav-tab[data-view="habits"]:visible').click();
    await page.locator("#activeDate").fill("2026-09-25");
    await page.locator("#activeDate").dispatchEvent("change");
    await page.locator("#openHabitFreeze").click();
    await page.locator("#habitFreezeList input").first().check();
    await page.locator("#habitFreezeList input").last().check();
    await page.locator('input[name="habitFreezeMode"][value="period"]').check();
    await page.locator("#habitFreezeStart").fill("2026-09-24");
    await page.locator("#habitFreezeEnd").fill("2026-09-25");
    await page.locator("#habitFreezeReason").selectOption("Болезнь");
    await page.locator("#habitFreezeSubmit").click();
    assert.equal(await page.locator(".habit-item.is-frozen").count(), 2);
    assert.match(await page.locator("#appToast").textContent(), /выполненные дни пропущены: 1/);
    assert.equal(await page.locator("#habitDoneMetric").textContent(), "0/0");
    assert.equal(await page.locator("#habitFrozenMetric").textContent(), "Заморожено 2");
    assert.match(await page.locator(".habit-item[data-habit-id='freeze-number']").textContent(), /4 \/ 10/);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")).habits);
    assert.equal(saved.find((habit) => habit.id === "freeze-check").freezeDays["2026-09-24"], undefined);
    assert.equal(saved.find((habit) => habit.id === "freeze-number").freezeDays["2026-09-25"].reason, "Болезнь");
    await page.screenshot({ path: path.join(os.tmpdir(), "parsitasks-freeze-desktop.png") });
    await page.locator(".habit-item[data-habit-id='freeze-number'] .habit-frozen-row button").click();
    assert.equal(await page.locator(".habit-item.is-frozen").count(), 1);
    await page.locator("#appToast button").click();
    assert.equal(await page.locator(".habit-item.is-frozen").count(), 2);
    await page.locator(".habit-item[data-habit-id='freeze-number'] .habit-frozen-row button").click();
    await page.reload();
    await page.waitForSelector('body[data-view="habits"]');
    assert.equal(await page.locator(".habit-item.is-frozen").count(), 1);
    await page.locator(".habit-item[data-habit-id='freeze-check'] .habit-actions summary").click();
    await page.locator(".habit-item[data-habit-id='freeze-check'] .freeze-habit").click();
    assert.equal(await page.locator("#habitFreezeHeading").textContent(), "Снять заморозку");
    assert.equal(await page.locator("#habitFreezeCurrentReason").textContent(), "Причина: Болезнь");
    await page.locator('input[name="habitFreezeMode"][value="period"]').check();
    await page.locator("#habitFreezeStart").fill("2026-09-24");
    await page.locator("#habitFreezeEnd").fill("2026-09-25");
    await page.locator("#habitFreezeSubmit").click();
    assert.equal(await page.locator(".habit-item.is-frozen").count(), 0);
    await page.reload();
    await page.waitForSelector('body[data-view="habits"]');
    assert.equal(await page.locator(".habit-item.is-frozen").count(), 0);
    await page.setViewportSize({ width: 390, height: 780 });
    await page.locator("#openHabitFreeze").click();
    await page.locator("#habitFreezeReason").selectOption("custom");
    await page.locator("#habitFreezeCustomReason").fill("Форс-мажор");
    assert.equal(await page.locator("#habitFreezeCustomReasonField").isVisible(), true);
    const bounds = await page.locator("#habitFreezeDialog").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await page.screenshot({ path: path.join(os.tmpdir(), "parsitasks-freeze-mobile.png") });
    assert.deepEqual(errors, []);
    console.log("habit freeze e2e passed");
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
