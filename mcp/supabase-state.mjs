import { createEmptyState } from "./task-service.mjs";
import documentState from "../app/src/core/document-state.js";

export function createSupabaseStateStore(options) {
  const fetchFn = options.fetch || fetch;
  const supabaseUrl = String(options.supabaseUrl || "").trim().replace(/\/+$/, "");
  const anonKey = String(options.anonKey || "").trim();
  const accessToken = String(options.accessToken || "").trim();
  const userId = String(options.userId || "").trim();
  if (!supabaseUrl || !anonKey || !accessToken || !userId) throw new Error("Supabase MCP store is not configured");

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  async function read() {
    const select = "select=state,schema_version,client_updated_at,updated_at";
    const filter = `user_id=eq.${encodeURIComponent(userId)}`;
    const response = await fetchFn(`${supabaseUrl}/rest/v1/rhythm_states?${select}&${filter}&limit=1`, {
      headers,
    });
    const data = await readJson(response);
    if (!response.ok) throw remoteError("Не удалось прочитать данные Parsitasks", response, data);
    const row = Array.isArray(data) ? data[0] : null;
    return {
      found: Boolean(row),
      row,
      state: row?.state && typeof row.state === "object" ? row.state : createEmptyState(),
    };
  }

  async function mutate(mutator, maxAttempts = 4) {
    let lastConflict = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const snapshot = await read();
      const mutation = await mutator(snapshot.state);
      if (!mutation?.changed) return { ...mutation, saved: false };
      if (new TextEncoder().encode(JSON.stringify(mutation.state)).byteLength > 4 * 1024 * 1024) throw new Error("Превышен лимит данных Parsitasks (4 МБ). Изменение не сохранено.");
      const clientUpdatedAt = new Date().toISOString();
      const payload = {
        state: mutation.state,
        schema_version: Number(mutation.state?.schemaVersion) || documentState.SCHEMA_VERSION,
        client_updated_at: clientUpdatedAt,
      };

      if (!snapshot.found) {
        const response = await fetchFn(`${supabaseUrl}/rest/v1/rhythm_states?on_conflict=user_id`, {
          method: "POST",
          headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" },
          body: JSON.stringify({
            user_key: `auth:${userId}`,
            user_id: userId,
            ui_state: {},
            ...payload,
          }),
        });
        const data = await readJson(response);
        if (!response.ok) throw remoteError("Не удалось создать хранилище Parsitasks", response, data);
        if (Array.isArray(data) && data.length) return { ...mutation, saved: true, row: data[0] };
        lastConflict = new Error("Данные были созданы другим устройством");
        continue;
      }

      const filter = [
        `user_id=eq.${encodeURIComponent(userId)}`,
        `updated_at=eq.${encodeURIComponent(snapshot.row.updated_at)}`,
        "select=updated_at,client_updated_at",
      ].join("&");
      const response = await fetchFn(`${supabaseUrl}/rest/v1/rhythm_states?${filter}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });
      const data = await readJson(response);
      if (!response.ok) throw remoteError("Не удалось сохранить изменения Parsitasks", response, data);
      if (Array.isArray(data) && data.length) return { ...mutation, saved: true, row: data[0] };
      lastConflict = new Error("Данные изменились на другом устройстве");
    }

    const error = lastConflict || new Error("Не удалось сохранить изменение после нескольких попыток");
    error.code = "sync-conflict";
    throw error;
  }

  return { mutate, read };
}

export async function authenticateSupabaseRequest(request, options) {
  const accessToken = bearerToken(request.headers.get("Authorization"));
  if (!accessToken) return null;
  const supabaseUrl = String(options.supabaseUrl || "").trim().replace(/\/+$/, "");
  const anonKey = String(options.anonKey || "").trim();
  if (!supabaseUrl || !anonKey) throw new Error("Supabase OAuth is not configured");
  const response = await (options.fetch || fetch)(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) return null;
  const user = await response.json();
  if (!user?.id) return null;
  return { accessToken, user };
}

function bearerToken(value) {
  const match = /^Bearer\s+(.+)$/i.exec(String(value || "").trim());
  return match?.[1] || "";
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function remoteError(message, response, data) {
  const details = data?.message || data?.msg || data?.error_description || response.statusText;
  const error = new Error(details ? `${message}: ${details}` : message);
  error.status = response.status;
  return error;
}
