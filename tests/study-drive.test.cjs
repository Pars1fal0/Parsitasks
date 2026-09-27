const assert = require("node:assert/strict");
const model = require("../app/src/study/study-model.js");
const { mergeStates } = require("../app/src/core/state-merge.js");
const { searchWorkspace } = require("../app/src/ui/global-search.js");

const env = {
  APP_BASE_URL: "https://parsitasks.ru",
  GOOGLE_CALENDAR_CLIENT_ID: "client.apps.googleusercontent.com",
  GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
  GOOGLE_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  SUPABASE_PUBLISHABLE_KEY: "publishable",
  SUPABASE_URL: "https://demo.supabase.co",
};

const normalizeConfig = {
  cleanText: (value) => String(value || "").trim(),
  cleanTimeValue: (value) => /^\d\d:\d\d$/.test(value || "") ? value : "",
  createId: () => "created",
  normalizeDateKey: (value) => /^\d{4}-\d\d-\d\d$/.test(value || "") ? value : "",
  sanitizeColor: (value) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : "",
};

module.exports = [
  {
    name: "study week cycle alternates from an explicit Monday across year boundaries",
    fn() {
      const cycle = model.normalizeWeekCycle({ anchorMonday: "2026-12-28", anchorParity: "even", updatedAt: "2026-09-27T10:00:00.000Z" });
      assert.equal(model.weekParity("2026-12-21", cycle), "odd");
      assert.equal(model.weekParity("2026-12-28", cycle), "even");
      assert.equal(model.weekParity("2027-01-04", cycle), "odd");
      assert.equal(model.weekParity("2027-01-11", cycle), "even");
      assert.equal(model.mondayKey("2027-01-06"), "2027-01-04");
      assert.equal(model.mondayKey("2026-02-30"), "");
    },
  },
  {
    name: "study lessons keep old weekly entries and suggest only a real parity occurrence",
    fn() {
      const subjects = model.normalizeSubjects([{ id: "math", name: "Математика" }], normalizeConfig);
      const lessons = model.normalizeLessons([
        { id: "weekly", subjectId: "math", weekday: 2, startTime: "09:00", endTime: "09:45" },
        { id: "even", subjectId: "math", weekday: 1, weekType: "even", lessonType: "lecture", teacher: "Иванова", startTime: "10:00", endTime: "10:45" },
      ], normalizeConfig, subjects);
      const cycle = model.normalizeWeekCycle({ anchorMonday: "2026-12-28", anchorParity: "even", updatedAt: "2026-09-27T10:00:00.000Z" });
      assert.equal(lessons[0].weekType, "all");
      assert.equal(lessons[1].weekType, "even");
      assert.equal(lessons[1].lessonType, "lecture");
      assert.equal(lessons[1].teacher, "Иванова");
      assert.equal(model.lessonOccursOnDate(lessons[1], "2027-01-04", cycle), false);
      assert.equal(model.lessonOccursOnDate(lessons[1], "2027-01-11", cycle), true);
      assert.equal(model.nextLessonDate([lessons[1]], "math", "2026-12-29", cycle), "2027-01-11");
      assert.equal(model.nextLessonDate([lessons[1]], "math", "2026-12-29", {}), "");
      assert.equal(model.nextLessonDate(lessons, "math", "2026-12-29", cycle), "2027-01-05");
      assert.equal(model.nextLessonDate(lessons, "math", "2026-12-29", {}), "2027-01-05");
    },
  },
  {
    name: "study model keeps only valid subjects, lessons and Drive file identifiers",
    fn() {
      const subjects = model.normalizeSubjects([{ id: "math", name: " Математика ", color: "#123456" }], normalizeConfig);
      const lessons = model.normalizeLessons([
        { id: "one", subjectId: "math", weekday: 1, startTime: "09:00", endTime: "09:45" },
        { id: "two", subjectId: "missing", weekday: 2, startTime: "09:00", endTime: "09:45" },
      ], normalizeConfig, subjects);
      const files = model.normalizeFiles([
        { id: "book", googleId: "drive_123", name: "Учебник.pdf", subjectId: "math" },
        { id: "bad", googleId: "javascript:alert(1)", name: "Опасный" },
      ], normalizeConfig, subjects);
      assert.equal(subjects[0].name, "Математика");
      assert.equal(lessons.length, 1);
      assert.equal(files.length, 1);
      assert.equal(files[0].url, "https://drive.google.com/file/d/drive_123/view");
      assert.deepEqual(model.normalizeTaskStudy({ studySubjectId: "math", studyFileIds: ["book", "bad"], studyDetails: "Упр. 2" }, normalizeConfig, subjects, files).studyFileIds, ["book"]);
    },
  },
  {
    name: "study records merge across devices and deleted records stay deleted",
    fn() {
      const now = "2026-09-27T10:00:00.000Z";
      const local = { studySubjects: [{ id: "math", name: "Математика", updatedAt: now }], studyLessons: [], studyFiles: [], tasks: [], habits: [], goals: [], categories: [], tombstones: { studyFiles: { removed: now } } };
      const remote = { studySubjects: [], studyLessons: [{ id: "lesson", subjectId: "math", updatedAt: now }], studyFiles: [{ id: "removed", googleId: "x", updatedAt: now }], tasks: [], habits: [], goals: [], categories: [] };
      const merged = mergeStates(local, remote);
      assert.equal(merged.studySubjects.length, 1);
      assert.equal(merged.studyLessons.length, 1);
      assert.equal(merged.studyFiles.length, 0);
    },
  },
  {
    name: "study week cycle keeps the newest synced anchor",
    fn() {
      const local = { studyWeekCycle: { anchorMonday: "2026-09-28", anchorParity: "even", updatedAt: "2026-09-27T10:00:00Z" } };
      const remote = { studyWeekCycle: { anchorMonday: "2026-10-05", anchorParity: "odd", updatedAt: "2026-09-27T11:00:00Z" } };
      assert.deepEqual(mergeStates(local, remote).studyWeekCycle, remote.studyWeekCycle);
      assert.deepEqual(mergeStates(remote, local).studyWeekCycle, remote.studyWeekCycle);
    },
  },
  {
    name: "global search finds homework by subject and material by filename",
    fn() {
      const state = {
        categories: [], studySubjects: [{ id: "math", name: "Математика" }],
        tasks: [{ id: "homework", title: "Задачи 5–7", date: "2026-09-28", studySubjectId: "math", completed: {} }],
        studyFiles: [{ id: "book", name: "Учебник.pdf", subjectId: "math" }],
      };
      assert.equal(searchWorkspace(state, "математика").length, 2);
      assert.equal(searchWorkspace(state, "учебник")[0].view, "study");
    },
  },
  {
    name: "Drive OAuth requires a Parsitasks user and requests only per-file access",
    async fn() {
      const drive = await import("../mcp/google-drive.mjs");
      const request = new Request("https://parsitasks.ru/api/google-drive/connect", { method: "POST", headers: { Authorization: "Bearer account-token" } });
      const unauthorized = await drive.handleGoogleDriveRequest(new Request(request.url, { method: "POST" }), env, { fetch: async () => new Response("{}", { status: 401 }) });
      assert.equal(unauthorized.status, 401);
      const response = await drive.handleGoogleDriveRequest(request, env, { fetch: async () => new Response(JSON.stringify({ id: "user-one" }), { status: 200 }) });
      const payload = await response.json();
      const url = new URL(payload.authorizationUrl);
      assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
      assert.equal(url.searchParams.get("redirect_uri"), "https://parsitasks.ru/api/google-drive/callback");
      assert.match(response.headers.get("set-cookie"), /HttpOnly/);
      assert.doesNotMatch(payload.authorizationUrl, /account-token/);
    },
  },
  {
    name: "Drive status reports missing local configuration without an internal error",
    async fn() {
      const drive = await import("../mcp/google-drive.mjs");
      const response = await drive.handleGoogleDriveRequest(new Request("http://127.0.0.1:5185/api/google-drive/status", {
        headers: { Authorization: "Bearer local-user" },
      }), { ...env, SUPABASE_PUBLISHABLE_KEY: "", SUPABASE_URL: "" });
      assert.deepEqual(await response.json(), { configured: false, connected: false });
    },
  },
  {
    name: "Drive upload session cannot be used by another Parsitasks account",
    async fn() {
      const drive = await import("../mcp/google-drive.mjs");
      const { encryptJson } = await import("../mcp/google-calendar.mjs");
      const session = await encryptJson({ url: "https://www.googleapis.com/upload/drive/v3/files?upload_id=test", userId: "user-two", size: 1, expiresAt: Date.now() + 60000 }, env.GOOGLE_TOKEN_ENCRYPTION_KEY);
      const response = await drive.handleGoogleDriveRequest(new Request("https://parsitasks.ru/api/google-drive/upload-chunk", {
        method: "PUT", headers: { Authorization: "Bearer user-one-token", "X-Upload-Session": session, "Content-Range": "bytes 0-0/1" }, body: new Uint8Array([42]),
      }), env, { fetch: async () => new Response(JSON.stringify({ id: "user-one" }), { status: 200 }) });
      assert.equal(response.status, 403);
    },
  },
  {
    name: "Drive upload stores bytes in Google and reports resumable progress",
    async fn() {
      const drive = await import("../mcp/google-drive.mjs");
      const { encryptText } = await import("../mcp/google-calendar.mjs");
      const encrypted = await encryptText("refresh-token", env.GOOGLE_TOKEN_ENCRYPTION_KEY);
      const sessionUrl = "https://www.googleapis.com/upload/drive/v3/files?upload_id=upload-one";
      const fetch = async (url, options = {}) => {
        const address = String(url);
        if (address.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-one" }), { status: 200 });
        if (address.includes("google_drive_connections")) return new Response(JSON.stringify([{ encrypted_refresh_token: encrypted, folder_id: "folder-one" }]), { status: 200 });
        if (address === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "drive-token" }), { status: 200 });
        if (address.includes("uploadType=resumable")) {
          assert.equal(JSON.parse(options.body).parents[0], "folder-one");
          return new Response(null, { status: 200, headers: { Location: sessionUrl } });
        }
        if (address === sessionUrl && options.headers["Content-Range"] === "bytes 0-1/3") return new Response(null, { status: 308, headers: { Range: "bytes=0-1" } });
        if (address === sessionUrl && options.headers["Content-Range"] === "bytes 2-2/3") return new Response(JSON.stringify({ id: "file-one", name: "notes.txt", mimeType: "text/plain", size: "3" }), { status: 200 });
        throw new Error(`Unexpected request: ${address}`);
      };
      const headers = { Authorization: "Bearer user-token" };
      const started = await drive.handleGoogleDriveRequest(new Request("https://parsitasks.ru/api/google-drive/upload-start", {
        method: "POST", headers, body: JSON.stringify({ name: "notes.txt", mime: "text/plain", size: 3 }),
      }), env, { fetch });
      const { session } = await started.json();
      assert.equal(started.status, 200);
      const first = await drive.handleGoogleDriveRequest(new Request("https://parsitasks.ru/api/google-drive/upload-chunk", {
        method: "PUT", headers: { ...headers, "X-Upload-Session": session, "Content-Range": "bytes 0-1/3" }, body: new Uint8Array([1, 2]),
      }), env, { fetch });
      assert.deepEqual(await first.json(), { complete: false, next: 2 });
      const last = await drive.handleGoogleDriveRequest(new Request("https://parsitasks.ru/api/google-drive/upload-chunk", {
        method: "PUT", headers: { ...headers, "X-Upload-Session": session, "Content-Range": "bytes 2-2/3" }, body: new Uint8Array([3]),
      }), env, { fetch });
      const result = await last.json();
      assert.equal(result.complete, true);
      assert.equal(result.file.id, "file-one");
    },
  },
  {
    name: "Drive upload status resumes from Google's acknowledged byte range",
    async fn() {
      const drive = await import("../mcp/google-drive.mjs");
      const { encryptJson, encryptText } = await import("../mcp/google-calendar.mjs");
      const encrypted = await encryptText("refresh-token", env.GOOGLE_TOKEN_ENCRYPTION_KEY);
      const sessionUrl = "https://www.googleapis.com/upload/drive/v3/files?upload_id=resume-one";
      const session = await encryptJson({ url: sessionUrl, userId: "user-one", size: 10, expiresAt: Date.now() + 60000 }, env.GOOGLE_TOKEN_ENCRYPTION_KEY);
      const fetch = async (url, options = {}) => {
        const address = String(url);
        if (address.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "user-one" }), { status: 200 });
        if (address.includes("google_drive_connections")) return new Response(JSON.stringify([{ encrypted_refresh_token: encrypted, folder_id: "folder-one" }]), { status: 200 });
        if (address === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "drive-token" }), { status: 200 });
        if (address === sessionUrl) {
          assert.equal(options.method, "PUT");
          assert.equal(options.headers["Content-Range"], "bytes */10");
          assert.equal(options.body.byteLength, 0);
          assert.equal(options.headers["Content-Length"], undefined);
          return new Response(null, { status: 308, headers: { Range: "bytes=0-4" } });
        }
        throw new Error(`Unexpected request: ${address}`);
      };
      const response = await drive.handleGoogleDriveRequest(new Request("https://parsitasks.ru/api/google-drive/upload-status", {
        method: "POST", headers: { Authorization: "Bearer user-token" }, body: JSON.stringify({ session }),
      }), env, { fetch });
      assert.deepEqual(await response.json(), { complete: false, next: 5 });
    },
  },
];
