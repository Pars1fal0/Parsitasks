import * as settingsApi from "./settings-state.js";
import { normalizePlanning } from "../calendar/free-time.js";

const preferenceKeys = ["themePreference", "accentPreference", "densityPreference", "firstDayOfWeek", "timeFormat", "navigationPreferences", "quietHours"];

function normalizePreferences(raw = {}) {
  const result = {};
  for (const key of preferenceKeys) {
    const entry = raw?.[key];
    if (!entry || !validTimestamp(entry.updatedAt)) continue;
    result[key] = { value: settingsApi.createSettingsState().normalizeImportedSettings({ [key]: entry.value })[key], updatedAt: entry.updatedAt };
  }
  return result;
}

function mergePreferences(local = {}, remote = {}) {
  const result = normalizePreferences(local);
  for (const [key, entry] of Object.entries(normalizePreferences(remote))) {
    if (!result[key] || Date.parse(entry.updatedAt) >= Date.parse(result[key].updatedAt)) result[key] = entry;
  }
  return result;
}

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
    preferences: normalizePreferences(value.preferences),
    planning: normalizePlanning(value.planning),
    updatedAt: validTimestamp(value.updatedAt) ? value.updatedAt : "",
  };
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

const api = { detectTimeZone, mergePreferences, normalizePreferences, normalizeProfile, normalizeTimeZone, preferenceKeys };

export { detectTimeZone, mergePreferences, normalizePreferences, normalizeProfile, normalizeTimeZone, preferenceKeys };
export default api;
