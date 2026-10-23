import * as occurrenceApi from "./google-calendar-occurrences.js";

const HOSTED_APP_URL = "https://parsitasks.ru/app";
const EXPIRED_ACCESS = /Доступ Google истёк/;

function createGoogleCalendarController(ctx) {
  let connected = false;
  let configured = true;
  let direction = "export";
  let inFlight = false;
  let lastError = "";
  let needsReconnect = false;
  let lastSyncedAt = "";
  let lastSummary = null;
  let lastLocalFingerprint = "";
  let timer = null;
  let interval = null;
  let queuedSync = false;
  const owner = () => ctx.getOwner?.() ?? ctx.getAccessToken();

  function bindEvents() {
    ctx.els.googleCalendarConnect?.addEventListener("click", connect);
    ctx.els.googleCalendarDisconnect?.addEventListener("click", disconnect);
    ctx.els.googleCalendarSync?.addEventListener("click", () => sync({ announce: true }));
    ctx.els.googleCalendarDirection?.addEventListener("change", () => {
      direction = normalizeDirection(ctx.els.googleCalendarDirection.value);
      render();
      schedule();
    });
    globalThis.addEventListener?.("online", () => schedule(300));
    globalThis.document?.addEventListener("visibilitychange", () => {
      if (globalThis.document.visibilityState === "visible") schedule(300);
    });
  }

  async function initialize() {
    consumeCallbackResult();
    await refreshStatus();
    if (connected) sync({ silent: true });
    if (!interval) interval = globalThis.setInterval(() => sync({ silent: true }), 5 * 60 * 1000);
  }

  async function refreshStatus() {
    if (!ctx.getAccessToken()) {
      connected = false;
      render();
      return;
    }
    setBusy(true);
    try {
      const status = await ctx.api.status();
      configured = status.configured !== false;
      connected = status.connected === true;
      direction = normalizeDirection(status.direction);
      lastSyncedAt = status.lastSyncedAt || "";
      lastError = status.lastError || "";
      needsReconnect = connected && EXPIRED_ACCESS.test(lastError);
    } catch (error) {
      connected = false;
      lastError = describeError(error);
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    if (inFlight) return;
    if (globalThis.location.protocol === "file:") {
      // OAuth state lives in a web-origin cookie, so the desktop app hands the connection off to the web version.
      globalThis.open?.(`${HOSTED_APP_URL}#settings`, "_blank", "noopener");
      ctx.showToast("Подключите Google Calendar в открытой веб-версии, затем вернитесь в приложение");
      return;
    }
    setBusy(true);
    lastError = "";
    try {
      const result = await ctx.api.connect();
      if (!result.authorizationUrl) throw new Error("Сервер не вернул адрес Google");
      globalThis.location.assign(result.authorizationUrl);
    } catch (error) {
      lastError = describeError(error);
      ctx.showToast(lastError);
      setBusy(false);
    }
  }

  async function disconnect() {
    if (inFlight || !connected) return;
    const startedOwner = owner();
    const confirmed = await ctx.confirmAction({
      title: "Отключить Google Calendar?",
      message: "Уже созданные события останутся в Google. Новые изменения больше не будут синхронизироваться.",
      confirmText: "Отключить",
      danger: true,
    });
    if (!confirmed || owner() !== startedOwner) return;
    setBusy(true);
    try {
      await ctx.api.disconnect();
      connected = false;
      lastSyncedAt = "";
      lastSummary = null;
      ctx.showToast("Google Calendar отключён");
    } catch (error) {
      lastError = describeError(error);
      ctx.showToast(lastError);
    } finally {
      setBusy(false);
    }
  }

  function schedule(delay = 2500) {
    if (!connected || globalThis.navigator?.onLine === false) return;
    if (inFlight) { queuedSync = true; return; }
    const fingerprint = payloadFingerprint(buildPayload(ctx.getState(), direction, ctx.getTimeZone()));
    if (fingerprint === lastLocalFingerprint) return;
    lastLocalFingerprint = fingerprint;
    globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => sync({ silent: true }), delay);
  }

  async function sync(options = {}) {
    if (!connected || inFlight || !ctx.getAccessToken() || globalThis.navigator?.onLine === false) return null;
    setBusy(true);
    lastError = "";
    const startedOwner = owner();
    const baseline = structuredClone(ctx.getState());
    try {
      const payload = structuredClone(buildPayload(ctx.getState(), direction, ctx.getTimeZone()));
      const result = await ctx.api.sync(payload);
      if (owner() !== startedOwner) { connected = false; queuedSync = false; return null; }
      if (result.connected === false) {
        connected = false;
        throw new Error(result.message || "Google Calendar не подключён");
      }
      const changedDuringRequest = payloadFingerprint(buildPayload(ctx.getState(), direction, ctx.getTimeZone())) !== payloadFingerprint(payload);
      applyResult(result, baseline);
      queuedSync ||= changedDuringRequest;
      lastLocalFingerprint = queuedSync ? "" : payloadFingerprint(buildPayload(ctx.getState(), direction, ctx.getTimeZone()));
      needsReconnect = false;
      lastSyncedAt = result.lastSyncedAt || new Date().toISOString();
      lastSummary = result.summary || null;
      if (options.announce) ctx.showToast(summaryText(lastSummary));
      return result;
    } catch (error) {
      if (owner() !== startedOwner) return null;
      lastLocalFingerprint = "";
      lastError = describeError(error);
      needsReconnect = error?.code === "reauthorization_required";
      if (!options.silent || error?.status === 401) ctx.showToast(lastError);
      return null;
    } finally {
      setBusy(false);
      if (queuedSync && owner() === startedOwner) { queuedSync = false; schedule(); }
    }
  }

  function applyResult(result, baseline) {
    const current = ctx.getState();
    const previous = structuredClone(current);
    try {
      applyCalendarResult(current, result, ctx, baseline);
      if (ctx.saveState({ skipGoogleCalendar: true }) === false) throw new Error("Не удалось сохранить результат Google Calendar. Локальные изменения сохранены.");
    } catch (error) {
      if (ctx.replaceState) ctx.replaceState(previous);
      else { Object.keys(current).forEach((key) => delete current[key]); Object.assign(current, previous); }
      throw error;
    }
    ctx.render();
  }

  function consumeCallbackResult() {
    if (!globalThis.location?.href || !globalThis.history?.replaceState) return;
    const url = new URL(globalThis.location.href);
    const result = url.searchParams.get("googleCalendar");
    if (!result) return;
    url.searchParams.delete("googleCalendar");
    globalThis.history.replaceState(globalThis.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if (result === "connected") ctx.showToast("Google Calendar подключён");
    else ctx.showToast(callbackError(result));
  }

  function setBusy(value) {
    inFlight = value;
    render();
  }

  function render() {
    const authenticated = Boolean(ctx.getAccessToken());
    if (ctx.els.googleCalendarDirection) {
      ctx.els.googleCalendarDirection.value = direction;
      ctx.els.googleCalendarDirection.disabled = inFlight || !connected;
    }
    if (ctx.els.googleCalendarConnect) {
      // Google revokes testing-mode grants weekly; offer a one-step reconnect instead of disconnect + connect.
      ctx.els.googleCalendarConnect.hidden = connected && !needsReconnect;
      ctx.els.googleCalendarConnect.textContent = needsReconnect ? "Переподключить Google Calendar" : "Подключить Google Calendar";
    }
    if (ctx.els.googleCalendarDisconnect) ctx.els.googleCalendarDisconnect.hidden = !connected;
    if (ctx.els.googleCalendarSync) {
      ctx.els.googleCalendarSync.hidden = !connected;
      ctx.els.googleCalendarSync.disabled = inFlight;
      ctx.els.googleCalendarSync.textContent = inFlight ? "Синхронизация..." : "Синхронизировать";
    }
    if (!ctx.els.googleCalendarStatus) return;
    if (!authenticated) ctx.els.googleCalendarStatus.textContent = "Войдите в аккаунт Parsitasks, чтобы подключить календарь.";
    else if (!configured) ctx.els.googleCalendarStatus.textContent = "Интеграция ещё не настроена на сервере.";
    else if (lastError) ctx.els.googleCalendarStatus.textContent = `Ошибка: ${lastError}`;
    else if (!connected) ctx.els.googleCalendarStatus.textContent = "Google Calendar не подключён.";
    else {
      const last = lastSyncedAt ? ctx.formatDate(lastSyncedAt) : "ещё не запускалась";
      ctx.els.googleCalendarStatus.textContent = `Подключён · последняя синхронизация: ${last}${lastSummary ? ` · ${summaryText(lastSummary)}` : ""}`;
    }
  }

  return { bindEvents, initialize, refreshStatus, render, schedule, sync };
}

function applyCalendarResult(state, result = {}, ctx, baseline) {
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const currentTasks = new Map(state.tasks.map((task) => [task.id, task]));
  const oldTasks = new Map((baseline?.tasks || []).map((task) => [task.id, task]));
  const changedIds = new Set(baseline ? [...new Set([...currentTasks.keys(), ...oldTasks.keys(),
    ...Object.keys(state.tombstones?.tasks || {}), ...Object.keys(baseline.tombstones?.tasks || {})])]
    .filter((id) => !same(currentTasks.get(id), oldTasks.get(id)) || !same(state.tombstones?.tasks?.[id], baseline.tombstones?.tasks?.[id])) : []);
  const safe = (patch) => !changedIds.has(patch.id) && !changedIds.has(patch.sourceTaskId)
    && !state.tombstones?.tasks?.[patch.id] && (!patch.sourceTaskId || !state.tombstones?.tasks?.[patch.sourceTaskId]);
  const links = result.links && typeof result.links === "object" ? structuredClone(result.links) : {};
  if (baseline) {
    for (const id of new Set([...Object.keys(baseline.googleCalendarLinks || {}), ...Object.keys(state.googleCalendarLinks || {})])) {
      if (same(state.googleCalendarLinks?.[id], baseline.googleCalendarLinks?.[id])) continue;
      if (state.googleCalendarLinks?.[id]) links[id] = structuredClone(state.googleCalendarLinks[id]);
      else delete links[id];
    }
  }
  state.googleCalendarLinks = links;
  const googleCategoryId = result.upserts?.length ? ensureGoogleCategory(state, ctx.createId) : "";
  const taskById = new Map(state.tasks.map((task) => [task.id, task]));
  (result.upserts || []).forEach((patch) => {
    if (!safe(patch)) return;
    const source = patch.sourceTaskId ? taskById.get(patch.sourceTaskId) : null;
    if (source && patch.occurrenceDate) {
      source.excludedDates ||= {};
      source.excludedDates[patch.occurrenceDate] = true;
      source.updatedAt = newestTimestamp(source.updatedAt, patch.updatedAt);
    }
    const existing = taskById.get(patch.id);
    if (existing) {
      Object.assign(existing, {
        date: patch.date,
        endTime: patch.endTime,
        scheduleMode: "block",
        startTime: patch.startTime,
        time: patch.endTime,
        title: patch.title,
        updatedAt: patch.updatedAt,
      });
      return;
    }
    const now = new Date().toISOString();
    const task = {
      acknowledgedOverdue: {}, categoryId: source?.categoryId || googleCategoryId, completed: {}, createdAt: now,
      customRepeat: {}, date: patch.date, endTime: patch.endTime, excludedDates: {}, id: patch.id,
      movedFromDate: patch.occurrenceDate || "", notified: {}, priority: source?.priority || "medium", reminderOffset: "15", repeat: "none",
      repeatUntil: "", scheduleMode: "block", sourceTaskId: source?.id || "", startTime: patch.startTime,
      time: patch.endTime, title: patch.title, updatedAt: patch.updatedAt,
    };
    state.tasks.push(task);
    taskById.set(task.id, task);
  });
  (result.deletions || []).forEach((value) => {
    const deletion = typeof value === "string" ? { id: value } : value || {};
    if (!safe(deletion)) return;
    const source = deletion.sourceTaskId ? taskById.get(deletion.sourceTaskId) : null;
    if (source && deletion.occurrenceDate) {
      source.excludedDates ||= {};
      source.excludedDates[deletion.occurrenceDate] = true;
      source.updatedAt = new Date().toISOString();
    }
    if (taskById.has(deletion.id)) ctx.deleteTask(deletion.id);
  });
  return state;
}

function buildPayload(state = {}, direction, timeZone, now = new Date()) {
  const range = syncRange(now);
  const occurrences = occurrenceApi.buildCalendarTasks(state, range);
  return {
    direction: normalizeDirection(direction),
    links: state.googleCalendarLinks || {},
    outOfRangeTaskIds: occurrences.staleTaskIds,
    skipped: occurrences.skipped,
    tasks: occurrences.tasks,
    timeZone,
    tombstones: state.tombstones?.tasks || {},
  };
}

function syncRange(now = new Date()) {
  const from = new Date(now.getTime() - 30 * 86400000);
  const to = new Date(now.getTime() + 180 * 86400000);
  return { from: dateKey(from), to: dateKey(to) };
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function ensureGoogleCategory(state, createId) {
  const existing = (state.categories || []).find((category) => category.name.toLowerCase() === "google calendar");
  if (existing) return existing.id;
  const now = new Date().toISOString();
  const category = { id: createId(), name: "Google Calendar", color: "#4285f4", createdAt: now, updatedAt: now };
  state.categories.push(category);
  return category.id;
}

function summaryText(summary = {}) {
  const changed = Number(summary.created || 0) + Number(summary.updated || 0) + Number(summary.imported || 0) + Number(summary.deleted || 0);
  const skipped = summary.skipped ? ` · не поместились в синхронизацию: ${summary.skipped}, они останутся без изменений` : "";
  if (!changed) return summary.skipped ? `Без изменений${skipped}` : "Изменений нет";
  return `Обновлено: ${changed}${skipped}`;
}

function payloadFingerprint(payload) {
  return JSON.stringify({
    direction: payload.direction,
    timeZone: payload.timeZone,
    links: payload.links,
    outOfRangeTaskIds: payload.outOfRangeTaskIds,
    tasks: payload.tasks,
    tombstones: payload.tombstones,
  });
}

function newestTimestamp(left, right) {
  return Date.parse(right || "") > Date.parse(left || "") ? right : left || right || new Date().toISOString();
}

function callbackError(value) {
  const messages = {
    access_denied: "Подключение Google Calendar отменено",
    invalid_state: "Сессия подключения устарела. Попробуйте ещё раз",
    not_configured: "Google Calendar ещё не настроен на сервере",
    session_expired: "Сессия Parsitasks истекла. Войдите снова",
    token_exchange_failed: "Google не выдал постоянный доступ. Подключите календарь ещё раз",
    callback_failed: "Не удалось завершить подключение Google Calendar",
  };
  return messages[value] || "Не удалось подключить Google Calendar";
}

function describeError(error) {
  if (error?.status === 401) return "Сессия Parsitasks истекла. Войдите снова";
  if (error?.code === "not_configured") return "Интеграция Google Calendar ещё не настроена на сервере";
  return String(error?.message || "Не удалось синхронизировать Google Calendar");
}

function normalizeDirection(value) {
  return value === "two-way" ? "two-way" : "export";
}

const api = { applyCalendarResult, buildPayload, createGoogleCalendarController, syncRange };

export { applyCalendarResult, buildPayload, createGoogleCalendarController, syncRange };
export default api;
