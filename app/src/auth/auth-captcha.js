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
    if (widget !== undefined) globalThis.turnstile?.reset(widget);
  }
  async function initialize() {
    if (!enabled) return;
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(siteKey) || !element) throw new Error("Проверка безопасности настроена неверно");
    element.hidden = false;
    if (!globalThis.turnstile) await new Promise((resolve, reject) => {
      const script = globalThis.document.createElement("script");
      const timer = globalThis.setTimeout(() => reject(new Error("Проверка безопасности не загрузилась. Обновите страницу.")), 15000);
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => { globalThis.clearTimeout(timer); resolve(); };
      script.onerror = () => { globalThis.clearTimeout(timer); reject(new Error("Проверка безопасности недоступна. Повторите позже.")); };
      globalThis.document.head.append(script);
    });
    widget = globalThis.turnstile.render(element, {
      sitekey: siteKey, theme: "auto", size: "compact",
      callback: (value) => { token = value; },
      "expired-callback": () => { token = ""; },
      "error-callback": () => { token = ""; onError("Не удалось пройти проверку безопасности. Повторите попытку."); },
    });
  }
  return { getToken, initialize, reset };
}
const api = { createAuthCaptcha };

export { createAuthCaptcha };
export default api;
