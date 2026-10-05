(function (global) {
  function normalizeSubjects(value, config) {
    return unique(value, (subject) => ({
      id: String(subject.id || config.createId()),
      name: config.cleanText(subject.name).slice(0, 80) || "Предмет",
      color: config.sanitizeColor(subject.color) || "#56c8a6",
      teacher: config.cleanText(subject.teacher).slice(0, 120),
      semester: config.cleanText(subject.semester).slice(0, 80),
      archived: subject.archived === true,
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
        weekType: ["even", "odd"].includes(lesson.weekType) ? lesson.weekType : "all",
        lessonType: ["lecture", "practice"].includes(lesson.lessonType) ? lesson.lessonType : "",
        teacher: config.cleanText(lesson.teacher).slice(0, 120),
        startTime, endTime, room: config.cleanText(lesson.room).slice(0, 80),
        exceptions: normalizeExceptions(lesson.exceptions, config),
        createdAt: timestamp(lesson.createdAt), updatedAt: timestamp(lesson.updatedAt || lesson.createdAt),
      };
    });
  }

  function normalizeWeekCycle(value) {
    const anchorMonday = mondayKey(value?.anchorMonday);
    return {
      anchorMonday,
      anchorParity: value?.anchorParity === "odd" ? "odd" : "even",
      updatedAt: anchorMonday && Number.isFinite(Date.parse(value?.updatedAt)) ? value.updatedAt : "",
    };
  }

  function mondayKey(value) {
    const date = parseDateKey(value);
    if (!date) return "";
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date.toISOString().slice(0, 10);
  }

  function weekParity(dateKey, cycle) {
    const anchor = mondayKey(cycle?.anchorMonday);
    const monday = mondayKey(dateKey);
    if (!anchor || !monday) return "";
    const weeks = Math.round((Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 604800000);
    const anchorParity = cycle.anchorParity === "odd" ? "odd" : "even";
    if (Math.abs(weeks) % 2 === 0) return anchorParity;
    return anchorParity === "even" ? "odd" : "even";
  }

  function lessonOccursOnDate(lesson, dateKey, cycle) {
    if (lesson.exceptions?.[dateKey]) return lesson.exceptions[dateKey].cancelled !== true && (!lesson.exceptions[dateKey].date || lesson.exceptions[dateKey].date === dateKey);
    if (Object.values(lesson.exceptions || {}).some((entry) => !entry.cancelled && entry.date === dateKey)) return true;
    const date = parseDateKey(dateKey);
    if (!date || lesson.weekday !== date.getUTCDay()) return false;
    const weekType = lesson.weekType || "all";
    return weekType === "all" || weekParity(dateKey, cycle) === weekType;
  }

  function nextLessonDate(lessons, subjectId, afterDateKey, cycle, currentTime = "") {
    return nextLessonOccurrence(lessons, subjectId, afterDateKey, cycle, currentTime)?.date || "";
  }

  function nextLessonOccurrence(lessons, subjectId, afterDateKey, cycle, currentTime = "") {
    const after = parseDateKey(afterDateKey);
    if (!after) return "";
    const relevant = lessons.filter((lesson) => lesson.subjectId === subjectId && (cycle?.anchorMonday || !lesson.weekType || lesson.weekType === "all"));
    if (!relevant.length) return "";
    for (const preferredType of ["practice", "other"]) {
      for (let offset = currentTime ? 0 : 1; offset <= 366; offset++) {
        const candidate = new Date(after);
        candidate.setUTCDate(candidate.getUTCDate() + offset);
        const key = candidate.toISOString().slice(0, 10);
        const upcoming = relevant.filter((lesson) => (preferredType === "practice" ? lesson.lessonType === "practice" : lesson.lessonType !== "practice") && lessonOccursOnDate(lesson, key, cycle))
          .map((lesson) => {
            const overrides = lesson.exceptions?.[key] || Object.values(lesson.exceptions || {}).find((entry) => !entry.cancelled && entry.date === key) || {};
            return { ...lesson, ...overrides, date: key };
          }).filter((lesson) => offset !== 0 || lesson.startTime > currentTime)
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        if (upcoming.length) return upcoming[0];
      }
    }
    return "";
  }

  function isHomeworkVisible(task, todayKey) {
    return task.completed?.[task.date || task.dueDate] !== true || (task.dueDate || task.date) >= todayKey;
  }

  function eventsForDate(state = {}, dateKey, options = {}) {
    const subjects = new Map((state.studySubjects || []).map((subject) => [subject.id, subject]));
    return (state.studyLessons || []).filter((lesson) => subjects.has(lesson.subjectId) && (options.includeArchived || !subjects.get(lesson.subjectId).archived)
      && lessonOccursOnDate(lesson, dateKey, state.studyWeekCycle)).map((lesson) => {
      const subject = subjects.get(lesson.subjectId);
      const overrides = lesson.exceptions?.[dateKey] || Object.values(lesson.exceptions || {}).find((entry) => !entry.cancelled && entry.date === dateKey) || {};
      return { ...lesson, ...overrides, date: dateKey, title: subject.name, color: subject.color,
        teacher: lesson.teacher || subject.teacher || "",
        typeLabel: lesson.lessonType === "practice" ? "Практика" : lesson.lessonType === "lecture" ? "Лекция" : "Занятие" };
    }).sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  function normalizeExceptions(value, config) {
    const result = {};
    for (const [day, entry] of Object.entries(value || {})) {
      if (!parseDateKey(day) || !entry || typeof entry !== "object") continue;
      const date = parseDateKey(entry.date) ? entry.date : day;
      const startTime = config.cleanTimeValue(entry.startTime); const endTime = config.cleanTimeValue(entry.endTime);
      if (!entry.cancelled && (!startTime || !endTime || endTime <= startTime)) continue;
      result[day] = { date, cancelled: entry.cancelled === true, ...(startTime && endTime ? {startTime, endTime} : {}), room: config.cleanText(entry.room).slice(0,80) };
    }
    return result;
  }

  function parseDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
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

  const api = { eventsForDate, isHomeworkVisible, lessonOccursOnDate, mondayKey, nextLessonDate, nextLessonOccurrence, normalizeFiles, normalizeLessons, normalizeSubjects, normalizeTaskStudy, normalizeWeekCycle, weekParity };
  global.RhythmStudyModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
