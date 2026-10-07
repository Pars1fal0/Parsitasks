const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = [
  {
    name: "pre-caches every script and stylesheet required by the application shell",
    fn() {
      const root = path.resolve(__dirname, "..");
      const pages = ["index.html", "auth.html", "landing.html", "oauth-consent.html"];
      const htmlByPage = Object.fromEntries(pages.map((file) => [
        file,
        fs.readFileSync(path.join(root, "app", file), "utf8"),
      ]));
      const serviceWorker = fs.readFileSync(path.join(root, "app", "sw.js"), "utf8");
      const shell = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] || "";
      const shellEntries = new Set([...shell.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
      const scripts = [...[htmlByPage["index.html"], htmlByPage["auth.html"], htmlByPage["landing.html"]].join("\n")
        .matchAll(/<script src="([^"?]+)(?:\?[^" ]*)?"/g)].map((match) => match[1]);
      scripts.forEach((script) => assert.equal(shellEntries.has(script), true, `${script} is missing from APP_SHELL`));
      for (const [file, html] of Object.entries(htmlByPage)) {
        const stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)]
          .map((match) => match[1].split("?")[0].replace(/^\//, ""));
        stylesheets.forEach((stylesheet) => assert.equal(
          shellEntries.has(stylesheet),
          true,
          `${stylesheet} from ${file} is missing from APP_SHELL`,
        ));
      }
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
    name: "web build stamps one cache version onto local scripts and stylesheets",
    fn() {
      const { stampAssetUrls } = require("../scripts/build-web.cjs");
      const root = path.resolve(__dirname, "..");
      const version = "abc123def456";
      for (const file of ["index.html", "auth.html", "landing.html", "oauth-consent.html"]) {
        const html = fs.readFileSync(path.join(root, "app", file), "utf8");
        assert.doesNotMatch(html, /\?v=/, `${file} must not keep a manual cache version`);
        const stamped = stampAssetUrls(html, version);
        const assets = [...html.matchAll(/<(?:script|link)\b[^>]*>/g)].flatMap((match) => {
          const tag = match[0];
          const stylesheet = tag.startsWith("<link") && /\brel="stylesheet"/.test(tag);
          const script = tag.startsWith("<script") && /\bsrc="/.test(tag);
          if (!stylesheet && !script) return [];
          const url = tag.match(/\b(?:href|src)="([^"]+)"/)?.[1] || "";
          const asset = url.split("?")[0];
          if (/^(?:data:|https?:|#)/.test(url) || !/\.(?:js|css)$/.test(asset)) return [];
          return [asset];
        });
        assert.ok(assets.length > 0, `${file} should reference a local script or stylesheet`);
        for (const asset of assets) {
          assert.match(stamped, new RegExp(`${asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?v=${version}(?=")`));
        }
        assert.doesNotMatch(stamped, /\?v=(?!abc123def456)/);
      }
      const untouched = stampAssetUrls('<script src="https://example.test/app.js"></script><link rel="icon" href="assets/icons/icon-32.png">', version);
      assert.match(untouched, /https:\/\/example\.test\/app\.js"/);
      assert.match(untouched, /assets\/icons\/icon-32\.png"/);
      assert.throws(() => stampAssetUrls('<script src="app.js"></script>', "short"), /Invalid asset version/);
    },
  },
  {
    name: "static shell resources prefer the deployed version over a stale cache",
    fn() {
      const root = path.resolve(__dirname, "..");
      const html = fs.readFileSync(path.join(root, "app", "index.html"), "utf8");
      const shellVersionScript = fs.readFileSync(path.join(root, "app", "src", "platform", "shell-version.js"), "utf8");
      const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
      const serviceWorker = fs.readFileSync(path.join(root, "app", "sw.js"), "utf8");
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
  {
    name: "service worker never caches authenticated API responses",
    fn() {
      const serviceWorker = fs.readFileSync(path.resolve(__dirname, "..", "app", "sw.js"), "utf8");
      assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)\) return;/);
    },
  },
];
