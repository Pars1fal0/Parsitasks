import { authenticateSupabaseRequest } from "./supabase-state.mjs";
import { reportRequestFailure } from "./request-error.mjs";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CONNECTION_TABLE = "google_calendar_connections";
const COOKIE_NAME = "parsitasks_google_calendar_oauth";
const MAX_TASKS = 1000;

export async function handleGoogleCalendarRequest(request, env, options = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/google-calendar/")) return null;
  const fetchFn = options.fetch || fetch;

  if (url.pathname === "/api/google-calendar/callback") {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    try {
      return await handleCallback(request, env, fetchFn);
    } catch {
      const requestId = reportRequestFailure(request, { logger: options.logger, createId: options.createId });
      const response = callbackRedirect(env, request.url, "callback_failed");
      const headers = new Headers(response.headers); headers.set("X-Request-ID", requestId);
      return new Response(null, { status: response.status, headers });
    }
  }

  const auth = await authenticateSupabaseRequest(request, {
    anonKey: publicSupabaseKey(env),
    fetch: fetchFn,
    supabaseUrl: env.SUPABASE_URL,
  });
  if (!auth) return json({ error: "unauthorized", message: "Требуется вход в Parsitasks" }, 401);

  if (url.pathname === "/api/google-calendar/status") {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    const connection = await readConnection(env, auth.accessToken, auth.user.id, fetchFn);
    return json({
      configured: isGoogleCalendarConfigured(env),
      connected: Boolean(connection),
      direction: normalizeDirection(connection?.direction),
      lastError: cleanText(connection?.last_error),
      lastSyncedAt: cleanTimestamp(connection?.last_synced_at),
    });
  }

  if (url.pathname === "/api/google-calendar/connect") {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    if (!isGoogleCalendarConfigured(env)) return notConfigured();
    const state = randomToken();
    const cookieValue = await encryptJson({
      accessToken: auth.accessToken,
      expiresAt: Date.now() + 10 * 60 * 1000,
      state,
      userId: auth.user.id,
    }, env.GOOGLE_TOKEN_ENCRYPTION_KEY);
    return json(
      { authorizationUrl: createGoogleAuthorizationUrl(env, state, request.url) },
      200,
      { "Set-Cookie": oauthCookie(cookieValue, 600, new URL(request.url).protocol === "https:") },
    );
  }

  if (url.pathname === "/api/google-calendar/disconnect") {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    const connection = await readConnection(env, auth.accessToken, auth.user.id, fetchFn);
    if (connection?.encrypted_refresh_token && isGoogleCalendarConfigured(env)) {
      const refreshToken = await decryptText(connection.encrypted_refresh_token, env.GOOGLE_TOKEN_ENCRYPTION_KEY).catch(() => "");
      if (refreshToken) {
        await fetchFn(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }).catch(() => {});
      }
    }
    await deleteConnection(env, auth.accessToken, auth.user.id, fetchFn);
    return json({ connected: false });
  }

  if (url.pathname === "/api/google-calendar/sync") {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    if (!isGoogleCalendarConfigured(env)) return notConfigured();
    const payload = await readJsonBody(request);
    try {
      const result = await synchronizeCalendar(env, auth, payload, fetchFn);
      return json(result);
    } catch (error) {
      const message = safeCalendarError(error);
      await upsertConnection(env, auth.accessToken, auth.user.id, { last_error: message }, fetchFn).catch(() => {});
      return json({ error: "sync_failed", message }, error?.status === 401 ? 401 : 502);
    }
  }

  return json({ error: "not_found" }, 404);
}

export function createGoogleAuthorizationUrl(env, state, requestUrl) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("client_id", cleanText(env.GOOGLE_CALENDAR_CLIENT_ID));
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("redirect_uri", callbackUrl(env, requestUrl));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CALENDAR_SCOPE);
  url.searchParams.set("state", state);
  return url.href;
}

