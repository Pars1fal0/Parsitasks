async function enableAllSections(page) {
  await page.setViewportSize({ width: 1366, height: 900 });
  // Full-workspace scenarios explicitly opt into optional sections on every load.
  const configure = (force = false) => {
    const key = "rhythm-day-ui-v1";
    const ui = JSON.parse(localStorage.getItem(key) || "{}");
    if (force || !ui.navigationPreferences) {
      ui.navigationPreferences = { hidden: [], mobile: ["tasks", "timeline", "habits", "overview"] };
      localStorage.setItem(key, JSON.stringify(ui));
    }
    const observe = () => {
      if (window.fullWorkspaceSettingsObserver) return;
      const reveal = () => {
        if (document.body.dataset.view === "settings") document.querySelectorAll(".settings-primary-group").forEach((group) => { group.open = true; });
      };
      window.fullWorkspaceSettingsObserver = new MutationObserver(reveal);
      window.fullWorkspaceSettingsObserver.observe(document.body, { attributes: true, attributeFilter: ["data-view"] });
      reveal();
    };
    if (document.body) observe();
    else document.addEventListener("DOMContentLoaded", observe, { once: true });
  };
  await page.addInitScript(configure);
  await page.waitForSelector("#pageTitle");
  await page.waitForSelector(".nav-tabs > button.is-mobile-pin");
  await page.evaluate(configure, true);
  await page.reload();
  await page.waitForSelector("#pageTitle");
  await page.waitForSelector('.nav-tabs > button[data-view="study"]:visible');
}

async function navigate(page, view) {
  if (view === "timeline") {
    // The old route remains covered for existing links, but is no longer a tab.
    await page.evaluate(() => { location.hash = "timeline"; });
    await page.locator("#timelineView").waitFor({ state: "visible" });
    return;
  }
  const direct = page.locator(`.nav-tabs > [data-view="${view}"]:visible`);
  if (await direct.count()) await direct.click();
  else {
    const more = page.locator(".nav-more");
    if (!(await more.evaluate((node) => node.open))) await more.locator(":scope > summary").click();
    await more.locator(`[data-view="${view}"]`).click();
  }
}

module.exports = { enableAllSections, navigate };
