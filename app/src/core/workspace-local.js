(function (global) {
  function createWorkspaceLocal(options = {}) {
    const storage = options.storage || global.localStorage;
    let reportedError = false;

    function owner() { return options.getUserId?.() || "local"; }
    function storageKey(name) { return `rhythm-day-workspace-local-v1:${encodeURIComponent(owner())}:${typeof name === "function" ? name() : name}`; }
    function read(name, fallback = null) {
      try {
        const raw = storage.getItem(storageKey(name));
        return raw ? JSON.parse(raw) : fallback;
      } catch { return fallback; }
    }
    function write(name, value) {
      try {
        storage.setItem(storageKey(name), JSON.stringify(value));
        reportedError = false;
        return true;
      } catch {
        if (!reportedError) options.onError?.();
        reportedError = true;
        return false;
      }
    }
    function remove(name) {
      try { storage.removeItem(storageKey(name)); return true; }
      catch { options.onError?.(); return false; }
    }
    function formDraft(form, name, onSaved = () => {}) {
      function save() {
        const saved = write(name, captureForm(form));
        onSaved(saved);
        return saved;
      }
      function restore() {
        const draft = read(name);
        if (!Array.isArray(draft)) return false;
        restoreForm(form, draft);
        return true;
      }
      function bind() {
        form.addEventListener("input", save);
        form.addEventListener("change", save);
      }
      return { bind, clear: () => remove(name), restore, save };
    }
    return { formDraft, owner, read, remove, write };
  }

  function captureForm(form) {
    return [...form.elements].filter((field) =>
      ["INPUT", "SELECT", "TEXTAREA"].includes(field.tagName) && field.type !== "file"
    ).map((field) => ({ id: field.getAttribute("id") || "", name: field.name || "", value: field.value,
      checked: ["checkbox", "radio"].includes(field.type) ? field.checked : undefined }));
  }

  function restoreForm(form, draft) {
    for (const saved of draft) {
      const field = [...form.elements].find((item) => saved.id ? item.getAttribute("id") === saved.id
        : item.name === saved.name && (saved.checked === undefined || item.value === saved.value));
      if (!field || field.type === "file") continue;
      if (saved.checked !== undefined) field.checked = saved.checked === true;
      else field.value = String(saved.value ?? "");
    }
  }

  const api = { captureForm, createWorkspaceLocal, restoreForm };
  global.RhythmWorkspaceLocal = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