export function isGoogleCalendarConfigured(env = {}) {
  return Boolean(
    cleanText(env.GOOGLE_CALENDAR_CLIENT_ID)
    && cleanText(env.GOOGLE_CALENDAR_CLIENT_SECRET)
    && cleanText(env.GOOGLE_TOKEN_ENCRYPTION_KEY).length >= 32
    && cleanText(env.SUPABASE_URL)
    && publicSupabaseKey(env),
  );
}

export function taskToGoogleEvent(task, timeZone = "UTC") {
  return {
    summary: cleanText(task.title) || "Задача Parsitasks",
    description: [cleanText(task.category), priorityLabel(task.priority), "Parsitasks"]
      .filter(Boolean)
      .join(" · "),
    start: { dateTime: `${task.date}T${task.startTime}:00`, timeZone },
    end: { dateTime: `${task.date}T${task.endTime}:00`, timeZone },
    extendedProperties: { private: { parsitasks: "1", parsitasksTaskId: cleanText(task.id) } },
  };
}

export function googleEventToTask(event, taskId, timeZone = "UTC", source = {}) {
  if (event?.status === "cancelled" || !event?.start?.dateTime || !event?.end?.dateTime) return null;
  const start = dateTimeParts(event.start.dateTime, timeZone);
  const end = dateTimeParts(event.end.dateTime, timeZone);
  if (!start || !end || start.date !== end.date || timeMinutes(end.time) - timeMinutes(start.time) < 15) return null;
  return {
    id: cleanText(taskId),
    title: cleanText(event.summary) || "Событие Google Calendar",
    date: start.date,
    scheduleMode: "block",
    startTime: start.time,
    endTime: end.time,
    time: end.time,
    updatedAt: cleanTimestamp(event.updated) || new Date().toISOString(),
    ...(source.sourceTaskId ? {
      occurrenceDate: source.occurrenceDate,
      sourceTaskId: source.sourceTaskId,
    } : {}),
  };
}

async function handleCallback(request, env, fetchFn) {
  if (!isGoogleCalendarConfigured(env)) return callbackRedirect(env, request.url, "not_configured");
  const url = new URL(request.url);
  const cookie = readCookie(request.headers.get("Cookie"), COOKIE_NAME);
  let pending;
  try {
    pending = await decryptJson(cookie, env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  } catch {
    return callbackRedirect(env, request.url, "invalid_state");
  }
  if (!pending?.accessToken || !pending?.userId || pending.expiresAt < Date.now() || pending.state !== url.searchParams.get("state")) {
    return callbackRedirect(env, request.url, "invalid_state");
  }
  if (url.searchParams.get("error") || !url.searchParams.get("code")) {
    return callbackRedirect(env, request.url, "access_denied");
  }

  const auth = await authenticateSupabaseRequest(new Request(request.url, {
    headers: { Authorization: `Bearer ${pending.accessToken}` },
  }), {
    anonKey: publicSupabaseKey(env),
    fetch: fetchFn,
    supabaseUrl: env.SUPABASE_URL,
  });
  if (!auth || auth.user.id !== pending.userId) return callbackRedirect(env, request.url, "session_expired");

  const tokenResponse = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cleanText(env.GOOGLE_CALENDAR_CLIENT_ID),
      client_secret: cleanText(env.GOOGLE_CALENDAR_CLIENT_SECRET),
      code: url.searchParams.get("code"),
      grant_type: "authorization_code",
      redirect_uri: callbackUrl(env, request.url),
    }),
  });
  const tokens = await readResponseJson(tokenResponse);
  if (!tokenResponse.ok || !tokens?.refresh_token) return callbackRedirect(env, request.url, "token_exchange_failed");

  await upsertConnection(env, pending.accessToken, pending.userId, {
    calendar_id: "primary",
    connected_at: new Date().toISOString(),
    direction: "export",
    encrypted_refresh_token: await encryptText(tokens.refresh_token, env.GOOGLE_TOKEN_ENCRYPTION_KEY),
    last_error: "",
  }, fetchFn);
  return callbackRedirect(env, request.url, "connected");
}

