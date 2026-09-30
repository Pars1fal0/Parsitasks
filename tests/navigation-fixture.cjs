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

module.exports = { enableAllSections };
