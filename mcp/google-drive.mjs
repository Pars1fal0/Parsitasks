import { authenticateSupabaseRequest } from "./supabase-state.mjs";
import { decryptJson, decryptText, encryptJson, encryptText, publicSupabaseKey } from "./google-calendar.mjs";
import { reportRequestFailure } from "./request-error.mjs";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TABLE = "google_drive_connections";
const COOKIE = "parsitasks_google_drive_oauth";
const MAX_CHUNK = 5 * 1024 * 1024;

export async function handleGoogleDriveRequest(request, env, options = {}) {
  const url = new URL(request.url);
  const fetchFn = options.fetch || fetch;
  if (url.pathname === "/api/google-drive/callback") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    try { return await callback(request, env, fetchFn); }
    catch {
      const requestId = reportRequestFailure(request, { logger: options.logger, createId: options.createId });
      const response = redirect(env, request.url, "callback_failed");
      const headers = new Headers(response.headers); headers.set("X-Request-ID", requestId);
      return new Response(null, { status: response.status, headers });
    }
  }

  if (!env.SUPABASE_URL || !publicSupabaseKey(env)) {
    if (url.pathname === "/api/google-drive/status" && request.method === "GET") {
      return json({ configured: false, connected: false });
    }
    return json({ error: "not_configured", message: "Google Drive не настроен на локальном сервере" }, 503);
  }

  const auth = await authenticateSupabaseRequest(request, {
    anonKey: publicSupabaseKey(env), fetch: fetchFn, supabaseUrl: env.SUPABASE_URL,
  });
  if (!auth) return json({ error: "unauthorized", message: "Требуется вход в Parsitasks" }, 401);
  if (url.pathname === "/api/google-drive/status" && request.method === "GET") {
    try {
      const connection = await readConnection(env, auth, fetchFn);
      return json({ configured: configured(env), connected: Boolean(connection), folderReady: Boolean(connection?.folder_id) });
    } catch {
      return json({ configured: false, connected: false, setupRequired: true });
    }
  }
  if (url.pathname === "/api/google-drive/connect" && request.method === "POST") {
    if (!configured(env)) return json({ error: "not_configured", message: "Google Drive не настроен на сервере" }, 503);
    try { await readConnection(env, auth, fetchFn); }
    catch { return json({ error: "setup_required", message: "Выполните актуальный supabase-schema.sql" }, 503); }
    const state = randomToken();
    const pending = await encryptJson({ state, userId: auth.user.id, accessToken: auth.accessToken, expiresAt: Date.now() + 600000 }, env.GOOGLE_TOKEN_ENCRYPTION_KEY);
    const destination = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    for (const [key, value] of Object.entries({
      access_type: "offline", client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
      prompt: "consent", redirect_uri: callbackUrl(env, request.url),
      response_type: "code", scope: SCOPE, state,
    })) destination.searchParams.set(key, value);
    return json({ authorizationUrl: destination.href }, 200, { "Set-Cookie": cookie(pending, 600, url.protocol === "https:") });
  }
  if (url.pathname === "/api/google-drive/disconnect" && request.method === "POST") {
    const response = await tableFetch(env, auth.accessToken, `?user_id=eq.${encodeURIComponent(auth.user.id)}`, { method: "DELETE" }, fetchFn);
    if (!response.ok) return googleError("Не удалось отключить Google Drive", response);
    return json({ connected: false });
  }
  if (url.pathname === "/api/google-drive/upload-start" && request.method === "POST") {
    if (!configured(env)) return json({ error: "not_configured", message: "Google Drive не настроен на сервере" }, 503);
    const connection = await readConnection(env, auth, fetchFn);
    if (!connection) return json({ error: "not_connected", message: "Подключите Google Drive" }, 409);
    const payload = await request.json().catch(() => null);
    const name = String(payload?.name || "").trim().slice(0, 240);
    const mime = String(payload?.mime || "application/octet-stream").trim().slice(0, 120);
    const size = Number(payload?.size);
    if (!name || !Number.isSafeInteger(size) || size < 1 || size > 5 * 1024 * 1024 * 1024) {
      return json({ error: "invalid_file", message: "Укажите файл размером до 5 ГБ" }, 400);
    }
    try {
      const token = await googleToken(env, connection, fetchFn);
      const folderId = connection.folder_id || await ensureFolder(env, auth, token, fetchFn);
      const response = await fetchFn("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(size),
        },
        body: JSON.stringify({ name, parents: [folderId] }),
      });
      const sessionUrl = response.headers.get("Location");
      if (!response.ok || !validSessionUrl(sessionUrl)) return googleError("Не удалось начать загрузку", response);
      const session = await encryptJson({ url: sessionUrl, userId: auth.user.id, size, expiresAt: Date.now() + 23 * 60 * 60 * 1000 }, env.GOOGLE_TOKEN_ENCRYPTION_KEY);
      return json({ session, chunkSize: MAX_CHUNK });
    } catch (error) { return json({ error: "drive_failed", message: safeError(error) }, 502); }
  }
  if (url.pathname === "/api/google-drive/upload-chunk" && request.method === "PUT") {
    let session;
    try { session = await decryptJson(request.headers.get("X-Upload-Session"), env.GOOGLE_TOKEN_ENCRYPTION_KEY); }
    catch { return json({ error: "invalid_session", message: "Сессия загрузки недействительна" }, 400); }
    if (session?.userId !== auth.user.id || session.expiresAt < Date.now() || !validSessionUrl(session.url)) {
      return json({ error: "invalid_session", message: "Сессия загрузки истекла" }, 403);
    }
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(request.headers.get("Content-Range") || "");
    if (!range || Number(range[3]) !== session.size || Number(range[2]) < Number(range[1]) || Number(range[2]) - Number(range[1]) + 1 > MAX_CHUNK) {
      return json({ error: "invalid_range", message: "Некорректный фрагмент файла" }, 400);
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength !== Number(range[2]) - Number(range[1]) + 1) return json({ error: "invalid_range" }, 400);
    try {
      const connection = await readConnection(env, auth, fetchFn);
      if (!connection) return json({ error: "not_connected" }, 409);
      const token = await googleToken(env, connection, fetchFn);
      const response = await fetchFn(session.url, {
        method: "PUT", redirect: "manual",
        headers: { Authorization: `Bearer ${token}`, "Content-Range": `bytes ${range[1]}-${range[2]}/${range[3]}`, "Content-Type": "application/octet-stream" },
        body: bytes,
      });
      if (response.status === 308) return json({ complete: false, next: receivedBytes(response.headers.get("Range")) });
      if (!response.ok) return googleError("Не удалось загрузить файл", response);
      return finishedFile(response, session.size);
    } catch (error) { return json({ error: "drive_failed", message: safeError(error) }, 502); }
  }
  if (url.pathname === "/api/google-drive/upload-status" && request.method === "POST") {
    const payload = await request.json().catch(() => null);
    let session;
    try { session = await decryptJson(payload?.session, env.GOOGLE_TOKEN_ENCRYPTION_KEY); }
    catch { return json({ error: "invalid_session", message: "Сессия загрузки недействительна" }, 400); }
    if (session?.userId !== auth.user.id || session.expiresAt < Date.now() || !validSessionUrl(session.url)) return json({ error: "invalid_session" }, 403);
    try {
      const connection = await readConnection(env, auth, fetchFn);
      if (!connection) return json({ error: "not_connected" }, 409);
      const token = await googleToken(env, connection, fetchFn);
      const response = await fetchFn(session.url, {
        method: "PUT", redirect: "manual",
        headers: { Authorization: `Bearer ${token}`, "Content-Range": `bytes */${session.size}` },
        body: new Uint8Array(0),
      });
      if (response.status === 308) return json({ complete: false, next: receivedBytes(response.headers.get("Range")) });
      if (!response.ok) return googleError("Не удалось проверить загрузку", response);
      return finishedFile(response, session.size);
    } catch (error) { return json({ error: "drive_failed", message: safeError(error) }, 502); }
  }
  return json({ error: "not_found" }, 404);
}

