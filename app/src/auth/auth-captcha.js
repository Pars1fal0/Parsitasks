(function (global) {
  function createAuthCaptcha({ siteKey = "", element, onError = () => {} } = {}) {
    let token = "";
    let widget;
    const enabled = Boolean(siteKey);
    function getToken() {
      if (enabled && !token) throw new Error("Пройдите проверку безопасности перед отправкой");
      return token;
    }
    function reset() {
      token = "";
      if (widget !== undefined) global.turnstile?.reset(widget);
    }
    async function initialize() {
      if (!enabled) return;
      if (!/^[A-Za-z0-9_-]{10,100}$/.test(siteKey) || !element) throw new Error("Проверка безопасности настроена неверно");
      element.hidden = false;
      if (!global.turnstile) await new Promise((resolve, reject) => {
        const script = global.document.createElement("script");
        const timer = global.setTimeout(() => reject(new Error("Проверка безопасности не загрузилась. Обновите страницу.")), 15000);
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.onload = () => { global.clearTimeout(timer); resolve(); };
        script.onerror = () => { global.clearTimeout(timer); reject(new Error("Проверка безопасности недоступна. Повторите позже.")); };
        global.document.head.append(script);
      });
      widget = global.turnstile.render(element, {
        sitekey: siteKey, theme: "auto", size: "compact",
        callback: (value) => { token = value; },
        "expired-callback": () => { token = ""; },
        "error-callback": () => { token = ""; onError("Не удалось пройти проверку безопасности. Повторите попытку."); },
      });
    }
    return { getToken, initialize, reset };
  }
  const api = { createAuthCaptcha };
  global.RhythmAuthCaptcha = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
