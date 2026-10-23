const assert = require("node:assert/strict");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({ args: [path.resolve(__dirname, ".."), "--e2e-test"], executablePath: require("electron") });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const formOpen = () => page.evaluate(() => !document.querySelector("#taskFormPanel").classList.contains("is-collapsed"));
  try {
    await page.waitForSelector("#pageTitle");
    await page.setViewportSize({ width: 1366, height: 860 });
    const date = await page.locator("#activeDate").inputValue();
    await page.evaluate((dateKey) => {
      const data = JSON.parse(localStorage.getItem("rhythm-day-state-v1"));
      data.tasks = [{ id: "bread", title: "Купить хлеб", date: dateKey, repeat: "none", completed: {},
        checklist: [{ id: "item", title: "Батон" }] }];
      localStorage.setItem("rhythm-day-state-v1", JSON.stringify(data));
    }, date);
    await page.reload();
    await page.waitForSelector(".task-item");

    await page.locator("#openTaskForm").click();
    assert.equal(await formOpen(), true);
    await page.locator("#taskTitle").press("Escape");
    assert.equal(await formOpen(), false, "Escape closes an empty task form");

    await page.locator("#openTaskForm").click();
    await page.locator("#taskTitle").fill("Черновик");
    await page.locator("#taskTitle").press("Escape");
    assert.equal(await page.locator("#taskTitle").inputValue(), "Черновик", "Escape never discards a draft without confirmation");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#taskTitle").inputValue(), "Черновик");
    await page.locator("#taskTitle").fill("");
    await page.locator("#taskTitle").press("Escape");
    assert.equal(await formOpen(), false);

    const task = page.locator(".task-item", { hasText: "Купить хлеб" });
    await task.locator(".task-checklist > summary").click();
    assert.equal(await formOpen(), false, "checklist controls keep their own behaviour");
    await task.locator("h3").click();
    assert.equal(await formOpen(), true, "clicking the task title opens its editor");
    assert.equal(await page.locator("#taskTitle").inputValue(), "Купить хлеб");
    await page.locator("#taskTitle").press("Escape");
    assert.equal(await formOpen(), false);

    assert.equal(await page.locator("#taskSelectMode span").isVisible(), true, "selection mode has a visible label");
    assert.deepEqual(errors, []);
    console.log("task shortcuts e2e ok");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