async function callback(request, env, fetchFn) {
  if (!configured(env)) return redirect(env, request.url, "not_configured");
  const url = new URL(request.url);
  let pending;
  try { pending = await decryptJson(readCookie(request.headers.get("Cookie")), env.GOOGLE_TOKEN_ENCRYPTION_KEY); }
  catch { return redirect(env, request.url, "invalid_state"); }
  if (!pending?.accessToken || !pending?.userId || pending.expiresAt < Date.now() || pending.state !== url.searchParams.get("state")) return redirect(env, request.url, "invalid_state");
  if (url.searchParams.get("error") || !url.searchParams.get("code")) return redirect(env, request.url, "access_denied");
  const auth = await authenticateSupabaseRequest(new Request(request.url, { headers: { Authorization: `Bearer ${pending.accessToken}` } }), {
    anonKey: publicSupabaseKey(env), fetch: fetchFn, supabaseUrl: env.SUPABASE_URL,
  });
  if (!auth || auth.user.id !== pending.userId) return redirect(env, request.url, "session_expired");
  const response = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CALENDAR_CLIENT_ID, client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET, code: url.searchParams.get("code"), grant_type: "authorization_code", redirect_uri: callbackUrl(env, request.url) }),
  });
  const tokens = await response.json().catch(() => null);
  if (!response.ok || !tokens?.refresh_token || (tokens.scope && !String(tokens.scope).split(" ").includes(SCOPE))) return redirect(env, request.url, "token_exchange_failed");
  const previous = await readConnection(env, auth, fetchFn).catch(() => null);
  const stored = await tableFetch(env, pending.accessToken, "?on_conflict=user_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: pending.userId, encrypted_refresh_token: await encryptText(tokens.refresh_token, env.GOOGLE_TOKEN_ENCRYPTION_KEY), folder_id: previous?.folder_id || "", updated_at: new Date().toISOString() }),
  }, fetchFn);
  if (!stored.ok) return redirect(env, request.url, "save_failed");
  return redirect(env, request.url, "connected");
}