async function synchronizeCalendar(env, auth, payload, fetchFn) {
  const connection = await readConnection(env, auth.accessToken, auth.user.id, fetchFn);
  if (!connection?.encrypted_refresh_token) {
    return { connected: false, error: "not_connected", message: "Сначала подключите Google Calendar" };
  }
  const refreshToken = await decryptText(connection.encrypted_refresh_token, env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  const googleAccessToken = await refreshGoogleAccessToken(env, refreshToken, fetchFn);
  const direction = normalizeDirection(payload?.direction || connection.direction);
  const timeZone = validTimeZone(payload?.timeZone) ? payload.timeZone : "UTC";
  const tasks = normalizeTasks(payload?.tasks);
  const links = normalizeLinks(payload?.links);
  const tombstones = normalizeTombstones(payload?.tombstones);
  const outOfRangeTaskIds = Array.isArray(payload?.outOfRangeTaskIds)
    ? payload.outOfRangeTaskIds.map(cleanText).filter(Boolean).slice(0, 500)
    : [];
  const calendarId = cleanText(connection.calendar_id) || "primary";
  const events = await listGoogleEvents(googleAccessToken, calendarId, fetchFn);
  const eventById = new Map(events.map((event) => [event.id, event]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const nextLinks = { ...links };
  const removedEventIds = new Set();
  const upserts = [];
  const deletions = [];
  const summary = { created: 0, deleted: 0, imported: 0, skipped: Number(payload?.skipped) || 0, updated: 0 };

  for (const task of tasks) {
    let link = nextLinks[task.id];
    let event = link ? eventById.get(link.eventId) : findLinkedEvent(events, task.id);
    if (!event || event.status === "cancelled") {
      if (link && event?.status === "cancelled" && direction === "two-way" && isNewer(event.updated, link.remoteUpdatedAt)) {
        deletions.push(deletionDescriptor(task));
        delete nextLinks[task.id];
        summary.deleted += 1;
        continue;
      }
      event = await googleApi(googleAccessToken, calendarId, "", "POST", taskToGoogleEvent(task, timeZone), fetchFn);
      summary.created += 1;
    } else {
      link ||= linkFromEvent(event, task);
      const localChanged = isNewer(task.updatedAt, link.localUpdatedAt);
      const remoteChanged = isNewer(event.updated, link.remoteUpdatedAt);
      if (direction === "two-way" && remoteChanged && (!localChanged || timestamp(event.updated) >= timestamp(task.updatedAt))) {
        const patch = googleEventToTask(event, task.id, timeZone, task);
        if (patch) {
          upserts.push(patch);
          summary.imported += 1;
          task.updatedAt = patch.updatedAt;
        }
      } else if (localChanged || (direction === "export" && remoteChanged)) {
        event = await googleApi(googleAccessToken, calendarId, event.id, "PATCH", taskToGoogleEvent(task, timeZone), fetchFn);
        summary.updated += 1;
      }
    }
    nextLinks[task.id] = createLink(event, task);
  }

  for (const [taskId, link] of Object.entries(links)) {
    const sourceTaskId = link.sourceTaskId || taskId;
    if (taskById.has(taskId) || !tombstones[sourceTaskId] || !isNewer(tombstones[sourceTaskId], link.localUpdatedAt)) continue;
    await googleApi(googleAccessToken, calendarId, link.eventId, "DELETE", null, fetchFn).catch((error) => {
      if (![404, 410].includes(error.status)) throw error;
    });
    removedEventIds.add(link.eventId);
    delete nextLinks[taskId];
    summary.deleted += 1;
  }

  for (const taskId of outOfRangeTaskIds) {
    const link = nextLinks[taskId];
    if (!link) continue;
    await googleApi(googleAccessToken, calendarId, link.eventId, "DELETE", null, fetchFn).catch((error) => {
      if (![404, 410].includes(error.status)) throw error;
    });
    removedEventIds.add(link.eventId);
    delete nextLinks[taskId];
    summary.deleted += 1;
  }

  if (direction === "two-way") {
    const linkedEventIds = new Set(Object.values(nextLinks).map((link) => link.eventId));
    for (const event of events) {
      if (event.status === "cancelled" || linkedEventIds.has(event.id) || removedEventIds.has(event.id)) continue;
      const declaredTaskId = cleanText(event.extendedProperties?.private?.parsitasksTaskId);
      const taskId = declaredTaskId || externalTaskId(event.id);
      if (tombstones[taskId]) continue;
      const patch = googleEventToTask(event, taskId, timeZone);
      if (!patch) {
        summary.skipped += 1;
        continue;
      }
      upserts.push(patch);
      nextLinks[taskId] = createLink(event, patch);
      linkedEventIds.add(event.id);
      summary.imported += 1;
    }
  }

  const syncedAt = new Date().toISOString();
  await upsertConnection(env, auth.accessToken, auth.user.id, {
    direction,
    last_error: "",
    last_synced_at: syncedAt,
  }, fetchFn);
  return { connected: true, deletions, direction, lastSyncedAt: syncedAt, links: nextLinks, summary, upserts };
}

async function listGoogleEvents(accessToken, calendarId, fetchFn) {
  const now = new Date();
  const timeMin = new Date(now.getTime() - 31 * 86400000).toISOString();
  const timeMax = new Date(now.getTime() + 181 * 86400000).toISOString();
  const events = [];
  let pageToken = "";
  for (let page = 0; page < 5; page += 1) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("timeMin", timeMin);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await readResponseJson(response);
    if (!response.ok) throw apiError("Не удалось прочитать Google Calendar", response, data);
    events.push(...(Array.isArray(data?.items) ? data.items : []));
    pageToken = cleanText(data?.nextPageToken);
    if (!pageToken) break;
  }
  return events;
}

async function googleApi(accessToken, calendarId, eventId, method, body, fetchFn) {
  const suffix = eventId ? `/${encodeURIComponent(eventId)}` : "";
  const response = await fetchFn(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${suffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await readResponseJson(response);
  if (!response.ok) throw apiError("Google Calendar отклонил изменение", response, data);
  return data || {};
}

async function refreshGoogleAccessToken(env, refreshToken, fetchFn) {
  const response = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cleanText(env.GOOGLE_CALENDAR_CLIENT_ID),
      client_secret: cleanText(env.GOOGLE_CALENDAR_CLIENT_SECRET),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = await readResponseJson(response);
  if (!response.ok || !data?.access_token) throw apiError("Не удалось обновить доступ к Google Calendar", response, data);
  return data.access_token;
}

async function readConnection(env, accessToken, userId, fetchFn) {
  const response = await connectionFetch(env, accessToken, `?user_id=eq.${encodeURIComponent(userId)}&limit=1`, {}, fetchFn);
  const data = await readResponseJson(response);
  if (!response.ok) throw apiError("Не удалось прочитать подключение календаря", response, data);
  return Array.isArray(data) ? data[0] || null : null;
}

async function upsertConnection(env, accessToken, userId, fields, fetchFn) {
  const response = await connectionFetch(env, accessToken, "?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, ...fields, updated_at: new Date().toISOString() }),
  }, fetchFn);
  const data = await readResponseJson(response);
  if (!response.ok) throw apiError("Не удалось сохранить подключение календаря", response, data);
}

async function deleteConnection(env, accessToken, userId, fetchFn) {
  const response = await connectionFetch(env, accessToken, `?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" }, fetchFn);
  const data = await readResponseJson(response);
  if (!response.ok) throw apiError("Не удалось отключить календарь", response, data);
}

function connectionFetch(env, accessToken, query, options, fetchFn) {
  return fetchFn(`${cleanText(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/${CONNECTION_TABLE}${query}`, {
    ...options,
    headers: {
      apikey: publicSupabaseKey(env),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

function normalizeTasks(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TASKS).map((task) => ({
    category: cleanText(task?.category).slice(0, 80),
    date: /^\d{4}-\d{2}-\d{2}$/.test(task?.date) ? task.date : "",
    endTime: validTime(task?.endTime),
    id: cleanText(task?.id).slice(0, 160),
    priority: ["low", "medium", "high"].includes(task?.priority) ? task.priority : "medium",
    occurrenceDate: /^\d{4}-\d{2}-\d{2}$/.test(task?.occurrenceDate) ? task.occurrenceDate : "",
    sourceTaskId: cleanText(task?.sourceTaskId).slice(0, 160),
    startTime: validTime(task?.startTime),
    title: cleanText(task?.title).slice(0, 500),
    updatedAt: cleanTimestamp(task?.updatedAt) || new Date().toISOString(),
  })).filter((task) => task.id && task.date && task.startTime && task.endTime && timeMinutes(task.endTime) > timeMinutes(task.startTime));
}

function normalizeLinks(value) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  Object.entries(value).slice(0, 1000).forEach(([taskId, link]) => {
    const eventId = cleanText(link?.eventId);
    if (!taskId || !eventId) return;
    const occurrenceDate = /^\d{4}-\d{2}-\d{2}$/.test(link?.occurrenceDate) ? link.occurrenceDate : "";
    const sourceTaskId = cleanText(link?.sourceTaskId).slice(0, 160);
    result[taskId] = {
      eventId,
      localUpdatedAt: cleanTimestamp(link?.localUpdatedAt),
      remoteUpdatedAt: cleanTimestamp(link?.remoteUpdatedAt),
      syncedAt: cleanTimestamp(link?.syncedAt),
      ...(occurrenceDate && sourceTaskId ? { occurrenceDate, sourceTaskId } : {}),
    };
  });
  return result;
}

function normalizeTombstones(value) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  Object.entries(value).slice(0, 1000).forEach(([id, deletedAt]) => {
    const timestampValue = cleanTimestamp(deletedAt);
    if (id && timestampValue) result[id] = timestampValue;
  });
  return result;
}

function createLink(event, task) {
  const now = new Date().toISOString();
  return {
    eventId: cleanText(event.id),
    localUpdatedAt: cleanTimestamp(task.updatedAt) || now,
    remoteUpdatedAt: cleanTimestamp(event.updated) || now,
    syncedAt: now,
    ...(task.sourceTaskId && task.occurrenceDate ? {
      occurrenceDate: task.occurrenceDate,
      sourceTaskId: task.sourceTaskId,
    } : {}),
  };
}

function linkFromEvent(event, task) {
  return {
    eventId: event.id,
    localUpdatedAt: "",
    remoteUpdatedAt: "",
    syncedAt: task.updatedAt || "",
    ...(task.sourceTaskId && task.occurrenceDate ? {
      occurrenceDate: task.occurrenceDate,
      sourceTaskId: task.sourceTaskId,
    } : {}),
  };
}

function deletionDescriptor(task) {
  if (!task.sourceTaskId) return task.id;
  return { id: task.id, occurrenceDate: task.occurrenceDate, sourceTaskId: task.sourceTaskId };
}

function findLinkedEvent(events, taskId) {
  return events.find((event) => event.extendedProperties?.private?.parsitasksTaskId === taskId);
}

function externalTaskId(eventId) {
  return `gcal-${cleanText(eventId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120)}`;
}

function dateTimeParts(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit", hour: "2-digit", hourCycle: "h23", minute: "2-digit", month: "2-digit", timeZone, year: "numeric",
    }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  } catch {
    return null;
  }
}

function validTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(cleanText(value));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return "";
  return `${match[1]}:${match[2]}`;
}

function timeMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  return hours * 60 + minutes;
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizeDirection(value) {
  return value === "two-way" ? "two-way" : "export";
}

function priorityLabel(value) {
  return { high: "Высокий приоритет", medium: "Средний приоритет", low: "Низкий приоритет" }[value] || "";
}

function callbackUrl(env, requestUrl) {
  const origin = appOrigin(env, requestUrl);
  return `${origin}/api/google-calendar/callback`;
}

function callbackRedirect(env, requestUrl, result) {
  const origin = appOrigin(env, requestUrl);
  const location = `${origin}/app?googleCalendar=${encodeURIComponent(result)}#settings`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Set-Cookie": oauthCookie("", 0, new URL(requestUrl).protocol === "https:"),
      "Cache-Control": "no-store",
    },
  });
}

function appOrigin(env, requestUrl) {
  const requestOrigin = new URL(requestUrl).origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestOrigin)) return requestOrigin;
  return cleanText(env.APP_BASE_URL).replace(/\/+$/, "") || requestOrigin;
}

function oauthCookie(value, maxAge = 600, secure = true) {
  return `${COOKIE_NAME}=${value}; Path=/api/google-calendar; Max-Age=${maxAge}; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax`;
}

function readCookie(header, name) {
  return String(header || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

async function encryptJson(value, secret) {
  return encryptText(JSON.stringify(value), secret);
}

async function decryptJson(value, secret) {
  return JSON.parse(await decryptText(value, secret));
}

async function encryptText(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)));
  return `${base64Url(iv)}.${base64Url(encrypted)}`;
}

