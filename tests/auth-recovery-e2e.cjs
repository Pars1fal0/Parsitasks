const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const captures = path.resolve(__dirname, "../.wrangler"); fs.mkdirSync(captures, { recursive: true });
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      const errors = []; const requests = []; let valid = true; let captchaEnabled = false;
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route(/^https?:/, async (route) => {
        const request = route.request(); const url = new URL(request.url());
        requests.push({ method: request.method(), url });
        const reply = (data, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(data) });
        if (url.origin === "https://challenges.cloudflare.com") return route.fulfill({ contentType: "text/javascript", body: `window.turnstile = {
          render(element, options) { window.__captchaCallbacks = options; const box = document.createElement('div'); box.textContent = 'Synthetic security check'; element.append(box); return 'fixture'; },
          reset() { window.__captchaReset = (window.__captchaReset || 0) + 1; }
        };` });
        if (url.origin === "https://parsitasks.ru" && url.pathname === "/api/public-config") return reply({ supabaseUrl: "https://test.supabase.co", anonKey: "sb_publishable_synthetic",
          ...(captchaEnabled ? { turnstileSiteKey: "synthetic_site_key" } : {}) });
        if (url.origin !== "https://test.supabase.co") return reply({}, 404);
        if (url.pathname === "/auth/v1/user") return reply(valid ? { id: "synthetic-recovery-user" } : { message: "Email link has expired" }, valid ? 200 : 401);
        if (url.pathname === "/auth/v1/recover") {
          assert.equal(url.searchParams.get("redirect_to"), null); // file: has no local HTTP callback.
          if (captchaEnabled) assert.equal(request.postDataJSON().gotrue_meta_security.captcha_token, "synthetic-captcha-token");
          return reply({});
        }
        return reply({}, 404);
      });
      const payload = Buffer.from(JSON.stringify({ sub: "synthetic-recovery-user", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
      const url = pathToFileURL(path.resolve(__dirname, process.env.PARSITASKS_TEST_WEB === "1" ? "../web-dist/auth.html" : "../app/auth.html"));
      url.hash = `access_token=header.${payload}.signature&type=recovery`;
      await page.goto(url.href);
      await page.locator("#authRecoveryFlow").waitFor({ state: "visible" });
      assert.equal(new URL(page.url()).hash, "");
      assert.ok(requests.some((item) => item.method === "GET" && item.url.pathname === "/auth/v1/user"));
      await page.reload();
      await page.locator("#authRecoveryFlow").waitFor({ state: "visible" });
      await page.screenshot({ path: path.join(captures, `auth-recovery-${width}.png`) });
      valid = false;
      await page.goto(url.href);
      await page.locator("#authStatus.is-error").waitFor();
      assert.match(await page.locator("#authStatus").innerText(), /устарела/);
      assert.equal(await page.locator("#authRecoveryFlow").isVisible(), false);
      assert.equal(new URL(page.url()).hash, "");
      url.hash = "error=access_denied&error_description=Email+link+has+expired";
      await page.goto(url.href);
      await page.locator("#authStatus.is-error").waitFor();
      assert.match(await page.locator("#authStatus").innerText(), /устарела/);
      assert.equal(new URL(page.url()).hash, "");
      assert.deepEqual(errors, []);
      assert.ok(requests.every((item) => item.url.origin === "https://test.supabase.co" || item.url.origin === "https://parsitasks.ru"));
      captchaEnabled = true;
      url.hash = "";
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      await page.goto(url.href);
      await page.waitForFunction(() => Boolean(window.__captchaCallbacks));
      await page.locator("#authEmail").fill("synthetic@example.test");
      await page.locator("#authResetPassword").click();
      await page.locator("#authStatus.is-error").waitFor();
      assert.match(await page.locator("#authStatus").innerText(), /проверку безопасности/);
      assert.equal(requests.filter((item) => item.url.pathname === "/auth/v1/recover").length, 0, "missing token must not contact Auth");
      await page.evaluate(() => window.__captchaCallbacks.callback("synthetic-captcha-token"));
      await page.locator("#authResetPassword").click();
      await page.waitForFunction(() => document.querySelector("#authStatus").textContent.includes("отправлена"));
      assert.equal(requests.filter((item) => item.url.pathname === "/auth/v1/recover").length, 1);
      assert.equal(await page.evaluate(() => window.__captchaReset), 2);
      const captchaBox = await page.locator("#authCaptcha").boundingBox();
      assert.ok(captchaBox && captchaBox.x >= 0 && captchaBox.x + captchaBox.width <= width + 1);
      await page.screenshot({ path: path.join(captures, `auth-captcha-${width}.png`) });
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("auth recovery UI ok - isolated 390/1440, invalid links, configured CAPTCHA token gate and reset; all HTTP mocked");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
