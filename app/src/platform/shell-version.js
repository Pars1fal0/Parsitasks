export const shellVersion = "0.36.1";
const versionKey = "rhythm-shell-version";
const retryKey = "rhythm-shell-refresh";

function checkShellVersion() {
  let storedVersion = "";
  let alreadyRetried = false;

  try {
    storedVersion = globalThis.localStorage.getItem(versionKey) || "";
    alreadyRetried = globalThis.sessionStorage.getItem(retryKey) === shellVersion;
  } catch {}

  const hasOldShell =
    storedVersion !== shellVersion
    && "serviceWorker" in globalThis.navigator
    && globalThis.navigator.serviceWorker.controller;

  if (hasOldShell && !alreadyRetried) {
    globalThis.document.documentElement.style.visibility = "hidden";
    try {
      globalThis.sessionStorage.setItem(retryKey, shellVersion);
    } catch {}

    const clearWorkers = globalThis.navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
    const clearCaches = "caches" in globalThis
      ? globalThis.caches.keys().then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith("rhythm-day-"))
              .map((key) => globalThis.caches.delete(key)),
          ))
      : Promise.resolve();

    Promise.allSettled([clearWorkers, clearCaches]).then(() => globalThis.location.reload());
    return;
  }

  try {
    globalThis.localStorage.setItem(versionKey, shellVersion);
    globalThis.sessionStorage.removeItem(retryKey);
  } catch {}
}

checkShellVersion();
