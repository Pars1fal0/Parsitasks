// Pomodoro-style focus sessions. Timer state is a per-device convenience, so it lives in
// localStorage rather than in the synced workspace state.

const STORAGE_KEY = "rhythm-focus-timer-v1";
const FOCUS_MINUTES = 25;
const BREAK_MINUTES = 5;
const SESSION_HISTORY_DAYS = 14;

function createFocusTimer(ctx) {
  const now = () => (ctx.now?.() || new Date()).getTime();
  const baseTitle = document.title;
  let data = load();
  let ticker = null;
  let pill = null;

  function load() {
    try {
      const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || "null");
      if (parsed && typeof parsed === "object") {
        return {
          endsAt: Number(parsed.endsAt) || 0,
          mode: ["focus", "break"].includes(parsed.mode) ? parsed.mode : "",
          sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
        };
      }
    } catch {}
    return { endsAt: 0, mode: "", sessions: {} };
  }

  function persist() {
    const keys = Object.keys(data.sessions).sort().slice(-SESSION_HISTORY_DAYS);
    data.sessions = Object.fromEntries(keys.map((key) => [key, data.sessions[key]]));
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }

  function bindEvents() {
    document.querySelectorAll("[data-focus-start]").forEach((button) => button.addEventListener("click", () => start("focus")));
    if (data.mode) {
      // Catch up on whatever finished while the app was closed, without replaying alerts.
      while (data.mode && data.endsAt <= now()) finish({ silent: true });
      if (data.mode) startTicker();
    }
    render();
  }

  function start(mode) {
    data.mode = mode;
    data.endsAt = now() + (mode === "focus" ? FOCUS_MINUTES : BREAK_MINUTES) * 60000;
    persist();
    startTicker();
    render();
    if (mode === "focus") ctx.showToast?.(`Фокус на ${FOCUS_MINUTES} минут. Убери отвлечения`);
  }

  function stop() {
    data.mode = "";
    data.endsAt = 0;
    persist();
    stopTicker();
    render();
  }

  function finish({ silent = false } = {}) {
    if (data.mode === "focus") {
      const today = ctx.todayKey();
      data.sessions[today] = (Number(data.sessions[today]) || 0) + 1;
      const count = data.sessions[today];
      data.mode = "break";
      data.endsAt += BREAK_MINUTES * 60000;
      if (!silent) announce(`Фокус-сессия завершена · сегодня ${count}. Перерыв ${BREAK_MINUTES} минут`);
    } else {
      data.mode = "";
      data.endsAt = 0;
      if (!silent) announce("Перерыв окончен. Готов к следующей сессии?", { label: "Ещё фокус", onClick: () => start("focus") });
    }
    persist();
  }

  function announce(message, action) {
    ctx.showToast?.(message, action ? { action } : {});
    if (!document.hidden || !ctx.notificationsEnabled?.()) return;
    try {
      if (globalThis.Notification?.permission === "granted") new Notification("Parsitasks", { body: message, icon: "assets/icons/icon-192.png", tag: "focus-timer" });
    } catch {}
  }

  function tick() {
    if (!data.mode) return stopTicker();
    if (data.endsAt <= now()) {
      finish();
      if (!data.mode) stopTicker();
    }
    render();
  }

  function startTicker() {
    if (!ticker) ticker = setInterval(tick, 1000);
  }

  function stopTicker() {
    clearInterval(ticker);
    ticker = null;
  }

  function ensurePill() {
    if (pill) return pill;
    pill = document.createElement("div");
    pill.className = "focus-timer";
    pill.setAttribute("role", "timer");
    pill.setAttribute("aria-live", "off");
    const mode = document.createElement("span");
    const clock = document.createElement("strong");
    const stopButton = document.createElement("button");
    mode.className = "focus-timer-mode";
    clock.className = "focus-timer-clock";
    stopButton.type = "button";
    stopButton.className = "focus-timer-stop";
    stopButton.addEventListener("click", stop);
    pill.append(mode, clock, stopButton);
    document.body.appendChild(pill);
    return pill;
  }

  function render() {
    const running = Boolean(data.mode);
    const count = Number(data.sessions[ctx.todayKey()]) || 0;
    document.querySelectorAll("[data-focus-start]").forEach((button) => {
      button.hidden = running;
      const counter = button.querySelector("[data-focus-count]");
      if (counter) counter.textContent = count ? `· ${count}` : "";
      button.title = count ? `Сессий фокуса сегодня: ${count}` : `Сессия фокуса на ${FOCUS_MINUTES} минут`;
    });
    if (!running) {
      if (pill) pill.hidden = true;
      document.title = baseTitle;
      return;
    }
    const node = ensurePill();
    const remaining = formatRemaining(data.endsAt - now());
    node.hidden = false;
    node.classList.toggle("is-break", data.mode === "break");
    node.querySelector(".focus-timer-mode").textContent = data.mode === "focus" ? "Фокус" : "Перерыв";
    node.querySelector(".focus-timer-clock").textContent = remaining;
    const stopButton = node.querySelector(".focus-timer-stop");
    stopButton.textContent = data.mode === "focus" ? "Стоп" : "Пропустить";
    stopButton.setAttribute("aria-label", data.mode === "focus" ? "Остановить фокус-сессию" : "Пропустить перерыв");
    document.title = `${remaining} · ${data.mode === "focus" ? "Фокус" : "Перерыв"} — ${baseTitle}`;
  }

  return { bindEvents, start, stop, getState: () => ({ ...data }) };
}

function formatRemaining(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

const api = { createFocusTimer, formatRemaining, BREAK_MINUTES, FOCUS_MINUTES };

export { createFocusTimer, formatRemaining, BREAK_MINUTES, FOCUS_MINUTES };
export default api;
