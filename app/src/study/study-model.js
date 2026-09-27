(function (global) {
  function normalizeSubjects(value, config) {
    return unique(value, (subject) => ({
      id: String(subject.id || config.createId()),
      name: config.cleanText(subject.name).slice(0, 80) || "Предмет",
      color: config.sanitizeColor(subject.color) || "#56c8a6",
      teacher: config.cleanText(subject.teacher).slice(0, 120),
      createdAt: timestamp(subject.createdAt),
      updatedAt: timestamp(subject.updatedAt || subject.createdAt),
    }));
  }

  function normalizeLessons(value, config, subjects) {
    const subjectIds = new Set(subjects.map((subject) => subject.id));
    return unique(value, (lesson) => {
      const weekday = Number(lesson.weekday);
      const startTime = config.cleanTimeValue(lesson.startTime);
      const endTime = config.cleanTimeValue(lesson.endTime);
      if (!subjectIds.has(lesson.subjectId) || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !startTime || !endTime || endTime <= startTime) return null;
      return {
        id: String(lesson.id || config.createId()), subjectId: lesson.subjectId, weekday,
        startTime, endTime, room: config.cleanText(lesson.room).slice(0, 80),
        createdAt: timestamp(lesson.createdAt), updatedAt: timestamp(lesson.updatedAt || lesson.createdAt),
      };
    });
  }

  function normalizeFiles(value, config, subjects) {
    const subjectIds = new Set(subjects.map((subject) => subject.id));
    return unique(value, (file) => {
      const googleId = String(file.googleId || "").trim();
      if (!googleId || !/^[A-Za-z0-9_-]+$/.test(googleId)) return null;
      return {
        id: String(file.id || config.createId()), googleId,
        name: config.cleanText(file.name).slice(0, 240) || "Файл",
        mime: config.cleanText(file.mime).slice(0, 120),
        size: Math.max(0, Number(file.size) || 0),
        subjectId: subjectIds.has(file.subjectId) ? file.subjectId : "",
        url: `https://drive.google.com/file/d/${encodeURIComponent(googleId)}/view`,
        createdAt: timestamp(file.createdAt), updatedAt: timestamp(file.updatedAt || file.createdAt),
      };
    });
  }

  function normalizeTaskStudy(task, config, subjects, files) {
    const subjectIds = new Set(subjects.map((subject) => subject.id));
    const fileIds = new Set(files.map((file) => file.id));
    const studySubjectId = subjectIds.has(task.studySubjectId) ? task.studySubjectId : "";
    if (!studySubjectId) return { studySubjectId: "", studyDetails: "", studyAssignedDate: "", studyFileIds: [] };
    return {
      studySubjectId,
      studyDetails: config.cleanText(task.studyDetails).slice(0, 4000),
      studyAssignedDate: config.normalizeDateKey(task.studyAssignedDate, ""),
      studyFileIds: Array.isArray(task.studyFileIds) ? [...new Set(task.studyFileIds.filter((id) => fileIds.has(id)))].slice(0, 30) : [],
    };
  }

  function unique(value, transform) {
    const byId = new Map();
    (Array.isArray(value) ? value : []).forEach((item) => {
      if (!item || typeof item !== "object") return;
      const normalized = transform(item);
      if (normalized?.id && !byId.has(normalized.id)) byId.set(normalized.id, normalized);
    });
    return [...byId.values()];
  }

  function timestamp(value) { return Number.isFinite(Date.parse(value)) ? value : new Date().toISOString(); }

  const api = { normalizeFiles, normalizeLessons, normalizeSubjects, normalizeTaskStudy };
  global.RhythmStudyModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
