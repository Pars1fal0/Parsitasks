const assert = require("node:assert/strict");
const { buildSupportReport, hasWorkspaceContent, presetPreferences } = require("../app/src/settings/workspace-guide.js");
const { LABELS, normalize } = require("../app/src/settings/navigation-preferences.js");
const { createWorkspaceLocal } = require("../app/src/core/workspace-local.js");
const { createMemoryStorage } = require("./test-utils.cjs");

module.exports = [
  {
    name: "live scripts exit before account access unless disposable accounts were explicitly selected",
    fn() {
      const { spawnSync } = require("node:child_process");
      const path = require("node:path");
      for (const script of ["security-live.cjs", "remote-sync-live.cjs"]) {
        const result = spawnSync(process.execPath, [path.join(__dirname, script)], { env: { ...process.env, PARSITASKS_LIVE_TEST_ACCOUNTS: "0" }, encoding: "utf8" });
        assert.equal(result.status, 2); assert.match(result.stderr, /disposable test accounts/);
        assert.equal(result.stdout, "");
      }
    },
  },
  {
    name: "support report uses an allowlist and excludes workspace content, credentials and free-text errors",
    fn() {
      const source = { version: "0.33.0", schemaVersion: 26, desktop: true, online: true, tasks: [{ title: "private-text" }],
        token: "secret-token", email: "private-email", sync: { authenticated: true, access_token: "secret-token", accountLabel: "private-email",
          lastError: "secret-error https://private-project.supabase.co", lastPulledAt: "2026-10-01T12:00:00.000Z" } };
      const report = buildSupportReport(source); const serialized = JSON.stringify(report);
      for (const secret of ["private-text", "secret-token", "private-email", "secret-error", "private-project"]) assert.equal(serialized.includes(secret), false);
      assert.equal(report.sync.hasError, true); assert.equal(report.sync.authenticated, true);
      assert.equal(report.platform, "desktop"); assert.equal(report.sync.lastPulledAt, source.sync.lastPulledAt);
      assert.equal(report.schemaVersion, 26); assert.equal(report.version, "0.33.0");
    },
  },
  {
    name: "invalid diagnostic values are omitted rather than copied into the report",
    fn() {
      const report = buildSupportReport({ version: "mail@example.com", schemaVersion: "secret", desktop: "true", online: "true",
        sync: { lastPulledAt: "private-value", lastPushedAt: "2026-99-99T99:00:00.000Z", authenticated: "private-email" } });
      assert.equal(report.version, "unknown"); assert.equal(report.schemaVersion, null);
      assert.equal(report.platform, "web"); assert.equal(report.online, false);
      assert.equal(report.sync.lastPulledAt, null); assert.equal(report.sync.lastPushedAt, null);
      assert.equal(report.sync.authenticated, false); assert.doesNotThrow(() => buildSupportReport(null));
    },
  },
  {
    name: "setup offer is only eligible for an empty workspace, not default categories or existing notes and study",
    fn() {
      assert.equal(hasWorkspaceContent({ categories: [{ name: "Работа" }], tasks: [], habits: [] }), false);
      assert.equal(hasWorkspaceContent(null), false);
      for (const key of ["tasks", "habits", "goals", "notes", "journalEntries", "boardItems", "studySubjects", "studyLessons", "studyFiles"]) {
        assert.equal(hasWorkspaceContent({ [key]: [{ id: "existing" }] }), true, key);
      }
    },
  },
  {
    name: "basic and study presets only change navigation and keep settings accessible",
    fn() {
      const current = normalize({ hidden: [], mobile: ["journal", "board"] });
      const study = presetPreferences("study", LABELS, current);
      assert.deepEqual(study.mobile, ["tasks", "habits", "overview", "study"]);
      assert.equal(study.hidden.includes("settings"), false);
      assert.equal(study.hidden.includes("nutrition"), true);
      assert.deepEqual(presetPreferences("basic", LABELS, current).mobile, ["tasks", "habits", "overview"]);
      assert.deepEqual(current.mobile, ["journal", "board"]);
      assert.equal(presetPreferences("current", LABELS, current), current);
      assert.equal(presetPreferences("unknown", LABELS, current), current);
      study.mobile.pop(); assert.equal(presetPreferences("study", LABELS, current).mobile.length, 4);
    },
  },
  {
    name: "setup completion is stored per account and does not mark another account or local workspace complete",
    fn() {
      let owner = "a";
      const storage = createMemoryStorage(); const local = createWorkspaceLocal({ storage, getUserId: () => owner });
      assert.equal(local.write("workspace-setup-v1", true), true);
      owner = "b"; assert.equal(local.read("workspace-setup-v1"), null);
      owner = ""; assert.equal(local.read("workspace-setup-v1"), null);
      owner = "a"; assert.equal(local.read("workspace-setup-v1"), true);
    },
  },
];
