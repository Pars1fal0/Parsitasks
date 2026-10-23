// Pomodoro-style focus sessions. Timer state is a per-device convenience, so it lives in
// localStorage rather than in the synced workspace state.

const STORAGE_KEY = "rhythm-focus-timer-v1";
const FOCUS_PRESETS = [15, 25, 50];
const DEFAULT_FOCUS_MINUTES = 25;
const LONG_BREAK_MINUTES = 15;
const SESSIONS_BEFORE_LONG_BREAK = 4;
const EXTEND_MINUTES = 5;
// Stopping a session this early is treated as a false start and leaves no trace in the stats.
const MIN_COUNTED_MINUTES = 1;
const SESSION_HISTORY_DAYS = 14;

function breakMinutes(focusMinutes, long) {
  if (long) return LONG_BREAK_MINUTES;
  return focusMinutes >= 45 ? 10 : 5;
}

function createFocusTimer(ctx) {
  const now = () => (ctx.now?.() || new Date()).getTime();
  const baseTitle = document.title;
  let data = load();
  let ticker = null;
  let pill = null;
  let setup = null;
  let audio = null;

  function load() {
    const blank = { cycle: 0, endsAt: 0, focusMinutes: DEFAULT_FOCUS_MINUTES, minutes: {}, mode: "", pausedLeft: 0, sessions: {}, sound: true, taskId: "", taskTitle: "", total: 0 };
    try {
      const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || "null");
      if (parsed && typeof parsed === "object") {
        const mode = ["focus", "break"].includes(parsed.mode) ? parsed.mode : "";
        return {
          ...blank,
          cycle: Math.max(0, Number(parsed.cycle) || 0),
          endsAt: mode ? Number(parsed.endsAt) || 0 : 0,
          focusMinutes: FOCUS_PRESETS.includes(Number(parsed.focusMinutes)) ? Number(parsed.focusMinutes) : DEFAULT_FOCUS_MINUTES,
          minutes: parsed.minutes && typeof parsed.minutes === "object" ? parsed.minutes : {},
          mode,
          pausedLeft: mode ? Math.max(0, Number(parsed.pausedLeft) || 0) : 0,
          sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
          sound: parsed.sound !== false,
          taskId: typeof parsed.taskId === "string" ? parsed.taskId : "",
          taskTitle: typeof parsed.taskTitle === "string" ? parsed.taskTitle : "",
          total: Number(parsed.total) || 0,
        };
      }
    } catch {}
    return blank;
  }

  function persist() {
    ["sessions", "minutes"].forEach((field) => {
      const keys = Object.keys(data[field]).sort().slice(-SESSION_HISTORY_DAYS);
      data[field] = Object.fromEntries(keys.map((key) => [key, data[field][key]]));
    });
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }

  function bindEvents() {
    document.querySelectorAll("[data-focus-start]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (setup && !setup.hidden) closeSetup();
      else openSetup(button);
    }));
    document.addEventListener("click", (event) => {
      if (setup && !setup.hidden && !setup.contains(event.target)) closeSetup();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && setup && !setup.hidden) {
        event.stopPropagation();
        closeSetup({ restoreFocus: true });
      }
    }, true);
    if (data.mode && !data.pausedLeft) {
      // Catch up on whatever finished while the app was closed, without replaying alerts.
      while (data.mode && data.endsAt <= now()) finish({ silent: true });
      if (data.mode) startTicker();
    }
    render();
  }

  function remaining() {
    if (!data.mode) return 0;
    return data.pausedLeft || Math.max(0, data.endsAt - now());
  }

  function start(mode, options = {}) {
    stopTicker();
    const minutes = mode === "focus" ? data.focusMinutes : breakMinutes(data.focusMinutes, options.long);
    data.mode = mode;
    data.total = minutes * 60000;
    data.endsAt = now() + data.total;
    data.pausedLeft = 0;
    persist();
    startTicker();
    render();
  }

  function startFocus({ minutes = data.focusMinutes, taskId = data.taskId } = {}) {
    data.focusMinutes = FOCUS_PRESETS.includes(minutes) ? minutes : DEFAULT_FOCUS_MINUTES;
    const task = taskId ? ctx.getOpenTasks?.().find((item) => item.id === taskId) : null;
    data.taskId = task?.id || "";
    data.taskTitle = task?.title || "";
    unlockAudio();
    start("focus");
    ctx.showToast?.(data.taskTitle ? `Фокус ${data.focusMinutes} мин: ${data.taskTitle}` : `Фокус на ${data.focusMinutes} минут. Убери отвлечения`);
  }

  // Picking a task mid-session relinks it instead of throwing away the time already focused.
  function focusOn(taskId) {
    if (data.mode !== "focus") return startFocus({ taskId });
    const task = ctx.getOpenTasks?.().find((item) => item.id === taskId);
    if (!task) return;
    data.taskId = task.id;
    data.taskTitle = task.title;
    persist();
    render();
    ctx.showToast?.(`Текущая сессия теперь про «${task.title}»`);
  }

  function togglePause() {
    if (!data.mode) return;
    if (data.pausedLeft) {
      data.endsAt = now() + data.pausedLeft;
      data.pausedLeft = 0;
      startTicker();
    } else {
      data.pausedLeft = Math.max(1000, data.endsAt - now());
      data.endsAt = 0;
      stopTicker();
    }
    persist();
    render();
  }

  function extend() {
    if (data.mode !== "focus") return;
    const extra = EXTEND_MINUTES * 60000;
    if (data.pausedLeft) data.pausedLeft += extra;
    else data.endsAt += extra;
    data.total += extra;
    persist();
    render();
  }

  function stop() {
    if (data.mode === "focus") {
      const spent = Math.floor((data.total - remaining()) / 60000);
      if (spent >= MIN_COUNTED_MINUTES) {
        addMinutes(spent);
        ctx.showToast?.(`Сессия остановлена · учтено ${spent} мин`);
      }
    }
    data.mode = "";
    data.endsAt = 0;
    data.pausedLeft = 0;
    data.cycle = 0;
    persist();
    stopTicker();
    render();
  }

  function addMinutes(amount) {
    const today = ctx.todayKey();
    data.minutes[today] = (Number(data.minutes[today]) || 0) + amount;
  }

  function finish({ silent = false } = {}) {
    if (data.mode === "focus") {
      const today = ctx.todayKey();
      data.sessions[today] = (Number(data.sessions[today]) || 0) + 1;
      addMinutes(Math.round(data.total / 60000));
      data.cycle += 1;
      const long = data.cycle >= SESSIONS_BEFORE_LONG_BREAK;
      if (long) data.cycle = 0;
      const focusEnd = data.endsAt;
      const count = data.sessions[today];
      start("break", { long });
      // Breaks run from the moment the focus ended, so a reopened app shows the real time left.
      data.endsAt = focusEnd + data.total;
      persist();
      if (!silent) {
        const pause = `${long ? "Длинный перерыв" : "Перерыв"} ${Math.round(data.total / 60000)} мин`;
        const taskStillOpen = data.taskId && ctx.getOpenTasks?.().some((item) => item.id === data.taskId);
        announce(`Сессия завершена · сегодня ${count}. ${pause}`, taskStillOpen ? { label: "Задача готова", onClick: completeLinkedTask } : null);
      }
    } else {
      data.mode = "";
      data.endsAt = 0;
      data.pausedLeft = 0;
      persist();
      if (!silent) announce("Перерыв окончен. Продолжим?", { label: "Ещё фокус", onClick: () => startFocus() });
    }
  }

  function completeLinkedTask() {
    const taskId = data.taskId;
    data.taskId = "";
    data.taskTitle = "";
    persist();
    render();
    ctx.completeTask?.(taskId);
  }

  function announce(message, action) {
    ctx.showToast?.(message, action ? { action } : {});
    if (data.sound) chime();
    if (!document.hidden || !ctx.notificationsEnabled?.()) return;
    try {
      if (globalThis.Notification?.permission === "granted") new Notification("Parsitasks", { body: message, icon: "assets/icons/icon-192.png", tag: "focus-timer" });
    } catch {}
  }

  // Browsers only let audio start after a gesture, so the context is created on the start click.
  function unlockAudio() {
    if (!data.sound || audio) return;
    try {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (AudioContext) audio = new AudioContext();
    } catch {}
  }

  function chime() {
    if (!audio) return;
    try {
      audio.resume?.();
      [660, 880].forEach((frequency, index) => {
        const at = audio.currentTime + index * 0.18;
        const tone = audio.createOscillator();
        const gain = audio.createGain();
        tone.type = "sine";
        tone.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
        tone.connect(gain).connect(audio.destination);
        tone.start(at);
        tone.stop(at + 0.55);
      });
    } catch {}
  }

  function tick() {
    if (!data.mode || data.pausedLeft) return stopTicker();
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

  function todayStats() {
    const today = ctx.todayKey();
    return { count: Number(data.sessions[today]) || 0, minutes: Number(data.minutes[today]) || 0 };
  }

  function openSetup(anchor) {
    const panel = ensureSetup();
    panel.querySelectorAll("[data-focus-preset]").forEach((option) => {
      const active = Number(option.dataset.focusPreset) === data.focusMinutes;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-checked", String(active));
      option.tabIndex = active ? 0 : -1;
    });
    const select = panel.querySelector("select");
    const tasks = ctx.getOpenTasks?.() || [];
    const none = document.createElement("option");
    none.value = "";
    none.textContent = tasks.length ? "Без задачи" : "Открытых задач на сегодня нет";
    select.replaceChildren(none, ...tasks.map((task) => {
      const option = document.createElement("option");
      option.value = task.id;
      option.textContent = task.title;
      return option;
    }));
    select.value = tasks.some((task) => task.id === data.taskId) ? data.taskId : "";
    select.disabled = !tasks.length;
    panel.querySelector("[data-focus-sound]").checked = data.sound;
    const stats = todayStats();
    panel.querySelector(".focus-setup-stats").textContent = stats.count || stats.minutes
      ? `Сегодня: ${stats.count} ${pluralSessions(stats.count)} · ${formatDuration(stats.minutes)}`
      : "Сегодня ещё не было фокус-сессий";
    syncStartLabel();
    panel.anchor = anchor;
    panel.hidden = false;
    panel.querySelector("[data-focus-preset].is-active")?.focus();
  }

  function closeSetup({ restoreFocus = false } = {}) {
    if (!setup) return;
    setup.hidden = true;
    if (restoreFocus) setup.anchor?.focus();
  }

  function syncStartLabel() {
    setup.querySelector(".focus-setup-start").textContent = `Начать · ${data.focusMinutes} мин`;
  }

  function ensureSetup() {
    if (setup) return setup;
    setup = document.createElement("div");
    setup.className = "focus-setup";
    setup.setAttribute("role", "dialog");
    setup.setAttribute("aria-label", "Фокус-сессия");
    setup.hidden = true;

    const head = document.createElement("div");
    head.className = "focus-setup-head";
    const heading = document.createElement("strong");
    heading.textContent = "Фокус-сессия";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "focus-setup-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Закрыть");
    close.addEventListener("click", () => closeSetup({ restoreFocus: true }));
    head.append(heading, close);

    const presets = document.createElement("div");
    presets.className = "focus-presets";
    presets.setAttribute("role", "radiogroup");
    presets.setAttribute("aria-label", "Длительность");
    FOCUS_PRESETS.forEach((minutes) => {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "radio");
      option.dataset.focusPreset = String(minutes);
      option.textContent = `${minutes} мин`;
      option.addEventListener("click", () => {
        data.focusMinutes = minutes;
        persist();
        presets.querySelectorAll("[data-focus-preset]").forEach((item) => {
          const active = item === option;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-checked", String(active));
          item.tabIndex = active ? 0 : -1;
        });
        syncStartLabel();
      });
      presets.appendChild(option);
    });
    presets.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const options = [...presets.children];
      const index = options.indexOf(document.activeElement);
      const next = options[(index + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length];
      next.click();
      next.focus();
    });

    const taskField = document.createElement("label");
    taskField.className = "focus-setup-field";
    const taskLabel = document.createElement("span");
    taskLabel.textContent = "Над чем работаешь";
    taskField.append(taskLabel, document.createElement("select"));

    const sound = document.createElement("label");
    sound.className = "focus-setup-sound";
    const soundInput = document.createElement("input");
    soundInput.type = "checkbox";
    soundInput.dataset.focusSound = "";
    soundInput.addEventListener("change", () => {
      data.sound = soundInput.checked;
      persist();
    });
    sound.append(soundInput, document.createTextNode("Звук по окончании"));

    const stats = document.createElement("p");
    stats.className = "focus-setup-stats";

    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.className = "primary-button focus-setup-start";
    startButton.addEventListener("click", () => {
      const taskId = taskField.querySelector("select").value;
      closeSetup();
      startFocus({ minutes: data.focusMinutes, taskId });
    });

    setup.append(head, presets, taskField, sound, stats, startButton);
    document.body.appendChild(setup);
    return setup;
  }

  function ensurePill() {
    if (pill) return pill;
    pill = document.createElement("div");
    pill.className = "focus-timer";
    pill.setAttribute("role", "timer");
    pill.setAttribute("aria-live", "off");
    const copy = document.createElement("span");
    copy.className = "focus-timer-copy";
    const mode = document.createElement("span");
    const task = document.createElement("span");
    mode.className = "focus-timer-mode";
    task.className = "focus-timer-task";
    copy.append(mode, task);
    const clock = document.createElement("strong");
    clock.className = "focus-timer-clock";
    const pause = timerButton("focus-timer-pause", togglePause);
    const more = timerButton("focus-timer-extend", extend);
    more.textContent = `+${EXTEND_MINUTES}`;
    more.title = `Добавить ${EXTEND_MINUTES} минут`;
    more.setAttribute("aria-label", `Добавить ${EXTEND_MINUTES} минут`);
    const stopButton = timerButton("focus-timer-stop", stop);
    const bar = document.createElement("span");
    bar.className = "focus-timer-progress";
    bar.setAttribute("aria-hidden", "true");
    pill.append(copy, clock, pause, more, stopButton, bar);
    document.body.appendChild(pill);
    return pill;
  }

  function timerButton(className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.addEventListener("click", onClick);
    return button;
  }

  function render() {
    const running = Boolean(data.mode);
    const stats = todayStats();
    document.querySelectorAll("[data-focus-start]").forEach((button) => {
      button.hidden = running;
      const counter = button.querySelector("[data-focus-count]");
      if (counter) counter.textContent = stats.count ? `· ${stats.count}` : "";
      button.title = stats.count ? `Сегодня: ${stats.count} ${pluralSessions(stats.count)}, ${formatDuration(stats.minutes)}` : "Начать фокус-сессию";
    });
    if (!running) {
      if (pill) pill.hidden = true;
      document.title = baseTitle;
      return;
    }
    const node = ensurePill();
    const left = remaining();
    const clock = formatRemaining(left);
    const paused = Boolean(data.pausedLeft);
    const focus = data.mode === "focus";
    const label = paused ? "Пауза" : focus ? "Фокус" : "Перерыв";
    node.hidden = false;
    node.classList.toggle("is-break", !focus);
    node.classList.toggle("is-paused", paused);
    node.style.setProperty("--focus-progress", `${data.total ? Math.round((1 - left / data.total) * 1000) / 10 : 0}%`);
    node.querySelector(".focus-timer-mode").textContent = label;
    const task = node.querySelector(".focus-timer-task");
    task.textContent = focus ? data.taskTitle : "";
    task.title = data.taskTitle;
    node.querySelector(".focus-timer-clock").textContent = clock;
    const pause = node.querySelector(".focus-timer-pause");
    pause.replaceChildren(pauseIcon(paused));
    pause.title = paused ? "Продолжить" : "Пауза";
    pause.setAttribute("aria-label", paused ? "Продолжить" : "Пауза");
    node.querySelector(".focus-timer-extend").hidden = !focus;
    const stopButton = node.querySelector(".focus-timer-stop");
    stopButton.textContent = focus ? "Стоп" : "Пропустить";
    stopButton.setAttribute("aria-label", focus ? "Остановить фокус-сессию" : "Пропустить перерыв");
    document.title = `${clock} · ${label} — ${baseTitle}`;
  }

  return { bindEvents, extend, focusOn, getState: () => ({ ...data }), startFocus, stop, togglePause };
}

function pauseIcon(paused) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "currentColor");
  const shapes = paused ? [["path", { d: "M4 2.5v11l9.5-5.5z" }]] : [["rect", { x: "3", y: "2.5", width: "3.5", height: "11", rx: "1" }], ["rect", { x: "9.5", y: "2.5", width: "3.5", height: "11", rx: "1" }]];
  shapes.forEach(([tag, attributes]) => {
    const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attributes).forEach(([name, value]) => shape.setAttribute(name, value));
    svg.appendChild(shape);
  });
  return svg;
}

function formatRemaining(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  if (!hours) return `${total} мин`;
  return total % 60 ? `${hours} ч ${total % 60} мин` : `${hours} ч`;
}

function pluralSessions(count) {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return "сессий";
  if (units === 1) return "сессия";
  if (units >= 2 && units <= 4) return "сессии";
  return "сессий";
}

const api = { breakMinutes, createFocusTimer, formatDuration, formatRemaining, pluralSessions, DEFAULT_FOCUS_MINUTES, FOCUS_PRESETS };

export { breakMinutes, createFocusTimer, formatDuration, formatRemaining, pluralSessions, DEFAULT_FOCUS_MINUTES, FOCUS_PRESETS };
export default api;
