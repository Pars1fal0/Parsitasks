(function (global) {
  const LABELS = { tasks: "Задачи", timeline: "Время", habits: "Привычки", goals: "Цели", overview: "Календарь", study: "Учёба", nutrition: "Питание", journal: "Заметки", board: "Доска", archive: "Архив", settings: "Настройки" };
  const DEFAULT_MOBILE = ["tasks", "habits", "overview"];
  const DEFAULT_HIDDEN = Object.keys(LABELS).filter((view) => !DEFAULT_MOBILE.includes(view) && view !== "settings");

  function normalize(value = {}) {
    value ||= {};
    const customized = Array.isArray(value.hidden) || Array.isArray(value.mobile);
    const hidden = [...new Set(Array.isArray(value.hidden) ? value.hidden : customized ? [] : DEFAULT_HIDDEN)].filter((view) => Object.hasOwn(LABELS, view) && view !== "settings");
    const mobile = [...new Set(Array.isArray(value.mobile) ? value.mobile : DEFAULT_MOBILE)]
      .filter((view) => Object.hasOwn(LABELS, view) && !hidden.includes(view)).slice(0, 4);
    if (!mobile.length) mobile.push(Object.keys(LABELS).find((view) => !hidden.includes(view)));
    return { hidden, mobile };
  }

  function createNavigationPreferences(ctx) {
    const nav = document.querySelector(".nav-tabs");
    const menu = nav.querySelector(".nav-more-menu");
    const direct = [...nav.querySelectorAll(":scope > button[data-view]")];
    direct.forEach((button) => {
      if (!menu.querySelector(`[data-view="${button.dataset.view}"]`)) menu.append(button.cloneNode(true));
      const span = button.querySelector("span");
      span.dataset.mobileLabel = LABELS[button.dataset.view];
      if (button.dataset.view === "habits") span.dataset.mobileLabel = "Привыч.";
      if (button.dataset.view === "overview") span.dataset.mobileLabel = "Кален.";
      button.dataset.mobileLabel = span.dataset.mobileLabel;
    });
    ctx.els.navTabs = nav.querySelectorAll(".nav-tab[data-view]");
    document.documentElement.classList.add("navigation-custom");
    const container = document.querySelector("#navigationPreferences");

    function apply() {
      const prefs = normalize(ctx.getPreferences());
      const primary = ["tasks", "habits", "overview", "study"];
      const pins = prefs.mobile.filter((view) => view !== "timeline");
      const hasMore = Object.keys(LABELS).some((view) => view !== "timeline" && !prefs.hidden.includes(view) && !pins.includes(view));
      nav.querySelector(".nav-more").hidden = !hasMore;
      nav.style.setProperty("--mobile-nav-count", pins.length + (hasMore ? 1 : 0));
      direct.forEach((button) => {
        const view = button.dataset.view;
        button.classList.toggle("is-section-hidden", prefs.hidden.includes(view) || view === "timeline");
        button.classList.toggle("is-secondary-section", !primary.includes(view));
        button.classList.toggle("is-mobile-pin", pins.includes(view));
        button.style.setProperty("--mobile-nav-order", pins.includes(view) ? pins.indexOf(view) : 10);
      });
      menu.querySelectorAll("[data-view]").forEach((button) => {
        const view = button.dataset.view;
        button.classList.toggle("is-section-hidden", prefs.hidden.includes(view) || view === "timeline");
        button.classList.toggle("is-desktop-direct", primary.includes(view));
        button.classList.toggle("is-mobile-direct", pins.includes(view));
      });
    }

    function renderControls() {
      const prefs = normalize(ctx.getPreferences());
      const focused = document.activeElement?.dataset.navigationKey;
      container.replaceChildren();
      const visibility = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = "Видимые разделы";
      visibility.append(legend);
      Object.entries(LABELS).filter(([view]) => !["settings", "timeline"].includes(view)).forEach(([view, label]) => {
        const row = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !prefs.hidden.includes(view);
        input.dataset.navigationKey = `visible-${view}`;
        input.addEventListener("change", () => ctx.updatePreferences(normalize({ ...prefs, hidden: input.checked ? prefs.hidden.filter((item) => item !== view) : [...prefs.hidden, view] })));
        row.append(input, document.createTextNode(label));
        visibility.append(row);
      });
      const pins = document.createElement("fieldset");
      const pinLegend = document.createElement("legend");
      pinLegend.textContent = "Нижняя панель";
      pins.append(pinLegend);
      for (let index = 0; index < 4; index += 1) {
        const label = document.createElement("label");
        label.append(document.createTextNode(`Место ${index + 1}`));
        const select = document.createElement("select");
        select.dataset.navigationKey = `pin-${index}`;
        select.add(new Option("Не выбрано", ""));
        Object.entries(LABELS).filter(([view]) => view !== "timeline" && !prefs.hidden.includes(view)).forEach(([view, title]) => {
          const option = new Option(title, view);
          option.disabled = prefs.mobile.includes(view) && prefs.mobile[index] !== view;
          select.add(option);
        });
        select.value = prefs.mobile[index] || "";
        select.addEventListener("change", () => {
          const mobile = [...prefs.mobile];
          mobile[index] = select.value;
          ctx.updatePreferences(normalize({ ...prefs, mobile: mobile.filter(Boolean) }));
        });
        label.append(select);
        pins.append(label);
      }
      container.append(visibility, pins);
      const basic = document.createElement("button");
      basic.type = "button";
      basic.className = "ghost-button";
      basic.textContent = "Только основные разделы";
      basic.title = "Задачи, привычки и календарь";
      basic.addEventListener("click", () => ctx.updatePreferences(normalize()));
      container.append(basic);
      if (focused) container.querySelector(`[data-navigation-key="${focused}"]`)?.focus();
    }

    return { apply, renderControls, isPinned: (view) => normalize(ctx.getPreferences()).mobile.includes(view) };
  }

  const api = { LABELS, normalize, createNavigationPreferences };
  global.RhythmNavigationPreferences = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
