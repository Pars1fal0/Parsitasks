(function (global) {
  function detectTimeZone() {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }

  function normalizeTimeZone(value, fallback = "Europe/Moscow") {
    const candidate = String(value || fallback).trim();
    try {
      new Intl.DateTimeFormat("ru-RU", { timeZone: candidate }).format(new Date());
      return candidate;
    } catch {
      return fallback;
    }
  }

  function normalizeProfile(value = {}) {
    return {
      journalAccess: {
        read: value?.journalAccess?.read !== false,
        write: value?.journalAccess?.write !== false,
      },
      timeZone: normalizeTimeZone(value.timeZone, detectTimeZone()),
      updatedAt: validTimestamp(value.updatedAt) ? value.updatedAt : "",
    };
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  }

  const api = { detectTimeZone, normalizeProfile, normalizeTimeZone };
  global.RhythmProfileSettings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
