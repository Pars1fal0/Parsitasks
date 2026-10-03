const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

module.exports = [{ name: "builder downloader verifies a local artifact with the fetch-based dependency", async fn() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-downloader-"));
  const previousCache = process.env.ELECTRON_BUILDER_CACHE;
  process.env.ELECTRON_BUILDER_CACHE = directory;
  const body = Buffer.from("isolated downloader compatibility fixture");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": body.length }); response.end(body);
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { download } = require("app-builder-lib/out/binDownload.js");
    const file = path.join(directory, "result.bin");
    await download(`http://127.0.0.1:${server.address().port}/fixture.bin`, file, crypto.createHash("sha256").update(body).digest("hex"));
    assert.deepEqual(fs.readFileSync(file), body);
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    if (previousCache === undefined) delete process.env.ELECTRON_BUILDER_CACHE;
    else process.env.ELECTRON_BUILDER_CACHE = previousCache;
  }
} }];
