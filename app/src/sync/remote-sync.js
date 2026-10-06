(function (global) {
  function createRemoteSync(options = {}) {
    const fetchFn = options.fetch || global.fetch?.bind(global);
    const tableName = options.tableName || "rhythm_states";
    const now = options.now || (() => Date.now());
    const maxClockSkewMs = Math.max(60_000, Number(options.maxClockSkewMs) || 10 * 60_000);
    const requestTimeoutMs = Math.max(100, Math.min(60_000, Number(options.requestTimeoutMs) || 30_000));

    function currentSchemaVersion() {
      const api = global.RhythmDocumentState
        || (typeof require === "function" ? require("../core/document-state.js") : null);
      return api.SCHEMA_VERSION;
    }

    function normalizeConfig(config = {}) {
      return {
        enabled: config.enabled === true,
        supabaseUrl: stripTrailingSlash(String(config.supabaseUrl || "").trim()),
        anonKey: String(config.anonKey || "").trim(),
        accessToken: String(config.accessToken || "").trim(),
        userId: String(config.userId || "").trim(),
      };
    }

    function isConfigured(config = {}) {
      const normalized = normalizeConfig(config);
      return Boolean(
        normalized.enabled &&
        normalized.supabaseUrl &&
        normalized.anonKey &&
        normalized.accessToken &&
        normalized.userId,
      );
    }

    async function pushState(config, payload = {}) {
      ensureFetch();
      const normalized = normalizeConfig(config);
      ensureConfigured(normalized);
      const clientUpdatedAt = payload.clientUpdatedAt || new Date().toISOString();
      const body = {
        user_key: `auth:${normalized.userId}`,
        user_id: normalized.userId,
        state: payload.state || {},
        ui_state: payload.uiState || {},
        schema_version: payload.schemaVersion || payload.state?.schemaVersion || currentSchemaVersion(),
        client_updated_at: clientUpdatedAt,
      };
      ensureSupportedSchema(body);
      const conflictColumn = "user_id";
      const stateBytes = new TextEncoder().encode(JSON.stringify(body.state)).byteLength;
      const uiBytes = new TextEncoder().encode(JSON.stringify(body.ui_state)).byteLength;
      if (stateBytes > 4 * 1024 * 1024 || uiBytes > 256 * 1024) {
        throw Object.assign(new Error("Объём данных превышает лимит синхронизации. Экспортируй JSON и освободи место, локальные записи сохранены."), { code: "workspace-too-large" });
      }
      const expectedUpdatedAt = String(payload.expectedUpdatedAt || "").trim();
      const expectMissing = payload.expectMissing === true;
      const updateFilter = expectedUpdatedAt
        ? `${identityFilter(normalized)}&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}&select=updated_at,client_updated_at,state,ui_state,schema_version`
        : `on_conflict=${conflictColumn}`;
      const response = await request(`${normalized.supabaseUrl}/rest/v1/${tableName}?${updateFilter}`, {
        method: expectedUpdatedAt ? "PATCH" : "POST",
        headers: supabaseHeaders(normalized, {
          Prefer: expectedUpdatedAt
            ? "return=representation"
            : `${expectMissing ? "resolution=ignore-duplicates" : "resolution=merge-duplicates"},return=representation`,
        }),
        body: JSON.stringify(body),
      });

      ensureClockSafe(response);
      const data = await readResponse(response);
      if (!response.ok) throw createRemoteError("push-failed", response, data);
      if ((expectedUpdatedAt || expectMissing) && (!Array.isArray(data) || data.length === 0)) {
        const error = new Error("Remote state changed while saving");
        error.code = "sync-conflict";
        error.status = 409;
        throw error;
      }
      return { ok: true, clientUpdatedAt, row: Array.isArray(data) ? data[0] : data };
    }

    async function pullState(config) {
      ensureFetch();
      const normalized = normalizeConfig(config);
      ensureConfigured(normalized);
      const filter = identityFilter(normalized);
      const select = "select=state,ui_state,schema_version,client_updated_at,updated_at";
      const response = await request(`${normalized.supabaseUrl}/rest/v1/${tableName}?${select}&${filter}&limit=1`, {
        method: "GET",
        headers: supabaseHeaders(normalized),
      });

      ensureClockSafe(response);
      const data = await readResponse(response);
      if (!response.ok) throw createRemoteError("pull-failed", response, data);
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return { ok: true, found: false };
      ensureSupportedSchema(row);
      return {
        ok: true,
        found: true,
        row,
        state: row.state || null,
        uiState: row.ui_state || {},
        clientUpdatedAt: row.client_updated_at || "",
        updatedAt: row.updated_at || "",
      };
    }

    async function checkConnection(config) {
      ensureFetch();
      const normalized = normalizeConfig(config);
      ensureConfigured(normalized);
      const filter = identityFilter(normalized);
      const response = await request(`${normalized.supabaseUrl}/rest/v1/${tableName}?select=user_key,user_id,client_updated_at&${filter}&limit=1`, {
        method: "GET",
        headers: supabaseHeaders(normalized),
      });

      ensureClockSafe(response);
      const data = await readResponse(response);
      if (!response.ok) throw createRemoteError("check-failed", response, data);
      const row = Array.isArray(data) ? data[0] : null;
      return { found: Boolean(row), ok: true, row };
    }

    async function listSnapshots(config, limit = 10) {
      ensureFetch();
      const normalized = normalizeConfig(config);
      ensureConfigured(normalized);
      const safeLimit = Math.max(1, Math.min(30, Number(limit) || 10));
      const query = `select=id,schema_version,summary,created_at&user_id=eq.${encodeURIComponent(normalized.userId)}&order=created_at.desc&limit=${safeLimit}`;
      const response = await request(`${normalized.supabaseUrl}/rest/v1/rhythm_state_snapshots?${query}`, {
        headers: supabaseHeaders(normalized),
      });
      const data = await readResponse(response);
      if (!response.ok) throw createRemoteError("snapshots-failed", response, data);
      return { ok: true, snapshots: Array.isArray(data) ? data : [] };
    }

    async function getSnapshot(config, snapshotId) {
      ensureFetch();
      const normalized = normalizeConfig(config);
      ensureConfigured(normalized);
      const id = String(snapshotId || "").trim();
      if (!/^\d+$/.test(id)) throw new Error("Snapshot is not selected");
      const query = `select=state,schema_version,summary,created_at&id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(normalized.userId)}&limit=1`;
      const response = await request(`${normalized.supabaseUrl}/rest/v1/rhythm_state_snapshots?${query}`, {
        headers: supabaseHeaders(normalized),
      });
      const data = await readResponse(response);
      if (!response.ok) throw createRemoteError("snapshot-read-failed", response, data);
      const snapshot = Array.isArray(data) ? data[0] : null;
      if (!snapshot?.state) throw new Error("Snapshot is not available");
      ensureSupportedSchema(snapshot);
      return { ok: true, snapshot };
    }

    async function restoreSnapshot(config, snapshotId) {
      const normalized = normalizeConfig(config);
      ensureConfigured(normalized);
      const id = String(snapshotId || "").trim();
      if (!/^\d+$/.test(id)) throw new Error("Snapshot is not selected");
      // Snapshot rows are immutable to clients; validate the chosen schema before any write.
      await getSnapshot(normalized, id);
      const current = await pullState(normalized);
      if (!current.found || !current.updatedAt) throw new Error("Сначала сохрани текущее пространство в облаке");
      const response = await request(`${normalized.supabaseUrl}/rest/v1/rpc/restore_parsitasks_snapshot`, {
        method: "POST",
        headers: supabaseHeaders(normalized),
        body: JSON.stringify({ snapshot_id: id, expected_updated_at: current.updatedAt }),
      });
      const data = await readResponse(response);
      if (!response.ok) {
        if (data?.code === "40001") throw Object.assign(new Error("Облако изменилось. Загрузи список версий и повтори восстановление."), { code: "sync-conflict", status: 409 });
        throw createRemoteError("snapshot-restore-failed", response, data);
      }
      if (!data?.snapshot?.state || !data?.row?.updated_at) throw new Error("Сервер не подтвердил восстановление версии");
      return { ok: true, snapshot: data.snapshot, saved: { ok: true, row: data.row } };
    }

    function ensureSupportedSchema(row) {
      const version = Math.max(Number(row?.schema_version) || 0, Number(row?.state?.schemaVersion) || 0);
      if (version > currentSchemaVersion()) {
        throw Object.assign(new Error("Данные созданы более новой версией Parsitasks. Обнови приложение перед синхронизацией; локальные записи сохранены."), { code: "client-outdated" });
      }
    }

    async function deleteAccount(config) {
      ensureFetch();
      const normalized = normalizeConfig(config);
      ensureConfigured(normalized);
      await removeAccountImages(normalized);
      const response = await request(`${normalized.supabaseUrl}/rest/v1/rpc/delete_parsitasks_account`, {
        method: "POST",
        headers: supabaseHeaders(normalized),
        body: "{}",
      });
      const data = await readResponse(response);
      if (!response.ok) throw createRemoteError("account-delete-failed", response, data);
      return { ok: true };
    }

    async function removeAccountImages(config) {
      if (!/^[a-zA-Z0-9_-]+$/.test(config.userId)) throw new Error("Invalid account identity");
      const folders = [config.userId], files = [];
      for (let index = 0; index < folders.length; index++) {
        if (folders.length > 1000) throw new Error("Слишком много папок. Обратись в поддержку перед удалением аккаунта.");
        const prefix = folders[index];
        for (let offset = 0; ; offset += 100) {
          const response = await request(`${config.supabaseUrl}/storage/v1/object/list/board-images`, {
            method: "POST", headers: supabaseHeaders(config),
            body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
          });
          const rows = await readResponse(response);
          if (!response.ok) throw createRemoteError("account-storage-list-failed", response, rows);
          if (!Array.isArray(rows) || rows.length > 100) throw new Error("Сервер не подтвердил список файлов аккаунта");
          for (const row of rows) {
            if (typeof row?.name !== "string" || !row.name || /[\/\\\0]/.test(row.name) || [".", ".."].includes(row.name)) throw new Error("Некорректный путь файла. Удаление аккаунта остановлено.");
            const name = `${prefix}/${row.name}`;
            if (row.id === null) folders.push(name);
            else if (typeof row.id === "string" && row.id) files.push(name);
            else throw new Error("Некорректный список файлов. Удаление аккаунта остановлено.");
          }
          if (files.length > 10000 || offset >= 10000) throw new Error("Слишком много файлов. Обратись в поддержку перед удалением аккаунта.");
          if (rows.length < 100) break;
        }
      }
      // Enumerate first: deleting while paginating would skip later files.
      for (let index = 0; index < files.length; index += 100) {
        const response = await request(`${config.supabaseUrl}/storage/v1/object/board-images`, {
          method: "DELETE", headers: supabaseHeaders(config),
          body: JSON.stringify({ prefixes: files.slice(index, index + 100) }),
        });
        const data = await readResponse(response);
        if (!response.ok) throw createRemoteError("account-storage-delete-failed", response, data);
      }
    }

    function ensureFetch() {
      if (!fetchFn) throw new Error("Fetch API is not available for remote sync");
    }

    // Bound the whole request, including reading a response body that may stall.
    async function request(url, init) {
      const controller = new AbortController();
      const text = await withTimeout(async () => {
        const response = await fetchFn(url, { ...init, signal: controller.signal });
        const body = await response.text();
        return { response, body };
      }, controller);
      return { ok: text.response.ok, status: text.response.status, statusText: text.response.statusText,
        headers: text.response.headers, text: async () => text.body };
    }

    async function withTimeout(run, controller) {
      let timer;
      try {
        return await Promise.race([Promise.resolve().then(run), new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = Object.assign(new Error("Сервер не ответил вовремя"), { code: "request-timeout" });
            reject(error);
            controller.abort();
          }, requestTimeoutMs);
        })]);
      } finally {
        clearTimeout(timer);
      }
    }

    function ensureConfigured(config) {
      if (!isConfigured(config)) {
        throw new Error("Remote sync is not configured");
      }
    }

    function ensureClockSafe(response) {
      const serverDate = response?.headers?.get?.("date");
      if (!serverDate) return;
      const serverTime = Date.parse(serverDate);
      if (!Number.isFinite(serverTime) || Math.abs(now() - serverTime) <= maxClockSkewMs) return;
      const error = new Error("Device clock differs from the database server");
      error.code = "clock-skew";
      throw error;
    }

    function supabaseHeaders(config, extra = {}) {
      return {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
        ...extra,
      };
    }

    async function readResponse(response) {
      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    return {
      checkConnection,
      deleteAccount,
      getSnapshot,
      isConfigured,
      listSnapshots,
      normalizeConfig,
      pullState,
      pushState,
      restoreSnapshot,
    };
  }

  function identityFilter(config) {
    return `user_id=eq.${encodeURIComponent(config.userId)}`;
  }

  function createRemoteError(code, response, data) {
    const message = typeof data === "string" ? data : data?.message || data?.hint || response.statusText;
    const error = new Error(message || code);
    error.code = code;
    error.status = response.status;
    error.data = data;
    return error;
  }

  function stripTrailingSlash(value) {
    return value.replace(/\/+$/, "");
  }

  const api = { createRemoteSync, stripTrailingSlash };
  global.RhythmRemoteSync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
