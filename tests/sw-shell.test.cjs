const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = [
  {
    name: "pre-caches every script required by the application shell",
    fn() {
      const root = path.resolve(__dirname, "..");
      const html = ["index.html", "auth.html", "landing.html"]
        .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
        .join("\n");
      const serviceWorker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
      const scripts = [...html.matchAll(/<script src="([^"?]+)(?:\?[^" ]*)?"/g)].map((match) => match[1]);
      scripts.forEach((script) => assert.match(serviceWorker, new RegExp(`"${script.replace(".", "\\.")}"`), `${script} is missing from APP_SHELL`));
    },
  },
  {
    name: "web build replaces the service worker cache placeholder",
    fn() {
      const root = path.resolve(__dirname, "..");
      const buildScript = fs.readFileSync(path.join(root, "scripts", "build-web.cjs"), "utf8");
      assert.match(buildScript, /replaceAll\("__BUILD_HASH__", buildHash\)/);
      assert.match(buildScript, /createHash\("sha256"\)/);
    },
  },
  {
    name: "static shell resources prefer the deployed version over a stale cache",
    fn() {
      const root = path.resolve(__dirname, "..");
      const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
      const shellVersionScript = fs.readFileSync(path.join(root, "src/platform/shell-version.js"), "utf8");
      const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
      const serviceWorker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
      const staticFetch = serviceWorker.match(
        /event\.respondWith\(\s*fetch\(event\.request\)[\s\S]*?\.catch\(\(\) => caches\.match\(event\.request/,
      )?.[0] || "";

      assert.match(html, /shell-version\.js/);
      assert.match(shellVersionScript, new RegExp(`const shellVersion = "${packageVersion.replaceAll(".", "\\.")}"`));
      assert.match(shellVersionScript, /registration\.unregister\(\)/);
      assert.match(shellVersionScript, /key\.startsWith\("rhythm-day-"\)/);
      assert.ok(staticFetch.startsWith("event.respondWith"), "static resources must be fetched from the network first");
    },
  },
];