async function decryptText(value, secret) {
  const [ivValue, encryptedValue] = String(value || "").split(".");
  if (!ivValue || !encryptedValue) throw new Error("Invalid encrypted value");
  const key = await encryptionKey(secret);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(ivValue) }, key, fromBase64Url(encryptedValue));
  return new TextDecoder().decode(decrypted);
}

async function encryptionKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cleanText(secret)));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
}

function randomToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(24)));
}

async function readJsonBody(request) {
  const text = await request.text();
  if (text.length > 2 * 1024 * 1024) throw new Error("Слишком большой запрос синхронизации");
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error("Некорректный JSON"); }
}

async function readResponseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text }; }
}

function apiError(message, response, data) {
  const details = data?.error_description || data?.error?.message || data?.message || response.statusText;
  const error = new Error(details ? `${message}: ${details}` : message);
  error.status = response.status;
  return error;
}

function isNewer(left, right) {
  return timestamp(left) > timestamp(right);
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanTimestamp(value) {
  return timestamp(value) ? String(value) : "";
}

function cleanText(value) {
  return String(value || "").trim();
}

function safeCalendarError(error) {
  const message = cleanText(error?.message);
  if (/invalid_grant/i.test(message)) return "Доступ Google истёк. Отключите календарь и подключите его снова";
  if (/insufficient|forbidden|permission/i.test(message)) return "Google не разрешил изменение календаря";
  if (/quota|rate limit/i.test(message)) return "Лимит Google Calendar временно исчерпан. Повторите позже";
  return message.slice(0, 300) || "Не удалось синхронизировать Google Calendar";
}

function publicSupabaseKey(env) {
  const key = cleanText(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY);
  if (!key || /^sb_secret_/i.test(key)) return "";
  try {
    const encoded = key.split(".")[1];
    if (!encoded) return key;
    const payload = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
    return payload?.role === "service_role" ? "" : key;
  } catch {
    return key;
  }
}

function notConfigured() {
  return json({ error: "not_configured", message: "Google Calendar ещё не настроен на сервере" }, 503);
}

function methodNotAllowed(methods) {
  return json({ error: "method_not_allowed" }, 405, { Allow: methods.join(", ") });
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export { decryptJson, decryptText, encryptJson, encryptText, publicSupabaseKey };
