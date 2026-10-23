const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const documentState = require("../app/src/core/document-state.js");
const frontendActivity = require("../app/src/integrations/mcp-activity.js");
const { CONFLICT_MESSAGE } = require("../app/src/integrations/mcp-undo-merge.js");
const { buildCalendarTasks } = require("../app/src/integrations/google-calendar-occurrences.js");
const { createGoogleCalendarController } = require("../app/src/integrations/google-calendar-controller.js");

const root = path.resolve(__dirname, "..");

function taskState() {
  return documentState.normalizeState({ tasks: [{ id: "task-1", title: "Before", date: "2026-10-23", repeat: "none" }] });
}

function extractFunction(file, name, context = {}) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const body = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\r?\\n\\}`))[0];
  return vm.runInNewContext(`(${body})`, context);
}

module.exports = [
  {
    name: "undoing an MCP task edit keeps a later completion and restores only the edited field",
    async fn() {
      const write = await import("../mcp/write-service.mjs");
      const change = write.updateTaskCommand(taskState(), { requestId: "audit-task-change", taskId: "task-1", title: "MCP title" }, { now: "2026-10-23T09:00:00.000Z" });
      change.state.tasks[0].completed["2026-10-23"] = true;
      change.state.tasks[0].updatedAt = "2026-10-23T10:00:00.000Z";
      const backend = write.undoMcpCommand(change.state, { actionId: change.activity.id }, { now: "2026-10-23T11:00:00.000Z" });
      const frontend = frontendActivity.undoActivity(change.state, change.activity.id, "2026-10-23T11:00:00.000Z");
      for (const result of [backend, frontend]) {
        const task = result.state.tasks.find((item) => item.id === "task-1");
        assert.equal(task.title, "Before");
        assert.equal(task.completed["2026-10-23"], true);
        assert.equal(result.activity.status, "undone");
      }
    },
  },
  {
    name: "undoing an MCP edit is refused when the same field changed afterwards",
    async fn() {
      const write = await import("../mcp/write-service.mjs");
      const change = write.updateTaskCommand(taskState(), { requestId: "audit-task-retitle", taskId: "task-1", title: "MCP title" }, { now: "2026-10-23T09:00:00.000Z" });
      change.state.tasks[0].title = "User title";
      assert.throws(() => write.undoMcpCommand(change.state, { actionId: change.activity.id }, { now: "2026-10-23T11:00:00.000Z" }), { message: CONFLICT_MESSAGE });
      assert.throws(() => frontendActivity.undoActivity(change.state, change.activity.id, "2026-10-23T11:00:00.000Z"), { message: CONFLICT_MESSAGE });
      assert.equal(change.state.tasks[0].title, "User title");
    },
  },
  {
    name: "undoing an MCP diary append never removes later user text",
    async fn() {
      const write = await import("../mcp/write-service.mjs");
      const journal = await import("../mcp/journal-service.mjs");
      let diary = documentState.createEmptyState();
      diary = journal.appendJournalEntryCommand(diary, { requestId: "audit-diary-initial", date: "2026-10-23", text: "Original diary" }, { now: "2026-10-23T08:00:00.000Z" }).state;
      const appended = journal.appendJournalEntryCommand(diary, { requestId: "audit-diary-append", date: "2026-10-23", text: "MCP paragraph" }, { now: "2026-10-23T09:00:00.000Z" });

      const clean = write.undoMcpCommand(appended.state, { actionId: appended.activity.id }, { now: "2026-10-23T11:00:00.000Z" });
      assert.equal(clean.state.journalEntries[0].text, "Original diary");

      appended.state.journalEntries[0].text += "\n\nLater user text";
      assert.throws(() => write.undoMcpCommand(appended.state, { actionId: appended.activity.id }, { now: "2026-10-23T11:00:00.000Z" }), { message: CONFLICT_MESSAGE });
    },
  },
  {
    name: "legacy MCP actions without expected values refuse undo after later edits",
    async fn() {
      const write = await import("../mcp/write-service.mjs");
      const change = write.updateTaskCommand(taskState(), { requestId: "audit-legacy-edit", taskId: "task-1", title: "MCP title" }, { now: "2026-10-23T09:00:00.000Z" });
      const legacy = structuredClone(change.state);
      delete legacy.mcpActivity[0].inverse.entities.tasks.expected;
      legacy.mcpActivity[0].inverse.expectedTaskOrder = {};

      const untouched = write.undoMcpCommand(legacy, { actionId: change.activity.id }, { now: "2026-10-23T11:00:00.000Z" });
      assert.equal(untouched.state.tasks[0].title, "Before");

      legacy.tasks[0].completed["2026-10-23"] = true;
      legacy.tasks[0].updatedAt = "2026-10-23T10:00:00.000Z";
      assert.throws(() => write.undoMcpCommand(legacy, { actionId: change.activity.id }, { now: "2026-10-23T11:00:00.000Z" }), { message: CONFLICT_MESSAGE });
      assert.throws(() => frontendActivity.undoActivity(legacy, change.activity.id, "2026-10-23T11:00:00.000Z"), { message: CONFLICT_MESSAGE });
    },
  },
  {
    name: "a later task reorder does not block undo and keeps the user's order",
    async fn() {
      const write = await import("../mcp/write-service.mjs");
      const state = documentState.normalizeState({ tasks: [
        { id: "task-1", title: "First", date: "2026-10-23", repeat: "none" },
        { id: "task-2", title: "Second", date: "2026-10-23", repeat: "none" },
      ] });
      state.taskOrder["2026-10-23"] = ["task-1", "task-2"];
      const change = write.updateTaskCommand(state, { requestId: "audit-order-edit", taskId: "task-1", title: "MCP title" }, { now: "2026-10-23T09:00:00.000Z" });
      change.state.taskOrder["2026-10-23"] = ["task-2", "task-1"];
      const result = write.undoMcpCommand(change.state, { actionId: change.activity.id }, { now: "2026-10-23T11:00:00.000Z" });
      assert.equal(result.state.tasks.find((task) => task.id === "task-1").title, "First");
      assert.deepEqual(result.state.taskOrder["2026-10-23"], ["task-2", "task-1"]);
    },
  },
  {
    name: "calendar batch limit never marks existing linked occurrences as stale",
    fn() {
      const stamp = "2026-10-22T08:00:00.000Z";
      const tasks = Array.from({ length: 1001 }, (_, index) => ({
        id: `task-${String(index).padStart(4, "0")}`, title: "Task", date: "2026-10-23", repeat: "none",
        scheduleMode: "block", startTime: "10:00", endTime: "11:00", updatedAt: stamp,
      }));
      const links = {
        "task-1000": { eventId: "event-1000", localUpdatedAt: stamp, remoteUpdatedAt: stamp, syncedAt: stamp },
        "task-gone": { eventId: "event-gone", localUpdatedAt: stamp, remoteUpdatedAt: stamp, syncedAt: stamp, sourceTaskId: "task-0001" },
      };
      const payload = buildCalendarTasks({ categories: [], tasks, googleCalendarLinks: links }, { from: "2026-10-23", to: "2026-10-23" });
      assert.equal(payload.tasks.length, 1000);
      assert.equal(payload.skipped, 1);
      assert.deepEqual(payload.staleTaskIds, ["task-gone"]);
    },
  },
  {
    name: "calendar sync server never deletes events of tasks present in the batch",
    async fn() {
      const calendar = await import("../mcp/google-calendar.mjs");
      const stamp = "2026-10-22T08:00:00.000Z";
      const env = {
        APP_BASE_URL: "https://example.test", GOOGLE_CALENDAR_CLIENT_ID: "client", GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
        GOOGLE_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef", SUPABASE_URL: "https://synthetic.supabase.co", SUPABASE_PUBLISHABLE_KEY: "public",
      };
      const encrypted = await calendar.encryptText("refresh-token", env.GOOGLE_TOKEN_ENCRYPTION_KEY);
      const calls = [];
      const fetch = async (input, options = {}) => {
        const url = String(input);
        const method = options.method || "GET";
        calls.push({ url, method });
        if (url.endsWith("/auth/v1/user")) return Response.json({ id: "user" });
        if (url.includes("/rest/v1/google_calendar_connections")) return method === "GET" ? Response.json([{ encrypted_refresh_token: encrypted, calendar_id: "primary", direction: "export" }]) : new Response(null, { status: 204 });
        if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "google-token" });
        if (url.includes("/events?")) return Response.json({ items: [{ id: "event-1", updated: stamp, status: "confirmed" }] });
        if (method === "DELETE") return new Response(null, { status: 204 });
        if (method === "PATCH") return Response.json({ id: "event-1", updated: stamp });
        throw new Error(`Unexpected request ${method} ${url}`);
      };
      const task = { id: "task-1", title: "Task", date: "2026-10-23", startTime: "10:00", endTime: "11:00", updatedAt: stamp, priority: "medium" };
      const response = await calendar.handleGoogleCalendarRequest(new Request("https://example.test/api/google-calendar/sync", {
        method: "POST",
        headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
        body: JSON.stringify({ direction: "export", timeZone: "UTC", tasks: [task],
          links: { "task-1": { eventId: "event-1", localUpdatedAt: stamp, remoteUpdatedAt: stamp, syncedAt: stamp } }, outOfRangeTaskIds: ["task-1"] }),
      }), env, { fetch });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(calls.some((call) => call.method === "DELETE"), false);
      assert.equal((await response.json()).links["task-1"].eventId, "event-1");
    },
  },
  {
    name: "Google Calendar and Drive API responses carry CORS headers for the desktop app",
    async fn() {
      const source = fs.readFileSync(path.join(root, "mcp/worker.mjs"), "utf8");
      assert.match(source, /return withCors\(await handleGoogleCalendarRequest\(request, env\)\);/);
      assert.match(source, /return withCors\(await handleGoogleDriveRequest\(request, env\)\);/);
      const withCors = extractFunction("mcp/worker.mjs", "withCors", { Headers, Response });
      const ok = withCors(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
      assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "*");
      assert.equal(ok.headers.get("Content-Type"), "application/json");
      assert.equal(withCors(new Response("{}", { status: 401 })).headers.get("Access-Control-Allow-Origin"), "*");
      const isGoogleApiPath = extractFunction("mcp/worker.mjs", "isGoogleApiPath");
      assert.equal(isGoogleApiPath("/api/google-calendar/status"), true);
      assert.equal(isGoogleApiPath("/mcp"), false);
    },
  },
  {
    name: "desktop opens Google Drive materials externally and still blocks unsafe links",
    fn() {
      const source = fs.readFileSync(path.join(root, "desktop/main.cjs"), "utf8");
      const hosts = vm.runInNewContext(source.match(/new Set\(\[[^\]]*"drive\.google\.com"[^\]]*\]\)/)[0], { Set });
      const allowed = extractFunction("desktop/main.cjs", "isAllowedExternalUrl", { URL, EXTERNAL_HOSTS: hosts });
      assert.equal(allowed("https://drive.google.com/file/d/synthetic/view"), true);
      assert.equal(allowed("https://docs.google.com/document/d/synthetic/edit"), true);
      assert.equal(allowed("https://parsitasks.ru/app#settings"), true);
      assert.equal(allowed("http://drive.google.com/file/d/synthetic/view"), false);
      assert.equal(allowed("https://drive.google.com.evil.test/"), false);
      assert.equal(allowed("javascript:alert(1)"), false);
    },
  },
  {
    name: "desktop hands Google Calendar connection off to the web version",
    async fn() {
      const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
      const previousOpen = globalThis.open;
      const opened = [];
      const toasts = [];
      let connectCalls = 0;
      let onConnect = null;
      Object.defineProperty(globalThis, "location", { configurable: true, value: { protocol: "file:", origin: "null", href: "file:///app/index.html" } });
      globalThis.open = (...args) => { opened.push(args); };
      try {
        const controller = createGoogleCalendarController({
          api: { connect: async () => { connectCalls += 1; return { authorizationUrl: "https://accounts.google.com/" }; } },
          els: { googleCalendarConnect: { addEventListener: (type, handler) => { if (type === "click") onConnect = handler; } } },
          getAccessToken: () => "token",
          showToast: (message) => toasts.push(message),
        });
        controller.bindEvents();
        await onConnect();
        assert.equal(connectCalls, 0);
        assert.equal(opened[0][0], "https://parsitasks.ru/app#settings");
        assert.match(toasts[0], /веб-версии/);
      } finally {
        if (previousLocation) Object.defineProperty(globalThis, "location", previousLocation);
        else delete globalThis.location;
        globalThis.open = previousOpen;
      }
    },
  },
];
