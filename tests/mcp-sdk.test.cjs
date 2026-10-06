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
    const state = { tasks: [{ id: "synthetic", title: "Synthetic task", date: "2026-10-06", repeat: "none", completed: {} }], habits: [], goals: [] };
    const server = compiled.exports.createParsitasksServer({ store: { read: async () => ({ state }), write: async () => { throw new Error("No database writes allowed"); } } });
    const client = new Client({ name: "isolated-sdk-check", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.listTools();
      assert.ok(result.tools.some((tool) => tool.name === "get_today_overview"));
      assert.ok(result.tools.some((tool) => tool.name === "create_task"));
      assert.ok(result.tools.every((tool) => tool.inputSchema?.type === "object"));
      const overview = await client.callTool({ name: "get_today_overview", arguments: { date: "2026-10-06" } });
      assert.notEqual(overview.isError, true);
      assert.equal(overview.structuredContent.date, "2026-10-06");
      assert.equal(overview.structuredContent.tasks[0].id, "synthetic");
      const invalid = await client.callTool({ name: "get_today_overview", arguments: { date: 123 } });
      assert.equal(invalid.isError, true, "invalid input is rejected by the SDK");
      assert.equal(state.tasks.length, 1);
    } finally {
      await client.close(); await server.close();
    }
  } },
];
