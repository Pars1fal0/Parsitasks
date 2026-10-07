import profileSettings from "../app/src/settings/profile-settings.js";
import navigation from "../app/src/settings/navigation-preferences.js";
import reminderPolicy from "../app/src/platform/reminder-policy.js";
import accentColors from "../app/src/settings/accent-colors.js";
import { command, timeValue } from "./workspace-service.mjs";

export function getAccountPreferences(state) {
  return { timeZone: state.profile?.timeZone || "Europe/Moscow", preferences: state.profile?.preferences || {},
    journalAccess: state.profile?.journalAccess || { read: true, write: true },
    deviceOnly: ["notificationPermission", "backupFolder", "credentials", "localDrafts"] };
}

export function updateAccountPreferencesCommand(state, input, options) {
  return command(state, input, "update_account_preferences", (next, now) => {
    next.profile ||= {};
    next.profile.preferences ||= {};
    if (input.timeZone !== undefined) {
      try { new Intl.DateTimeFormat("ru", { timeZone: input.timeZone }).format(); }
      catch { throw new Error("Неизвестный часовой пояс IANA"); }
      next.profile.timeZone = input.timeZone;
    }
    const values = input.preferences || {};
    for (const [key, raw] of Object.entries(values)) {
      if (!profileSettings.preferenceKeys.includes(key)) throw new Error(`Настройка ${key} недоступна через MCP`);
      let value = raw;
      if (key === "accentPreference") value = accentColors.normalize(raw);
      if (key === "navigationPreferences") value = navigation.normalize(raw);
      if (key === "quietHours") { timeValue(raw.start); timeValue(raw.end); value = reminderPolicy.normalizeQuietHours(raw); }
      next.profile.preferences[key] = { value, updatedAt: now };
    }
    if (input.timeZone === undefined && !Object.keys(values).length) throw new Error("Не указаны изменения настроек");
    next.profile.updatedAt = now;
    return { ...getAccountPreferences(next), summary: "Настройки аккаунта обновлены и будут синхронизированы" };
  }, options);
}
