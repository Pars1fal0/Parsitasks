const SESSION_KEY = "rhythm-supabase-session-v1";

function hasSession() {
  try {
    const session = JSON.parse(globalThis.localStorage?.getItem(SESSION_KEY) || "null");
    return Boolean(session?.access_token && session?.user?.id);
  } catch {
    return false;
  }
}

function route(path) {
  if (globalThis.location?.protocol !== "file:") return path;
  if (path.startsWith("/auth")) return `auth.html${path.includes("?") ? path.slice(path.indexOf("?")) : ""}`;
  if (path === "/app") return "index.html";
  return "landing.html";
}

function initialize() {
  const recoveryHash = String(globalThis.location?.hash || "");
  if (recoveryHash.includes("type=recovery") && recoveryHash.includes("access_token=")) {
    globalThis.location.replace(`${route("/auth")}${recoveryHash}`);
    return;
  }

  document.querySelectorAll("a[href^='/']").forEach((link) => {
    const url = new URL(link.href, globalThis.location.href);
    link.href = route(`${url.pathname}${url.search}`);
  });

  if (hasSession()) {
    document.querySelectorAll("[data-primary-cta]").forEach((link) => { link.href = route("/app"); });
  }
  initializeWorkflow();
  initializeMotion();
}

function initializeWorkflow() {
  const list = document.querySelector(".workflow-steps");
  if (!list) return;

  const steps = [...list.querySelectorAll("button")];
  const panels = steps.map((step) => document.getElementById(step.getAttribute("aria-controls")));
  const story = list.closest(".workflow-story");
  const select = (index, moveFocus = false) => {
    story.style.setProperty("--workflow-step", index);
    steps.forEach((step, position) => {
      const active = position === index;
      step.setAttribute("aria-selected", String(active));
      step.tabIndex = active ? 0 : -1;
      panels[position].hidden = !active;
    });
    if (moveFocus) steps[index].focus();
  };

  list.setAttribute("role", "tablist");
  list.setAttribute("aria-orientation", "horizontal");

  steps.forEach((step, index) => {
    step.setAttribute("role", "tab");
    panels[index].setAttribute("role", "tabpanel");
    panels[index].setAttribute("aria-labelledby", step.id);
    panels[index].tabIndex = 0;
    step.addEventListener("click", () => select(index));
    step.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % steps.length;
      else if (event.key === "ArrowLeft") next = (index + steps.length - 1) % steps.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = steps.length - 1;
      else return;
      event.preventDefault();
      select(next, true);
    });
  });
  select(0);
  story.classList.add("is-enhanced");
  list.hidden = false;
}

function initializeMotion() {
  const toggle = document.querySelector(".motion-toggle");
  const hero = document.querySelector(".hero");
  const reduce = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
  const fine = globalThis.matchMedia("(hover: hover) and (pointer: fine)");
  let paused = false;

  function resetArt() {
    hero.style.removeProperty("--art-x");
    hero.style.removeProperty("--art-y");
  }

  function syncMotion() {
    document.documentElement.classList.toggle("motion-paused", paused || reduce.matches);
    if (paused || reduce.matches || !fine.matches) resetArt();
    toggle.hidden = reduce.matches;
    const label = paused ? "Возобновить анимацию" : "Приостановить анимацию";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  }

  hero.addEventListener("pointermove", (event) => {
    if (paused || reduce.matches || !fine.matches || event.pointerType !== "mouse") return;
    const bounds = hero.getBoundingClientRect();
    hero.style.setProperty("--art-x", `${(event.clientX / bounds.width - .5) * 24}px`);
    hero.style.setProperty("--art-y", `${((event.clientY - bounds.top) / bounds.height - .5) * 17}px`);
  });
  hero.addEventListener("pointerleave", resetArt);
  toggle.addEventListener("click", () => { paused = !paused; syncMotion(); });
  reduce.addEventListener("change", syncMotion);
  fine.addEventListener("change", syncMotion);
  syncMotion();
}

initialize();
