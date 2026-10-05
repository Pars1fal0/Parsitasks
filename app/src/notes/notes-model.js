(function (global) {
  const MAX_TITLE_LENGTH = 120;
  const MAX_BODY_LENGTH = 20000;

  function normalizeNote(value, options = {}) {
    if (!value || typeof value !== "object") return null;
    const now = options.now || new Date().toISOString();
    const title = cleanTitle(value.title);
    const body = cleanBody(value.body);
    if (!title && !body) return null;
    const createdAt = validTimestamp(value.createdAt) || now;
    return {
      id: String(value.id || options.createId?.() || `note-${Date.now()}`).slice(0, 160),
      title: title || "Без названия",
      body,
      pinned: value.pinned === true,
      subjectId: String(value.subjectId || "").trim().slice(0, 160),
      taskId: String(value.taskId || "").trim().slice(0, 160),
      createdAt,
      updatedAt: validTimestamp(value.updatedAt) || createdAt,
      bodyBaseUpdatedAt: validTimestamp(value.bodyBaseUpdatedAt) || "",
    };
  }

  function normalizeNotes(value, options = {}) {
    const byId = new Map();
    (Array.isArray(value) ? value : []).forEach((entry) => {
      const note = normalizeNote(entry, options);
      if (!note) return;
      const previous = byId.get(note.id);
      if (!previous || note.updatedAt >= previous.updatedAt) byId.set(note.id, note);
    });
    return [...byId.values()];
  }

  function listNotes(notes, options = {}) {
    const query = String(options.query || "").trim().toLocaleLowerCase("ru-RU");
    const subjectId = String(options.subjectId || "all");
    const subjects = new Map((options.subjects || []).map((subject) => [subject.id, subject.name]));
    const tasks = new Map((options.tasks || []).map((task) => [task.id, task.title]));
    return normalizeNotes(notes)
      .filter((note) => subjectId === "all" || (subjectId === "none" ? !note.subjectId : note.subjectId === subjectId))
      .filter((note) => !options.pinnedOnly || note.pinned)
      .filter((note) => !query || [note.title, note.body, subjects.get(note.subjectId), tasks.get(note.taskId)]
        .some((text) => String(text || "").toLocaleLowerCase("ru-RU").includes(query)))
      .sort((left, right) => Number(right.pinned) - Number(left.pinned)
        || right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title, "ru-RU"));
  }

  function cleanTitle(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, MAX_TITLE_LENGTH);
  }

  function cleanBody(value) {
    return String(value || "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "")
      .replace(/[ \t]+\n/g, "\n").trim().slice(0, MAX_BODY_LENGTH);
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
  }

  const api = { MAX_BODY_LENGTH, MAX_TITLE_LENGTH, cleanBody, cleanTitle, listNotes, normalizeNote, normalizeNotes };
  global.RhythmNotesModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
