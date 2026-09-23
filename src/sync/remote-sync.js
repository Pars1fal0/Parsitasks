(function (global) {
  function createRemoteSync(options = {}) {
    const fetchFn = options.fetch || global.fetch?.bind(global);
    const tableName = options.tableName || "rhythm_states";
    const now = options.now || (() => Date.now());
    const maxClockSkewMs = Math.max(60_000, Number(options.maxClockSkewMs) || 10 * 60_000);

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
        schema_version: payload.schemaVersion || payload.state?.schemaVersion || 1,
        client_updated_at: clientUpdatedAt,
      };
      const conflictColumn = "user_id";
      const expectedUpdatedAt = String(payload.expectedUpdatedAt || "").trim();
      const expectMissing = payload.expectMissing === true;
      const updateFilter = expectedUpdatedAt
        ? `${identityFilter(normalized)}&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}&select=updated_at,client_updated_at,state,ui_state,schema_version`
        : `on_conflict=${conflictColumn}`;
      const response = await fetchFn(`${normalized.supabaseUrl}/rest/v1/${tableName}?${updateFilter}`, {
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
      const response = await fetchFn(`${normalized.supabaseUrl}/rest/v1/${tableName}?${select}&${filter}&limit=1`, {
        method: "GET",
        headers: supabaseHeaders(normalized),
      });

      ensureClockSafe(response);
      const data = await readResponse(response);
      if (!response.ok) throw createRemoteError("pull-failed", response, data);
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return { ok: true, found: false };
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
      const response = await fetchFn(`${normalized.supabaseUrl}/rest/v1/${tableName}?select=user_key,user_id,client_updated_at&${filter}&limit=1`, {
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
      const response = await fetchFn(`${normalized.supabaseUrl}/rest/v1/rhythm_state_snapshots?${query}`, {
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
      const response = await fetchFn(`${normalized.supabaseUrl}/rest/v1/rhythm_state_snapshots?${query}`, {
        headers: supabaseHeaders(normalized),
      });
      const data = await readResponse(response);
      if (!response.ok) throw createRemoteError("snapshot-read-failed", response, data);
      const snapshot = Array.isArray(data) ? data[0] : null;
      if (!snapshot?.state) throw new Error("Snapshot is not available");
      return { ok: true, snapshot };
    }

    async function restoreSnapshot(config, snapshotId) {
      const normalized = normalizeConfig(config);
      const { snapshot } = await getSnapshot(normalized, snapshotId);
      const current = await pullState(normalized);
      const saved = await pushState(normalized, {
        state: snapshot.state,
        schemaVersion: snapshot.schema_version,
        uiState: current.uiState || {},
        expectedUpdatedAt: current.updatedAt,
        expectMissing: !current.found,
      });
      return { ok: true, snapshot, saved };
    }

    async function deleteAccount(config) {
      ensureFetch();
      const normalized = normalizeConfig(config);
      ensureConfigured(normalized);
      const response = await fetchFn(`${normalized.supabaseUrl}/rest/v1/rpc/delete_parsitasks_account`, {
        method: "POST",
        headers: supabaseHeaders(normalized),
        body: "{}",
      });
      const data = await readResponse(response);
      if (!response.ok) throw createRemoteError("account-delete-failed", response, data);
      return { ok: true };
    }

    function ensureFetch() {
      if (!fetchFn) throw new Error("Fetch API is not available for remote sync");
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
