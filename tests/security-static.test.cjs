const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

module.exports = [
  {
    name: "keeps the web and Electron shells on restrictive security boundaries",
    fn() {
      const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
      const authHtml = fs.readFileSync(path.join(root, "auth.html"), "utf8");
      const landingHtml = fs.readFileSync(path.join(root, "landing.html"), "utf8");
      const main = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
      assert.match(html, /script-src 'self'/);
      assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/);
      [authHtml, landingHtml].forEach((page) => {
        assert.match(page, /script-src 'self'/);
        assert.doesNotMatch(page, /script-src[^;]*'unsafe-inline'/);
      });
      assert.match(main, /contextIsolation:\s*true/);
      assert.match(main, /nodeIntegration:\s*false/);
      assert.match(main, /sandbox:\s*true/);
      assert.match(main, /setPermissionRequestHandler/);
      assert.match(main, /isTrustedIpcEvent/);
      assert.match(main, /isInternalAppNavigation/);
    },
  },
  {
    name: "pins privileged GitHub release actions to immutable commits",
    fn() {
      const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "desktop-release.yml"), "utf8");
      const actionRefs = [...workflow.matchAll(/uses:\s*([^\s]+)@([^\s#]+)/g)];
      assert.ok(actionRefs.length >= 3);
      actionRefs.forEach(([, action, ref]) => {
        assert.match(ref, /^[a-f0-9]{40}$/, `${action} must be pinned to a full commit SHA`);
      });
      assert.match(workflow, /persist-credentials:\s*false/);
    },
  },
  {
    name: "does not contain backend Supabase or common private key material",
    fn() {
      const trackedSources = [
        "src/core/app.js",
        "src/auth/hosted-config.js",
        "src/auth/remote-auth.js",
        "src/sync/remote-sync.js",
        "wrangler.jsonc",
        path.join("mcp", "worker.mjs"),
      ].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
      assert.doesNotMatch(trackedSources, /sb_secret_[A-Za-z0-9_-]{16,}/);
      assert.doesNotMatch(trackedSources, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/);
      assert.doesNotMatch(trackedSources, /service_role\s*[:=]\s*["'][A-Za-z0-9._-]{20,}/i);
    },
  },
];
