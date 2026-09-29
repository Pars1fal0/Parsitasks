(function (global) {
  const SOURCE_TYPES = new Set(["task", "goal", "note", "subject", "material"]);
  const TYPE_LABELS = {
    task: "Задача",
    goal: "Цель",
    note: "Заметка",
    subject: "Предмет",
    material: "Материал",
  };

  function resolve(item, state = {}, todayKey = "") {
    const type = item?.sourceType;
    const id = item?.sourceId;
    if (!SOURCE_TYPES.has(type) || !id) return null;
    const collections = {
      task: state.tasks,
      goal: state.goals,
      note: state.notes,
      subject: state.studySubjects,
      material: state.studyFiles,
    };
    const source = (collections[type] || []).find((entry) => entry.id === id);
    if (!source) return { type, id, typeLabel: TYPE_LABELS[type], title: "Источник удалён", detail: "Убрать карточку с доски", status: "missing", missing: true };
    const subjectName = (state.studySubjects || []).find((subject) => subject.id === source.subjectId)?.name || "";
    if (type === "task") {
      const recurring = Boolean(source.repeat && source.repeat !== "none");
      const done = recurring ? source.completed?.[todayKey] === true
        : Object.entries(source.completed || {}).some(([day, value]) => value === true && (!todayKey || day <= todayKey));
      return {
        type, id, typeLabel: TYPE_LABELS[type], title: source.title || "Задача",
        detail: [subjectName, recurring ? "Повторяющаяся задача" : source.date ? formatDate(source.date) : ""].filter(Boolean).join(" · "),
        status: done ? recurring ? "Сегодня выполнена" : "Выполнена"
          : recurring ? "Повторяется" : source.date && source.date < todayKey ? "Просрочена" : "В работе",
        tone: done ? "done" : !recurring && source.date && source.date < todayKey ? "overdue" : "active",
      };
    }
    if (type === "goal") return {
      type, id, typeLabel: TYPE_LABELS[type], title: source.title || "Цель",
      detail: source.dueDate ? `До ${formatDate(source.dueDate)}` : "Без срока",
      status: source.status === "done" ? "Достигнута" : "В работе",
      tone: source.status === "done" ? "done" : "active",
    };
    if (type === "note") return {
      type, id, typeLabel: TYPE_LABELS[type], title: source.title || "Заметка",
      detail: subjectName || String(source.body || "").replace(/\s+/g, " ").slice(0, 100),
      status: source.pinned ? "Закреплена" : "Заметка", tone: "neutral",
    };
    if (type === "subject") return {
      type, id, typeLabel: TYPE_LABELS[type], title: source.name || "Предмет",
      detail: source.teacher || "Расписание и материалы", status: "Предмет", tone: "neutral",
    };
    return {
      type, id, typeLabel: TYPE_LABELS[type], title: source.name || "Материал",
      detail: subjectName || "Google Drive", status: "Файл", tone: "neutral",
    };
  }

  function list(state = {}, options = {}) {
    const type = options.type || "all";
    const query = String(options.query || "").trim().toLocaleLowerCase("ru-RU");
    const linked = new Set(options.linked || []);
    const collections = [
      ["task", state.tasks], ["goal", state.goals], ["note", state.notes],
      ["subject", state.studySubjects], ["material", state.studyFiles],
    ];
    return collections.flatMap(([kind, values]) => (values || [])
      .filter((entry) => type === "all" || type === kind)
      .filter((entry) => !linked.has(`${kind}:${entry.id}`))
      .map((entry) => resolve({ sourceType: kind, sourceId: entry.id }, state, options.todayKey))
      .filter((entry) => entry && (!query || [entry.title, entry.detail, entry.typeLabel]
        .some((value) => String(value || "").toLocaleLowerCase("ru-RU").includes(query)))))
      .sort((left, right) => left.title.localeCompare(right.title, "ru-RU"))
      .slice(0, 80);
  }

  function formatDate(value) {
    const [year, month, day] = String(value).split("-");
    return year && month && day ? `${day}.${month}.${year}` : value;
  }

  const api = { list, resolve, SOURCE_TYPES, TYPE_LABELS };
  global.RhythmBoardLinks = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