async function readConnection(env, auth, fetchFn) {
  const response = await tableFetch(env, auth.accessToken, `?user_id=eq.${encodeURIComponent(auth.user.id)}&select=encrypted_refresh_token,folder_id`, { method: "GET" }, fetchFn);
  if (!response.ok) throw new Error("Не удалось прочитать подключение Google Drive. Проверьте схему Supabase.");
  return (await response.json())[0] || null;
}

async function ensureFolder(env, auth, token, fetchFn) {
  const response = await fetchFn("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Parsitasks", mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!response.ok) throw new Error("Не удалось создать папку Parsitasks в Google Drive");
  const folder = await response.json();
  if (!folder?.id) throw new Error("Google Drive не вернул папку");
  const stored = await tableFetch(env, auth.accessToken, `?user_id=eq.${encodeURIComponent(auth.user.id)}`, {
    method: "PATCH", body: JSON.stringify({ folder_id: folder.id, updated_at: new Date().toISOString() }),
  }, fetchFn);
  if (!stored.ok) throw new Error("Не удалось сохранить папку Google Drive");
  return folder.id;
}

async function googleToken(env, connection, fetchFn) {
  const refreshToken = await decryptText(connection.encrypted_refresh_token, env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  const response = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CALENDAR_CLIENT_ID, client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) throw new Error("Доступ к Google Drive истёк. Подключите его заново.");
  return data.access_token;
}

function tableFetch(env, accessToken, query, options, fetchFn) {
  return fetchFn(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/${TABLE}${query}`, {
    ...options, headers: { apikey: publicSupabaseKey(env), Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
}

function configured(env) {
  return Boolean(env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET && String(env.GOOGLE_TOKEN_ENCRYPTION_KEY || "").length >= 32 && env.SUPABASE_URL && publicSupabaseKey(env));
}

async function finishedFile(response, size) {
  const file = await response.json().catch(() => null);
  if (!file?.id) return json({ error: "drive_failed", message: "Google Drive не вернул файл" }, 502);
  return json({ complete: true, file: { id: file.id, name: file.name, mime: file.mimeType, size: Number(file.size) || size, url: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view` } });
}
function receivedBytes(range) { const match = /^bytes=0-(\d+)$/.exec(String(range || "")); return match ? Number(match[1]) + 1 : 0; }
function callbackUrl(env, requestUrl) { return `${origin(env, requestUrl)}/api/google-drive/callback`; }
function origin(env, requestUrl) {
  const requestOrigin = new URL(requestUrl).origin;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestOrigin) ? requestOrigin : String(env.APP_BASE_URL || requestOrigin).replace(/\/+$/, "");
}
function redirect(env, requestUrl, result) {
  return new Response(null, { status: 302, headers: { Location: `${origin(env, requestUrl)}/app?googleDrive=${encodeURIComponent(result)}#study`, "Set-Cookie": cookie("", 0, new URL(requestUrl).protocol === "https:"), "Cache-Control": "no-store" } });
}
function cookie(value, age, secure) { return `${COOKIE}=${value}; Path=/api/google-drive; Max-Age=${age}; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax`; }
function readCookie(header) { return String(header || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || ""; }
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function validSessionUrl(value) { try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "www.googleapis.com" && url.pathname === "/upload/drive/v3/files"; } catch { return false; } }
function safeError(error) { return String(error?.message || "Ошибка Google Drive").slice(0, 240); }
async function googleError(message, response) { const data = await response.json().catch(() => null); return json({ error: "drive_failed", message: `${message}: ${String(data?.error?.message || response.statusText).slice(0, 180)}` }, 502); }
function json(value, status = 200, extra = {}) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } }); }
