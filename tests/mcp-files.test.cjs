const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const load = (name) => import(pathToFileURL(path.resolve(__dirname, `../mcp/${name}.mjs`)).href);
module.exports = [
  { name: "MCP image uploads use only the authenticated owner's private path and reject MIME spoofing", async fn() {
    const { decodeBoardImage, createBoardImageUploader } = await load("board-image-service");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    const bytes = decodeBoardImage(png, "image/png");
    assert.throws(() => decodeBoardImage(png, "image/jpeg"), /MIME/);
    assert.throws(() => decodeBoardImage(Buffer.from("<svg>unsafe</svg>").toString("base64"), "image/svg+xml"), /PNG/);
    const calls = [];
    const upload = createBoardImageUploader({ supabaseUrl: "https://synthetic.supabase.co", anonKey: "synthetic-public", accessToken: "synthetic-user-token", userId: "synthetic-owner",
      fetchFn: async (url, request) => { calls.push({ url, request }); return Response.json({ Key: "synthetic" }); } });
    const item = await upload("synthetic-asset", bytes, "image/png");
    assert.equal(item.remotePath, "synthetic-owner/synthetic-asset.png");
    assert.match(calls[0].url, /\/board-images\/synthetic-owner\//); assert.equal(calls[0].request.headers["x-upsert"], "false");
    assert.equal(calls[0].request.headers.Authorization, "Bearer synthetic-user-token");
    await assert.rejects(() => upload("../other-owner/file", bytes, "image/png"), /идентификатор/);
    assert.equal(calls.length, 1);
  } },
  { name: "MCP Drive reading checks the account folder before contents and enforces a streaming text limit", async fn() {
    const { readDriveMaterial } = await load("google-drive");
    const { encryptText } = await load("google-calendar");
    const env = { SUPABASE_URL: "https://synthetic.supabase.co", SUPABASE_PUBLISHABLE_KEY: "synthetic-public", GOOGLE_TOKEN_ENCRYPTION_KEY: "synthetic-encryption-key-for-tests-only", GOOGLE_CALENDAR_CLIENT_ID: "synthetic", GOOGLE_CALENDAR_CLIENT_SECRET: "synthetic" };
    const connection = { folder_id: "own-folder", encrypted_refresh_token: await encryptText("synthetic-refresh", env.GOOGLE_TOKEN_ENCRYPTION_KEY) };
    let folder = "own-folder", mime = "text/plain", body = "Hello", mediaCalls = 0;
    const fetchFn = async (url) => {
      if (url.includes("google_drive_connections")) return Response.json([connection]);
      if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "synthetic-google-token" });
      if (url.includes("alt=media")) { mediaCalls++; return new Response(body); }
      return Response.json({ name: "test.txt", mimeType: mime, size: 5, parents: [folder] });
    };
    const file = { id: "material-1", googleId: "synthetic-file" };
    const auth = { user: { id: "synthetic-owner" }, accessToken: "synthetic-session" };
    const result = await readDriveMaterial(env, auth, file, fetchFn);
    assert.equal(result.text, "Hello"); assert.ok(!JSON.stringify(result).includes("synthetic-google-token"));
    folder = "other-folder";
    await assert.rejects(() => readDriveMaterial(env, auth, file, fetchFn), /вне папки/); assert.equal(mediaCalls, 1);
    folder = "own-folder"; mime = "application/pdf";
    assert.equal((await readDriveMaterial(env, auth, file, fetchFn)).contentAvailable, false); assert.equal(mediaCalls, 1);
    mime = "text/plain"; body = "x".repeat(256 * 1024 + 1);
    await assert.rejects(() => readDriveMaterial(env, auth, file, fetchFn), /лимит/);
  } },
];
