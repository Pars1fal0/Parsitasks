// Conflict-safe preparation of MCP inverse patches, shared by the Worker and the app.
// Fields changed by the MCP action are reverted only while they still hold the value the
// action wrote; later user edits to other fields are kept, and edits to the same fields
// refuse the undo instead of being overwritten.

const CONFLICT_MESSAGE = "После этого действия данные изменились. Отмена не применена, чтобы сохранить новые изменения.";
const SKIPPED_FIELDS = new Set(["id", "updatedAt"]);

function prepareEntityUndo(state, entities, activityCreatedAt, now) {
  const prepared = {};
  Object.entries(entities || {}).forEach(([type, change]) => {
    const expectedById = new Map((change.expected || []).map((entry) => [entry.id, entry.value]));
    const guarded = Array.isArray(change.expected);
    const current = new Map((Array.isArray(state?.[type]) ? state[type] : []).filter((item) => item?.id).map((item) => [item.id, item]));
    const restore = change.restore.map((before) => {
      const live = current.get(before.id) ?? null;
      if (!guarded) {
        assertUntouchedSince(state, type, before.id, live, activityCreatedAt);
        return before;
      }
      const after = expectedById.has(before.id) ? expectedById.get(before.id) : null;
      if (after === null) {
        if (live) throw new Error(CONFLICT_MESSAGE);
        return before;
      }
      if (!live) throw new Error(CONFLICT_MESSAGE);
      return mergeFields(before, after, live, now);
    });
    change.removeIds.forEach((id) => {
      const live = current.get(id) ?? null;
      if (!live) return;
      if (!guarded) {
        assertUntouchedSince(state, type, id, live, activityCreatedAt);
        return;
      }
      if (!sameIgnoring(live, expectedById.get(id) ?? null)) throw new Error(CONFLICT_MESSAGE);
    });
    prepared[type] = { ...change, restore };
  });
  return prepared;
}

function prepareTaskOrderUndo(state, patch) {
  // Order is presentation only: on mismatch keep the user's later order and only drop tasks being removed.
  const removed = new Set(patch.entities.tasks?.removeIds || []);
  const result = {};
  Object.entries(patch.taskOrder).forEach(([date, order]) => {
    const expected = patch.expectedTaskOrder[date];
    const live = state.taskOrder?.[date];
    if (expected === undefined || same(live ?? null, expected)) {
      result[date] = order;
      return;
    }
    if (Array.isArray(live)) result[date] = live.filter((id) => !removed.has(id));
  });
  return result;
}

function mergeFields(before, after, live, now) {
  const merged = clone(live);
  const keys = new Set([...Object.keys(before), ...Object.keys(after), ...Object.keys(live)]);
  keys.forEach((key) => {
    if (SKIPPED_FIELDS.has(key)) return;
    if (same(before[key], after[key])) return;
    if (!same(live[key], after[key])) throw new Error(CONFLICT_MESSAGE);
    if (before[key] === undefined) delete merged[key];
    else merged[key] = clone(before[key]);
  });
  merged.updatedAt = now;
  return merged;
}

// Legacy activities were stored without the action's resulting values, so any later
// edit recorded on the entity is treated as a conflict.
function assertUntouchedSince(state, type, id, live, since) {
  const limit = Date.parse(since || "");
  if (!Number.isFinite(limit)) throw new Error(CONFLICT_MESSAGE);
  const later = (value) => Number.isFinite(Date.parse(value || "")) && Date.parse(value) > limit;
  const meta = state?.syncMeta || {};
  const stamps = [live?.updatedAt, ...collectStamps(meta.entityFields?.[type]?.[id])];
  if (type === "tasks") stamps.push(...collectStamps(meta.taskFields?.[id]));
  if (type === "habits") stamps.push(...collectStamps(meta.habitLogs?.[id]));
  if (type === "goals") stamps.push(...collectStamps(meta.goalSteps?.[id]), meta.goalStepOrder?.[id]);
  if (stamps.some(later)) throw new Error(CONFLICT_MESSAGE);
}

function collectStamps(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(collectStamps);
}

function sameIgnoring(left, right) {
  if (!left || !right) return left === right;
  const strip = (value) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "updatedAt"));
  return same(strip(left), strip(right));
}

function same(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : stableStringify(item))).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const api = { CONFLICT_MESSAGE, prepareEntityUndo, prepareTaskOrderUndo, same };

export { CONFLICT_MESSAGE, prepareEntityUndo, prepareTaskOrderUndo, same };
export default api;
