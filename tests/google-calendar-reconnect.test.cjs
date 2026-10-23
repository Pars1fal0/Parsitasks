const assert = require("node:assert/strict");
const { createGoogleCalendarController } = require("../app/src/integrations/google-calendar-controller.js");

function controller(api) {
  const els = {
    googleCalendarConnect: { hidden: false, textContent: "Подключить Google Calendar", addEventListener() {} },
    googleCalendarDisconnect: { hidden: true, addEventListener() {} },
    googleCalendarSync: { hidden: true, disabled: false, textContent: "", addEventListener() {} },
    googleCalendarStatus: { textContent: "" },
  };
  const toasts = [];
  const instance = createGoogleCalendarController({
    api, els,
    formatDate: (value) => value,
    getAccessToken: () => "token",
    getState: () => ({ tasks: [], categories: [], googleCalendarLinks: {} }),
    getTimeZone: () => "UTC",
    showToast: (message) => toasts.push(message),
  });
  return { els, instance, toasts };
}

module.exports = [
  {
    name: "expired Google access offers a one-step reconnect while staying connected",
    async fn() {
      const { els, instance } = controller({
        status: async () => ({ configured: true, connected: true, lastError: "Доступ Google истёк. Отключите календарь и подключите его снова" }),
      });
      await instance.refreshStatus();
      assert.equal(els.googleCalendarConnect.hidden, false);
      assert.equal(els.googleCalendarConnect.textContent, "Переподключить Google Calendar");
      assert.equal(els.googleCalendarDisconnect.hidden, false);
    },
  },
  {
    name: "a reauthorization error from sync shows reconnect, a healthy connection hides it",
    async fn() {
      let fail = true;
      const { els, instance } = controller({
        status: async () => ({ configured: true, connected: true, lastError: "" }),
        sync: async () => {
          if (fail) throw Object.assign(new Error("Доступ Google истёк"), { code: "reauthorization_required", status: 502 });
          return { connected: true, links: {}, summary: {}, upserts: [], deletions: [] };
        },
      });
      await instance.refreshStatus();
      assert.equal(els.googleCalendarConnect.hidden, true);
      await instance.sync({ silent: true });
      assert.equal(els.googleCalendarConnect.hidden, false);
      assert.equal(els.googleCalendarConnect.textContent, "Переподключить Google Calendar");
      fail = false;
      await instance.sync({ silent: true });
      assert.equal(els.googleCalendarConnect.hidden, true);
      assert.equal(els.googleCalendarConnect.textContent, "Подключить Google Calendar");
    },
  },
  {
    name: "server reports revoked Google access as reauthorization_required",
    async fn() {
      const calendar = await import("../mcp/google-calendar.mjs");
      const env = {
        APP_BASE_URL: "https://example.test", GOOGLE_CALENDAR_CLIENT_ID: "client", GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
        GOOGLE_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef", SUPABASE_URL: "https://synthetic.supabase.co", SUPABASE_PUBLISHABLE_KEY: "public",
      };
      const encrypted = await calendar.encryptText("revoked-token", env.GOOGLE_TOKEN_ENCRYPTION_KEY);
      const fetch = async (input, options = {}) => {
        const url = String(input);
        if (url.endsWith("/auth/v1/user")) return Response.json({ id: "user" });
        if (url.includes("/rest/v1/google_calendar_connections")) return (options.method || "GET") === "GET" ? Response.json([{ encrypted_refresh_token: encrypted, calendar_id: "primary", direction: "export" }]) : new Response(null, { status: 204 });
        if (url === "https://oauth2.googleapis.com/token") return Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 });
        throw new Error(`Unexpected request ${url}`);
      };
      const response = await calendar.handleGoogleCalendarRequest(new Request("https://example.test/api/google-calendar/sync", {
        method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: JSON.stringify({ tasks: [] }),
      }), env, { fetch });
      const data = await response.json();
      assert.equal(data.error, "reauthorization_required");
      assert.match(data.message, /Переподключить Google Calendar/);
    },
  },
];
