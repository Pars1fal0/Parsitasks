(function (global) {
  function createSettingsState(options = {}) {
    const validBackupSchedules = options.validBackupSchedules || ["0", "5", "15", "30", "60"];
    const cleanText = options.cleanText || ((value) => String(value || "").trim());

    function normalizeThemePreference(value) {
      return ["dark", "light", "system"].includes(value) ? value : "dark";
    }

    function normalizeAccentPreference(value) {
      const colors = global.RhythmAccentColors || require("./accent-colors.js");
      return colors.normalize(value);
    }

    function normalizeNotificationSetting(value) {
      return value === "off" ? "off" : "on";
    }

    function normalizeBackupSchedule(value) {
      const schedule = String(value ?? "5");
      return validBackupSchedules.includes(schedule) ? schedule : "5";
    }

    function normalizeFirstDayOfWeek(value) {
      return value === "sunday" ? "sunday" : "monday";
    }

    function normalizeDensityPreference(value) {
      return value === "compact" ? "compact" : "comfortable";
    }

    function normalizeTimeFormat(value) {
      return value === "12" ? "12" : "24";
    }

    function normalizeRemoteSyncEnabled(value) {
      return value === true || value === "on" ? "on" : "off";
    }

    function normalizeImportedSettings(settings = {}) {
      return {
        accentPreference: normalizeAccentPreference(settings.accentPreference),
        backupSchedule: normalizeBackupSchedule(settings.backupSchedule),
        densityPreference: normalizeDensityPreference(settings.densityPreference),
        firstDayOfWeek: normalizeFirstDayOfWeek(settings.firstDayOfWeek),
        notificationSetting: normalizeNotificationSetting(settings.notificationSetting),
        navigationPreferences: global.RhythmNavigationPreferences?.normalize(settings.navigationPreferences) || { hidden: [], mobile: ["tasks", "timeline", "habits", "overview"] },
        quietHours: global.RhythmReminderPolicy?.normalizeQuietHours(settings.quietHours) || { enabled: false, start: "22:00", end: "08:00" },
        themePreference: normalizeThemePreference(settings.themePreference),
        timeFormat: normalizeTimeFormat(settings.timeFormat),
      };
    }

    function createRemoteUiSettings() {
      // Account preferences live in state.profile; credentials and device settings never enter ui_state.
      return {};
    }

    function isRemoteVersionNewer(remoteUpdatedAt, ...localAnchors) {
      if (!remoteUpdatedAt) return false;
      const latestLocal = localAnchors.filter(Boolean).sort().at(-1) || "";
      return !latestLocal || remoteUpdatedAt > latestLocal;
    }

    return {
      createRemoteUiSettings,
      isRemoteVersionNewer,
      normalizeBackupSchedule,
      normalizeAccentPreference,
      normalizeDensityPreference,
      normalizeFirstDayOfWeek,
      normalizeImportedSettings,
      normalizeNotificationSetting,
      normalizeRemoteSyncEnabled,
      normalizeThemePreference,
      normalizeTimeFormat,
    };
  }

  const api = { createSettingsState };
  global.RhythmSettingsState = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
