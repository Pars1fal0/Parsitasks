(function (global) {
  const STORAGE_KEY = "rhythm-sync-history-v1";

  function createSyncHistory(options = {}) {
    const storage = options.storage || global.localStorage;
    const limit = options.limit || 12;

    function list() {
      try {
        const values = JSON.parse(storage?.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(values) ? values.slice(0, limit) : [];
      } catch {
        return [];
      }
    }

    function record(type, detail = "") {
      const entries = [{ at: new Date().toISOString(), detail: String(detail || ""), type }, ...list()].slice(0, limit);
      try { storage?.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch {}
      return entries;
    }

    function render(element, formatDate) {
      if (!element) return;
      const labels = { error: "Ошибка", merge: "Объединено", pull: "Загружено", push: "Сохранено" };
      const entries = list();
      element.replaceChildren();
      if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "settings-status";
        empty.textContent = "История синхронизации пока пуста";
        element.appendChild(empty);
        return;
      }
      entries.slice(0, 5).forEach((entry) => {
        const row = document.createElement("div");
        const label = document.createElement("strong");
        const meta = document.createElement("small");
        row.className = `sync-history-row is-${entry.type}`;
        label.textContent = labels[entry.type] || "Синхронизация";
        meta.textContent = `${formatDate(entry.at)}${entry.detail ? ` · ${entry.detail}` : ""}`;
        row.append(label, meta);
        element.appendChild(row);
      });
    }

    return { list, record, render };
  }

  const api = { STORAGE_KEY, createSyncHistory };
  global.RhythmSyncHistory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
