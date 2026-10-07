const assert = require("node:assert/strict");
const { createAuthCaptcha } = require("../app/src/auth/auth-captcha.js");
module.exports = [
  { name: "unconfigured CAPTCHA does not load third-party code or require tokens", async fn() {
    const captcha = createAuthCaptcha(); await captcha.initialize(); assert.equal(captcha.getToken(), "");
  } },
  { name: "configured CAPTCHA fails closed and rejects expired or reset tokens", async fn() {
    const previous = global.turnstile; let callbacks; let resets = 0;
    try {
      global.turnstile = { render: (el, options) => { callbacks = options; return "widget"; }, reset: () => resets++ };
      const element = { hidden: true };
      const captcha = createAuthCaptcha({ siteKey: "test_site_key_123", element });
      assert.throws(captcha.getToken, /проверку безопасности/);
      await captcha.initialize(); assert.equal(element.hidden, false);
      callbacks.callback("token"); assert.equal(captcha.getToken(), "token");
      callbacks["expired-callback"](); assert.throws(captcha.getToken);
      callbacks.callback("new-token"); captcha.reset(); assert.throws(captcha.getToken); assert.equal(resets, 1);
      await assert.rejects(createAuthCaptcha({ siteKey: "not a valid key", element }).initialize(), /неверно/);
    } finally { global.turnstile = previous; }
  } },
];
