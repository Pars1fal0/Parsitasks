import journalModel from "../src/journal/journal-model.js";
import { recordMcpActivity } from "./activity-service.mjs";

export function getJournalEntry(state, date) {
  const entry = journalModel.journalEntryForDate(state?.journalEntries, date);
  return {
    date,
    exists: Boolean(entry?.text),
    text: entry?.text || "",
    updatedAt: entry?.updatedAt || "",
  };
}

export function getJournalPeriod(state, from, to) {
  const entries = journalModel.journalEntriesForPeriod(state?.journalEntries, from, to);
  return {
    from,
    to,
    entries: entries.map((entry) => ({
      date: entry.date,
      text: entry.text,
      updatedAt: entry.updatedAt,
    })),
  };
}

export function appendJournalEntryCommand(state, input, options = {}) {
  const before = clone(state);
  const nextState = clone(state);
  ensureShape(nextState);
  const requestId = normalizeRequestId(input.requestId);
  const previousActivity = nextState.mcpActivity.find((item) => item?.requestId === requestId);
  const current = journalModel.journalEntryForDate(nextState.journalEntries, input.date);
  if (previousActivity) {
    return {
      activity: previousActivity,
      changed: false,
      entry: current,
      state: nextState,
      summary: "Этот запрос уже был обработан",
    };
  }

  const text = journalModel.appendJournalText(current?.text, input.text);
  const now = options.now || new Date().toISOString();
  const result = journalModel.upsertJournalEntry(
    nextState.journalEntries,
    { date: input.date, text },
    { createId: () => `mcp-journal-${requestId}`, now },
  );
  nextState.journalEntries = result.entries;
  if (!result.changed || !result.entry) {
    return { changed: false, entry: result.entry, state: nextState, summary: "Запись не изменилась" };
  }

  delete nextState.tombstones.journalEntries[result.entry.id];
  const versions = (((nextState.syncMeta.entityFields.journalEntries ||= {})[result.entry.id] ||= {}));
  versions.text = now;
  versions.revisions = now;
  versions.date ||= now;
  const summary = `В дневник за ${result.entry.date} добавлен новый абзац`;
  const activity = recordMcpActivity(before, nextState, {
    requestId,
    type: "append_journal_entry",
    title: "Запись в дневник",
    summary,
  }, now);
  return { activity, changed: true, entry: result.entry, state: nextState, summary };
}

function ensureShape(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Состояние приложения повреждено");
  state.journalEntries = Array.isArray(state.journalEntries) ? state.journalEntries : [];
  state.mcpActivity = Array.isArray(state.mcpActivity) ? state.mcpActivity : [];
  state.tombstones = state.tombstones && typeof state.tombstones === "object" ? state.tombstones : {};
  state.tombstones.journalEntries ||= {};
  state.syncMeta = state.syncMeta && typeof state.syncMeta === "object" ? state.syncMeta : {};
  state.syncMeta.entityFields = state.syncMeta.entityFields && typeof state.syncMeta.entityFields === "object"
    ? state.syncMeta.entityFields
    : {};
  state.syncMeta.entityFields.journalEntries ||= {};
}

function normalizeRequestId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9._:-]{8,100}$/.test(id)) {
    throw new Error("requestId должен быть уникальной строкой длиной 8–100 символов");
  }
  return id;
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value || {})
    : JSON.parse(JSON.stringify(value || {}));
}
