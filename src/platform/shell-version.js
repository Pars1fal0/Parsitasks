(function (global) {
  const shellVersion = "0.26.6";
  const versionKey = "rhythm-shell-version";
  const retryKey = "rhythm-shell-refresh";
  let storedVersion = "";
  let alreadyRetried = false;

  try {
    storedVersion = global.localStorage.getItem(versionKey) || "";
    alreadyRetried = global.sessionStorage.getItem(retryKey) === shellVersion;
  } catch {}

  const hasOldShell =
    storedVersion !== shellVersion
    && "serviceWorker" in global.navigator
    && global.navigator.serviceWorker.controller;

  if (hasOldShell && !alreadyRetried) {
    global.document.documentElement.style.visibility = "hidden";
    try {
      global.sessionStorage.setItem(retryKey, shellVersion);
    } catch {}

    const clearWorkers = global.navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
    const clearCaches = "caches" in global
      ? global.caches.keys().then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith("rhythm-day-"))
              .map((key) => global.caches.delete(key)),
          ))
      : Promise.resolve();

    Promise.allSettled([clearWorkers, clearCaches]).then(() => global.location.reload());
    return;
  }

  try {
    global.localStorage.setItem(versionKey, shellVersion);
    global.sessionStorage.removeItem(retryKey);
  } catch {}
})(window);
