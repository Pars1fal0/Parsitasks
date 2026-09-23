const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const authHtml = fs.readFileSync(path.join(root, "app", "auth.html"), "utf8");
const authScript = fs.readFileSync(path.join(root, "app", "src", "auth", "auth-page.js"), "utf8");
const desktopMain = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
const appHtml = fs.readFileSync(path.join(root, "app", "index.html"), "utf8");
const packageJson = require("../package.json");

module.exports = [
  {
    name: "auth page exposes password visibility without nesting buttons in labels",
    fn() {
      const targets = [...authHtml.matchAll(/data-password-toggle="([^"]+)"/g)].map((match) => match[1]);
      assert.deepEqual(targets, ["authPassword", "authPasswordConfirm", "authNewPassword", "authNewPasswordConfirm"]);
      targets.forEach((target) => {
        assert.match(authHtml, new RegExp(`<input id="${target}"[^>]+type="password"`));
        const toggleIndex = authHtml.indexOf(`data-password-toggle="${target}"`);
        assert.ok(authHtml.lastIndexOf("</label>", toggleIndex) > authHtml.lastIndexOf("<label", toggleIndex));
      });
    },
  },
  {
    name: "auth page offers one Google action for sign in and registration",
    fn() {
      assert.match(authHtml, /id="authGoogle"[^>]*>[\s\S]*Продолжить с Google/);
      assert.match(authHtml, /src="assets\/images\/google-g\.svg"/);
      assert.match(authScript, /auth\.createOAuthUrl\("google", oauthRedirectUrl\(\)\)/);
      assert.match(authScript, /sessionStorage\?\.setItem\("parsitasks-auth-next", appTarget\(\)\)/);
    },
  },
  {
    name: "auth modes stay refreshable and support keyboard tab navigation",
    fn() {
      assert.match(authScript, /url\.searchParams\.set\("mode", mode\)/);
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].forEach((key) => {
        assert.match(authScript, new RegExp(`"${key}"`));
      });
      assert.match(authScript, /document\.title = `\$\{isSignUp \? "Регистрация" : "Вход"\} — Parsitasks`/);
    },
  },
  {
    name: "asset tools and legacy backup discovery remain reproducible",
    fn() {
      assert.equal(packageJson.devDependencies.sharp, "^0.35.2");
      assert.match(desktopMain, /path\.dirname\(info\.latest\.path\)/);
      assert.match(desktopMain, /getLegacyFileBackupDir\(\)/);
      assert.match(appHtml, /<div class="brand-mark" aria-hidden="true">P<\/div>/);
      assert.doesNotMatch(appHtml, /Локальный трекер/);
    },
  },
];
