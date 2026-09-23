(function (global) {
  const elements = {
    backLink: document.querySelector("#authBackLink"),
    confirmField: document.querySelector("#authConfirmField"),
    description: document.querySelector("#authDescription"),
    email: document.querySelector("#authEmail"),
    form: document.querySelector("#authForm"),
    googleButton: document.querySelector("#authGoogle"),
    homeLink: document.querySelector("#authHomeLink"),
    modeButtons: [...document.querySelectorAll("[data-auth-mode]")],
    newPassword: document.querySelector("#authNewPassword"),
    newPasswordConfirm: document.querySelector("#authNewPasswordConfirm"),
    password: document.querySelector("#authPassword"),
    passwordConfirm: document.querySelector("#authPasswordConfirm"),
    passwordToggles: [...document.querySelectorAll("[data-password-toggle]")],
    recoveryFlow: document.querySelector("#authRecoveryFlow"),
    recoveryForm: document.querySelector("#authRecoveryForm"),
    resetButton: document.querySelector("#authResetPassword"),
    standardFlow: document.querySelector("#authStandardFlow"),
    status: document.querySelector("#authStatus"),
    submit: document.querySelector("#authSubmit"),
    title: document.querySelector("#authTitle"),
  };
  let auth = null;
  let busy = false;
  let mode = new URLSearchParams(global.location.search).get("mode") === "signup" ? "signup" : "signin";

  function route(path) {
    if (global.location.protocol !== "file:") return path;
    if (path === "/") return "landing.html";
    if (path.startsWith("/app")) return `index.html${path.slice(4)}`;
    return path;
  }

  function safeNextTarget(value, location = global.location) {
    const fallback = location.protocol === "file:" ? "index.html" : "/app";
    const candidate = String(value || "").trim();
    if (location.protocol === "file:") {
      return /^index\.html(?:#[-/\w]+)?$/.test(candidate) ? candidate : fallback;
    }
    return /^\/app(?:#[-/\w]+)?$/.test(candidate) ? candidate : fallback;
  }

  function appTarget() {
    const queryTarget = new URLSearchParams(global.location.search).get("next");
    let storedTarget = "";
    try { storedTarget = global.sessionStorage?.getItem("parsitasks-auth-next") || ""; } catch {}
    return safeNextTarget(queryTarget || storedTarget);
  }

  function oauthRedirectUrl() {
    if (!/^https?:$/.test(global.location.protocol)) return "https://parsitasks.ru/auth";
    return `${global.location.origin}/auth`;
  }

  function setMode(nextMode) {
    mode = nextMode === "signup" ? "signup" : "signin";
    const isSignUp = mode === "signup";
    document.title = `${isSignUp ? "Регистрация" : "Вход"} — Parsitasks`;
    elements.title.textContent = isSignUp ? "Создать аккаунт" : "Вход";
    elements.description.textContent = isSignUp
      ? "Создайте пространство, которое будет доступно на всех устройствах."
      : "Введите данные, чтобы открыть своё пространство.";
    elements.submit.textContent = isSignUp ? "Создать аккаунт" : "Войти";
    elements.confirmField.hidden = !isSignUp;
    elements.password.autocomplete = isSignUp ? "new-password" : "current-password";
    elements.password.minLength = isSignUp ? 8 : 6;
    elements.password.placeholder = isSignUp ? "Не менее 8 символов" : "Ваш пароль";
    elements.passwordConfirm.required = isSignUp;
    elements.resetButton.hidden = isSignUp;
    elements.modeButtons.forEach((button) => {
      const selected = button.dataset.authMode === mode;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    updateModeLocation();
    resetPasswordVisibility();
    clearStatus();
  }

  function updateModeLocation() {
    if (!global.history?.replaceState || !global.location?.href) return;
    try {
      const url = new URL(global.location.href);
      url.searchParams.set("mode", mode);
      global.history.replaceState(global.history.state, "", url.href);
    } catch {}
  }

  function resetPasswordVisibility() {
    elements.passwordToggles.forEach((button) => {
      const input = document.querySelector(`#${button.dataset.passwordToggle}`);
      if (!input) return;
      input.type = "password";
      button.textContent = "Показать";
      button.setAttribute("aria-pressed", "false");
    });
  }

  function togglePasswordVisibility(button) {
    const input = document.querySelector(`#${button.dataset.passwordToggle}`);
    if (!input) return;
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.textContent = visible ? "Скрыть" : "Показать";
    button.setAttribute("aria-pressed", String(visible));
    input.focus();
  }

  function handleModeKeydown(event) {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const currentIndex = Math.max(0, elements.modeButtons.indexOf(event.currentTarget));
    let nextIndex = currentIndex;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) nextIndex = (currentIndex + 1) % elements.modeButtons.length;
    if (["ArrowLeft", "ArrowUp"].includes(event.key)) nextIndex = (currentIndex - 1 + elements.modeButtons.length) % elements.modeButtons.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = elements.modeButtons.length - 1;
    const nextButton = elements.modeButtons[nextIndex];
    setMode(nextButton.dataset.authMode);
    nextButton.focus();
  }

  async function initialize() {
    elements.homeLink.href = route("/");
    elements.backLink.href = route("/");
    bindEvents();
    setMode(mode);
    setBusy(true, "Подключаем безопасный вход...");
    try {
      const config = await global.RhythmHostedConfig.loadHostedConfig();
      if (!config.managed) throw new Error("Сервис авторизации временно недоступен");
      auth = global.RhythmRemoteAuth.createRemoteAuth({
        getConfig: () => ({ anonKey: config.anonKey, supabaseUrl: config.supabaseUrl }),
      });
      const callbackError = auth.getCallbackError();
      if (auth.isRecoveryMode()) {
        document.title = "Новый пароль — Parsitasks";
        elements.standardFlow.hidden = true;
        elements.recoveryFlow.hidden = false;
        clearStatus();
        elements.newPassword.focus();
        return;
      }
      const session = auth.getSession();
      if (session?.access_token) {
        const valid = await auth.validateSession().catch(() => null);
        if (valid) {
          global.location.replace(appTarget());
          return;
        }
      }
      if (callbackError) showError(localizeError({ message: callbackError }));
      else clearStatus();
      elements.email.focus();
    } catch (error) {
      showError(localizeError(error));
    } finally {
      setBusy(false);
    }
  }

  function bindEvents() {
    elements.modeButtons.forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.authMode));
      button.addEventListener("keydown", handleModeKeydown);
    });
    elements.passwordToggles.forEach((button) => {
      button.addEventListener("click", () => togglePasswordVisibility(button));
    });
    elements.form.addEventListener("submit", submitAuth);
    elements.googleButton.addEventListener("click", continueWithGoogle);
    elements.recoveryForm.addEventListener("submit", submitRecovery);
    elements.resetButton.addEventListener("click", requestReset);
  }

  function continueWithGoogle() {
    if (busy || !auth) return;
    if (global.location.protocol === "file:") {
      global.open?.(`https://parsitasks.ru/auth?mode=${mode}`, "_blank", "noopener");
      showStatus("Вход через Google открыт в браузере.");
      return;
    }
    setBusy(true, "Открываем Google...");
    try {
      try { global.sessionStorage?.setItem("parsitasks-auth-next", appTarget()); } catch {}
      global.location.assign(auth.createOAuthUrl("google", oauthRedirectUrl()));
    } catch (error) {
      showError(localizeError(error));
      setBusy(false);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (busy || !auth) return;
    const email = elements.email.value.trim();
    const password = elements.password.value;
    const minimumLength = mode === "signup" ? 8 : 6;
    if (!email || password.length < minimumLength) {
      showError(`Укажите email и пароль не короче ${minimumLength} символов`);
      return;
    }
    if (mode === "signup" && password !== elements.passwordConfirm.value) {
      showError("Пароли не совпадают");
      elements.passwordConfirm.focus();
      return;
    }
    setBusy(true, mode === "signup" ? "Создаём аккаунт..." : "Входим...");
    try {
      const result = await auth[mode === "signup" ? "signUp" : "signIn"](email, password);
      elements.password.value = "";
      elements.passwordConfirm.value = "";
      if (!result.access_token) {
        setMode("signin");
        showStatus("Проверьте почту и подтвердите регистрацию, затем войдите.");
        return;
      }
      global.location.replace(appTarget());
    } catch (error) {
      showError(localizeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function requestReset() {
    if (busy || !auth) return;
    const email = elements.email.value.trim();
    if (!email) {
      showError("Сначала укажите email аккаунта");
      elements.email.focus();
      return;
    }
    setBusy(true, "Отправляем письмо...");
    try {
      await auth.resetPassword(email);
      showStatus("Если аккаунт существует, ссылка для восстановления отправлена на почту.");
    } catch (error) {
      showError(localizeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitRecovery(event) {
    event.preventDefault();
    if (busy || !auth) return;
    const password = elements.newPassword.value;
    if (password.length < 8) {
      showError("Новый пароль должен содержать не менее 8 символов");
      return;
    }
    if (password !== elements.newPasswordConfirm.value) {
      showError("Пароли не совпадают");
      elements.newPasswordConfirm.focus();
      return;
    }
    setBusy(true, "Сохраняем новый пароль...");
    try {
      await auth.updatePassword(password);
      global.location.replace(appTarget());
    } catch (error) {
      showError(localizeError(error));
    } finally {
      setBusy(false);
    }
  }

  function setBusy(value, message = "") {
    busy = value;
    [...elements.form.elements, ...elements.recoveryForm.elements, ...elements.modeButtons, elements.googleButton]
      .forEach((element) => { element.disabled = value; });
    if (message) showStatus(message);
  }

  function clearStatus() {
    elements.status.textContent = "";
    elements.status.classList.remove("is-error", "is-success");
  }

  function showStatus(message) {
    elements.status.textContent = message;
    elements.status.classList.remove("is-error");
    elements.status.classList.add("is-success");
  }

  function showError(message) {
    elements.status.textContent = message;
    elements.status.classList.remove("is-success");
    elements.status.classList.add("is-error");
  }

  function localizeError(error) {
    const message = String(error?.message || "");
    if (/invalid login credentials/i.test(message)) return "Неверный email или пароль";
    if (/email not confirmed/i.test(message)) return "Сначала подтвердите email по ссылке из письма";
    if (/user already registered/i.test(message)) return "Аккаунт с таким email уже существует";
    if (/rate limit/i.test(message)) return "Слишком много попыток. Подождите и попробуйте снова";
    if (/provider is not enabled|unsupported provider/i.test(message)) return "Вход через Google ещё не включён в настройках сервиса";
    if (/access_denied|cancelled|canceled/i.test(message)) return "Вход через Google отменён";
    return message || "Не удалось выполнить запрос";
  }

  const api = { safeNextTarget };
  global.RhythmAuthPage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  initialize();
})(typeof window !== "undefined" ? window : globalThis);
