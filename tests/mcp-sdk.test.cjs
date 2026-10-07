const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

module.exports = [
  { name: "patched MCP SDK negotiates the real Parsitasks tools and validates read results in memory", async fn() {
    const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
    const bundle = await require("esbuild").build({
      entryPoints: [path.resolve(__dirname, "../mcp/worker.mjs")],
      bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
      plugins: [{ name: "isolated-worker-adapter", setup(build) {
        build.onResolve({ filter: /^agents\/mcp$/ }, () => ({ path: "adapter", namespace: "isolated" }));
        build.onLoad({ filter: /.*/, namespace: "isolated" }, () => ({ contents: "export function createMcpHandler() { throw new Error('Cloudflare adapter is not exercised in this in-memory test'); }" }));
      } }],
    });
    const filename = path.join(__dirname, "synthetic-worker.cjs");
    const compiled = new Module(filename, module);
    compiled.filename = filename; compiled.paths = Module._nodeModulePaths(__dirname);
    compiled._compile(bundle.outputFiles[0].text, filename);
    const worker = compiled.exports.default;
    const env = { SUPABASE_URL: "https://synthetic.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
      TURNSTILE_SITE_KEY: "synthetic_site_key", TURNSTILE_SECRET_KEY: "must-not-leak",
      ASSETS: { fetch: async () => new Response("synthetic page", { headers: { "Content-Security-Policy": "default-src 'self'" } }) } };
    const configResponse = await worker.fetch(new Request("https://example.test/api/public-config"), env, {});
    assert.deepEqual(await configResponse.json(), { supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_PUBLISHABLE_KEY, turnstileSiteKey: env.TURNSTILE_SITE_KEY });
    for (const route of ["/auth", "/auth.html"]) {
      const response = await worker.fetch(new Request(`https://example.test${route}`), env, {});
      assert.match(response.headers.get("Content-Security-Policy"), /script-src 'self' https:\/\/challenges.cloudflare.com/);
    }
    const appResponse = await worker.fetch(new Request("https://example.test/app"), env, {});
    assert.equal(appResponse.headers.get("Content-Security-Policy"), "default-src 'self'", "CAPTCHA does not relax the workspace CSP");
    let state = require("../app/src/core/document-state.js").normalizeState({ tasks: [{ id: "synthetic", title: "Synthetic task", date: "2026-10-06", repeat: "none", completed: {} }], habits: [], goals: [] });
    const transfers = [], images = [];
    const server = compiled.exports.createParsitasksServer({ store: { read: async () => ({ state }), mutate: async (fn) => {
      const result = await fn(state); if (result.changed) state = result.state; return { ...result, saved: result.changed };
    } }, integrationRequest: async (route, input) => {
      transfers.push({ route, input });
      if (route.endsWith("status") && !route.endsWith("upload-status")) return Response.json({ configured: true, connected: true });
      if (route.endsWith("upload-start")) return Response.json({ session: "synthetic-session", chunkSize: 5 * 1024 * 1024 });
      return Response.json({ complete: true, file: { id: "synthetic-drive-file", name: "tiny.txt", size: 3, mime: "text/plain" } });
    }, readMaterial: async (file) => ({ fileId: file.id, contentAvailable: true, text: "Synthetic text" }),
    uploadBoardImage: async (assetId, bytes, mime) => { images.push({ assetId, bytes, mime }); return { assetId, mime, remotePath: `synthetic-user/${assetId}.png` }; } });
    const client = new Client({ name: "isolated-sdk-check", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.listTools();
      assert.ok(result.tools.some((tool) => tool.name === "get_today_overview"));
      assert.ok(result.tools.some((tool) => tool.name === "create_task"));
      assert.ok(result.tools.every((tool) => tool.inputSchema?.type === "object"));
      const names = result.tools.map((tool) => tool.name);
      assert.equal(names.length, new Set(names).size);
      const { WORKSPACE_TOOL_NAMES } = await import(require("node:url").pathToFileURL(path.resolve(__dirname, "../mcp/workspace-tools.mjs")).href);
      for (const name of [...WORKSPACE_TOOL_NAMES, "get_integration_status", "start_material_upload", "upload_material_chunk", "finish_material_upload", "read_study_material", "upload_board_image"]) {
        assert.ok(names.includes(name), name); assert.ok(result.tools.find((tool) => tool.name === name).annotations);
      }
      const overview = await client.callTool({ name: "get_today_overview", arguments: { date: "2026-10-06" } });
      assert.notEqual(overview.isError, true);
      assert.equal(overview.structuredContent.date, "2026-10-06");
      assert.equal(overview.structuredContent.tasks[0].id, "synthetic");
      const invalid = await client.callTool({ name: "get_today_overview", arguments: { date: 123 } });
      assert.equal(invalid.isError, true, "invalid input is rejected by the SDK");
      assert.equal(state.tasks.length, 1);
      const call = (name, args) => client.callTool({ name, arguments: args });
      const subject = await call("upsert_study_subject", { requestId: "sdk-subject-001", name: "Synthetic study" });
      assert.notEqual(subject.isError, true); const subjectId = subject.structuredContent.subject.id;
      const lesson = await call("upsert_study_lesson", { requestId: "sdk-lesson-001", subjectId, weekday: 5, startTime: "11:30", endTime: "13:00", lessonType: "practice" });
      assert.notEqual(lesson.isError, true);
      const homework = await call("upsert_homework", { requestId: "sdk-homework-001", subjectId, title: "Synthetic homework", dueDate: "2026-10-09", dueTime: "11:30", workDate: "2026-10-07" });
      assert.notEqual(homework.isError, true); assert.equal(homework.structuredContent.task.dueTime, "11:30");
      const note = await call("upsert_note", { requestId: "sdk-note-001", title: "Synthetic note", body: "Test text", subjectId });
      assert.notEqual(note.isError, true);
      assert.equal((await call("upsert_note", { requestId: "sdk-note-002", noteId: note.structuredContent.note.id, body: "New" })).isError, true);
      const card = await call("upsert_board_item", { requestId: "sdk-board-001", type: "link", sourceType: "note", sourceId: note.structuredContent.note.id });
      assert.notEqual(card.isError, true);
      const subtask = await call("change_subtask", { requestId: "sdk-subtask-001", taskId: homework.structuredContent.task.id, operation: "create", title: "Step", date: "2026-10-07" });
      assert.notEqual(subtask.isError, true); assert.equal(subtask.structuredContent.task.checklist.length, 1);
      const settings = await call("update_account_preferences", { requestId: "sdk-settings-001", preferences: { accentPreference: "#aabbcc" } });
      assert.notEqual(settings.isError, true);
      assert.equal((await call("update_account_preferences", { requestId: "sdk-settings-002", preferences: { journalAccess: { read: true } } })).isError, true);
      assert.equal((await call("delete_note", { requestId: "sdk-delete-001", noteId: note.structuredContent.note.id, confirm: false })).isError, true);
      const listed = await call("list_workspace_entities", { type: "note", limit: 1 });
      assert.equal(listed.structuredContent.total, 1);
      assert.equal((await call("upsert_study_lesson", { requestId: "sdk-foreign-001", subjectId: "other-account", weekday: 3, startTime: "10:00", endTime: "11:00" })).isError, true);
      const statuses = await call("get_integration_status", {}); assert.notEqual(statuses.isError, true);
      const beforeDenied = transfers.length;
      assert.equal((await call("start_material_upload", { name: "tiny.txt", mime: "text/plain", size: 3, confirm: false })).isError, true);
      assert.equal(transfers.length, beforeDenied);
      const uploaded = await call("upload_material_chunk", { requestId: "sdk-file-001", session: "synthetic-session", offset: 0, total: 3, base64: "YWJj", subjectId });
      assert.notEqual(uploaded.isError, true); assert.equal(state.studyFiles.length, 1);
      assert.equal(transfers.at(-1).input.headers["Content-Range"], "bytes 0-2/3");
      const finished = await call("finish_material_upload", { requestId: "sdk-file-001", session: "synthetic-session", subjectId });
      assert.notEqual(finished.isError, true); assert.equal(state.studyFiles.length, 1);
      assert.equal((await call("upload_material_chunk", { requestId: "sdk-file-002", session: "synthetic-session", offset: 1, total: 4, base64: "YWJj" })).isError, true);
      const textFile = await call("read_study_material", { fileId: state.studyFiles[0].id });
      assert.equal(textFile.structuredContent.text, "Synthetic text");
      assert.equal((await call("read_study_material", { fileId: "foreign-file" })).isError, true);
      const imageInput = { requestId: "sdk-image-001", mime: "image/png", name: "pixel.png", confirm: true,
        base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==" };
      const image = await call("upload_board_image", imageInput);
      assert.notEqual(image.isError, true); assert.equal(images.length, 1);
      assert.ok(image.structuredContent.item.remotePath.startsWith("synthetic-user/"));
      assert.notEqual((await call("upload_board_image", imageInput)).isError, true); assert.equal(images.length, 1);
      assert.equal((await call("upload_board_image", { ...imageInput, requestId: "sdk-image-002", confirm: false })).isError, true);
      state.profile.journalAccess = { read: false, write: true };
      state.journalEntries = [{ id: "private-entry", date: "2026-10-06", text: "Private past content", updatedAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" }];
      const appended = await call("append_journal_entry", { requestId: "sdk-journal-001", date: "2026-10-06", text: "New paragraph" });
      assert.notEqual(appended.isError, true); assert.ok(!JSON.stringify(appended).includes("Private past content"));
      assert.equal((await call("get_journal_revisions", { date: "2026-10-06" })).isError, true);
      state.profile.journalAccess.write = false;
      assert.equal((await call("undo_mcp_action", { actionId: appended.structuredContent.actionId })).isError, true);
    } finally {
      await client.close(); await server.close();
    }
  } },
];
