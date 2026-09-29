(function (global) {
  const model = global.RhythmNotesModel;

  function createNotesView(ctx) {
    const { els } = ctx;
    let mode = "notes";
    let selectedId = "";
    let creating = false;
    let pinnedOnly = false;
    let formSnapshot = "";
    let loadedUpdatedAt = "";

    function bindEvents() {
      els.notesTabs.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.notesTab)));
      els.noteNew.addEventListener("click", newNote);
      els.noteSearch.addEventListener("input", renderList);
      els.noteSubjectFilter.addEventListener("change", renderList);
      els.notePinnedOnly.addEventListener("click", () => {
        pinnedOnly = !pinnedOnly;
        renderList();
      });
      els.noteForm.addEventListener("submit", saveNote);
      els.noteForm.addEventListener("input", (event) => {
        if (event.target !== els.noteTaskSearch) markDirtyStatus();
      });
      els.noteForm.addEventListener("change", markDirtyStatus);
      els.noteTaskSearch.addEventListener("input", renderTaskOptions);
      els.noteSubjectId.addEventListener("change", () => { renderTaskOptions(); markDirtyStatus(); });
      els.noteTaskId.addEventListener("change", () => { updateOpenTask(); markDirtyStatus(); });
      els.noteDelete.addEventListener("click", deleteNote);
      els.noteOpenTask.addEventListener("click", openTask);
      els.noteBack.addEventListener("click", backToList);
    }

    function render() {
      document.body.classList.toggle("notes-mode", mode === "notes");
      els.notesTabs.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.notesTab === mode)));
      els.notesPane.hidden = mode !== "notes";
      els.journalPane.hidden = mode !== "journal";
      els.noteNew.hidden = mode !== "notes";
      if (mode === "journal") {
        ctx.renderJournal();
        return;
      }
      renderSubjectOptions();
      renderList();
      const selected = currentNote();
      if (selectedId && !selected && isDirty()) {
        selectedId = "";
        creating = true;
        els.noteId.value = "";
        els.noteDelete.hidden = true;
        els.noteStatus.textContent = "Исходная заметка удалена. Сохрани копию.";
      } else if (selectedId && !selected) resetSelection();
      else if (selected && !isDirty() && loadedUpdatedAt !== selected.updatedAt) fillEditor(selected);
      els.notesWorkspace.classList.toggle("is-editing", creating || Boolean(selectedId));
    }

    function renderSubjectOptions() {
      const state = ctx.getState();
      const filterValue = els.noteSubjectFilter.value || "all";
      const selectedSubject = els.noteSubjectId.value;
      els.noteSubjectFilter.replaceChildren(option("all", "Все заметки"), option("none", "Без предмета"),
        ...(state.studySubjects || []).map((subject) => option(subject.id, subject.name)));
      els.noteSubjectFilter.value = [...els.noteSubjectFilter.options].some((item) => item.value === filterValue) ? filterValue : "all";
      els.noteSubjectId.replaceChildren(option("", "Без предмета"),
        ...(state.studySubjects || []).map((subject) => option(subject.id, subject.name)));
      els.noteSubjectId.value = selectedSubject;
    }

    function renderList() {
      const state = ctx.getState();
      const notes = model.listNotes(state.notes, {
        query: els.noteSearch.value,
        subjectId: els.noteSubjectFilter.value,
        pinnedOnly,
        subjects: state.studySubjects,
        tasks: state.tasks,
      });
      els.notePinnedOnly.setAttribute("aria-pressed", String(pinnedOnly));
      els.noteCount.textContent = plural(notes.length, "заметка", "заметки", "заметок");
      els.notesEmpty.hidden = notes.length > 0;
      els.notesEmpty.textContent = (state.notes || []).length ? "По этому запросу заметок нет." : "Заметок пока нет.";
      els.noteList.replaceChildren(...notes.map((note) => {
        const button = document.createElement("button");
        const title = document.createElement("span");
        const preview = document.createElement("span");
        const meta = document.createElement("span");
        button.type = "button";
        button.className = "notes-list-item";
        button.classList.toggle("is-active", selectedId === note.id);
        title.className = "notes-list-title";
        if (note.pinned) title.append(icon("pin"));
        title.append(document.createTextNode(note.title));
        preview.className = "notes-list-preview";
        preview.textContent = note.body || "Без текста";
        meta.className = "notes-list-meta";
        const subject = (state.studySubjects || []).find((item) => item.id === note.subjectId);
        meta.textContent = [subject?.name, formatDate(note.updatedAt)].filter(Boolean).join(" · ");
        button.append(title, preview, meta);
        button.addEventListener("click", () => openNote(note.id));
        return button;
      }));
    }

    async function setMode(next) {
      if (!["notes", "journal"].includes(next) || next === mode) return true;
      if (!(await confirmDiscard())) return false;
      mode = next;
      render();
      return true;
    }

    async function newNote() {
      if (!(await confirmDiscard())) return;
      mode = "notes";
      selectedId = "";
      creating = true;
      fillEditor(null);
      render();
      els.noteTitle.focus();
    }

    async function openNote(id) {
      if (id === selectedId && mode === "notes") return true;
      if (!(await confirmDiscard())) return false;
      const note = (ctx.getState().notes || []).find((item) => item.id === id);
      if (!note) return false;
      mode = "notes";
      selectedId = id;
      creating = false;
      fillEditor(note);
      render();
      return true;
    }

    function fillEditor(note) {
      els.noteForm.hidden = false;
      els.notePlaceholder.hidden = true;
      els.noteId.value = note?.id || "";
      els.noteTitle.value = note?.title || "";
      els.noteBody.value = note?.body || "";
      els.notePinned.checked = note?.pinned === true;
      renderSubjectOptions();
      els.noteSubjectId.value = note?.subjectId || "";
      els.noteTaskSearch.value = "";
      renderTaskOptions(note?.taskId || "");
      els.noteDelete.hidden = !note;
      els.noteUpdatedAt.textContent = note ? `Изменена ${formatDate(note.updatedAt)}` : "Новая заметка";
      loadedUpdatedAt = note?.updatedAt || "";
      formSnapshot = captureForm();
      els.noteStatus.textContent = "";
      updateOpenTask();
    }

    function renderTaskOptions(preferredId = els.noteTaskId.value) {
      const state = ctx.getState();
      const query = els.noteTaskSearch.value.trim().toLocaleLowerCase("ru-RU");
      const matches = [...(state.tasks || [])]
        .filter((task) => !query || `${task.title} ${task.date}`.toLocaleLowerCase("ru-RU").includes(query))
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, 60);
      const selected = (state.tasks || []).find((task) => task.id === preferredId);
      if (selected && !matches.some((task) => task.id === preferredId)) matches.unshift(selected);
      els.noteTaskId.replaceChildren(option("", "Без задачи"), ...matches.map((task) => option(task.id, `${task.title} · ${task.date}`)));
      els.noteTaskId.value = selected ? preferredId : "";
      updateOpenTask();
    }

    function saveNote(event) {
      event.preventDefault();
      const state = ctx.getState();
      const existing = currentNote();
      const title = model.cleanTitle(els.noteTitle.value);
      if (!title) {
        els.noteTitle.focus();
        ctx.showToast("Укажи название заметки");
        return;
      }
      const now = new Date().toISOString();
      const note = model.normalizeNote({
        id: existing?.id || ctx.createId(),
        title,
        body: els.noteBody.value,
        pinned: els.notePinned.checked,
        subjectId: els.noteSubjectId.value,
        taskId: els.noteTaskId.value,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
      if (!note) return;
      const undo = ctx.createUndoSnapshot();
      state.notes ||= [];
      if (existing) Object.assign(existing, note);
      else state.notes.push(note);
      delete state.tombstones?.notes?.[note.id];
      const saved = ctx.saveState();
      selectedId = note.id;
      creating = false;
      loadedUpdatedAt = note.updatedAt;
      if (saved !== false) formSnapshot = captureForm();
      els.noteDelete.hidden = false;
      els.noteUpdatedAt.textContent = `Изменена ${formatDate(note.updatedAt)}`;
      els.noteStatus.textContent = saved === false ? "Не сохранено локально" : "Сохранено";
      renderList();
      els.notesWorkspace.classList.add("is-editing");
      if (saved !== false) ctx.showToast(existing ? "Заметка обновлена" : "Заметка создана", { undo });
    }

    async function deleteNote() {
      const note = currentNote();
      if (!note || !(await ctx.confirmAction({
        title: "Удалить заметку?",
        message: `Заметка «${note.title}» будет удалена. Связанные задачи и предметы останутся.`,
        confirmLabel: "Удалить",
        tone: "danger",
      }))) return;
      const undo = ctx.createUndoSnapshot();
      const state = ctx.getState();
      state.notes = state.notes.filter((item) => item.id !== note.id);
      state.tombstones.notes ||= {};
      state.tombstones.notes[note.id] = new Date().toISOString();
      ctx.saveState();
      resetSelection();
      render();
      ctx.showToast("Заметка удалена", { undo });
    }

    async function openTask() {
      if (!(await confirmDiscard())) return;
      const taskId = els.noteTaskId.value;
      const task = (ctx.getState().tasks || []).find((item) => item.id === taskId);
      if (task) ctx.openTask(task);
    }

    async function backToList() {
      if (!(await confirmDiscard())) return;
      resetSelection();
      render();
      els.noteNew.focus();
    }

    function isDirty() {
      return mode === "notes" && !els.noteForm.hidden && formSnapshot !== captureForm();
    }

    async function confirmDiscard() {
      if (!isDirty()) return true;
      const confirmed = await ctx.confirmAction({
        title: "Уйти без сохранения?",
        message: "Изменения в заметке ещё не сохранены.",
        confirmLabel: "Не сохранять",
        secondaryLabel: "Продолжить редактирование",
        tone: "danger",
      });
      if (confirmed !== true) return false;
      discardDraft();
      return true;
    }

    function discardDraft() {
      const note = currentNote();
      if (note) fillEditor(note);
      else resetSelection();
    }

    function resetSelection() {
      selectedId = "";
      creating = false;
      loadedUpdatedAt = "";
      formSnapshot = "";
      els.noteForm.hidden = true;
      els.notePlaceholder.hidden = false;
      els.notesWorkspace.classList.remove("is-editing");
    }

    function resetForState() {
      resetSelection();
      els.noteSearch.value = "";
      els.noteSubjectFilter.value = "all";
      pinnedOnly = false;
    }

    function setSubjectFilter(subjectId = "all") {
      mode = "notes";
      resetSelection();
      renderSubjectOptions();
      els.noteSubjectFilter.value = [...els.noteSubjectFilter.options].some((item) => item.value === subjectId) ? subjectId : "all";
      render();
    }

    function currentNote() {
      return (ctx.getState().notes || []).find((item) => item.id === selectedId) || null;
    }

    function captureForm() {
      return JSON.stringify({
        title: els.noteTitle.value,
        body: els.noteBody.value,
        pinned: els.notePinned.checked,
        subjectId: els.noteSubjectId.value,
        taskId: els.noteTaskId.value,
      });
    }

    function markDirtyStatus() {
      els.noteStatus.textContent = isDirty() ? "Не сохранено" : "";
    }

    function updateOpenTask() {
      els.noteOpenTask.hidden = !(ctx.getState().tasks || []).some((task) => task.id === els.noteTaskId.value);
    }

    return { bindEvents, confirmDiscard, discardDraft, isDirty, newNote, openNote, render, resetForState, setMode, setSubjectFilter };
  }

  function option(value, label) {
    const element = document.createElement("option");
    element.value = value;
    element.textContent = label;
    return element;
  }

  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    svg.classList.add("ui-icon");
    use.setAttribute("href", `#icon-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function plural(count, one, few, many) {
    const number = Math.abs(count) % 100;
    const last = number % 10;
    return `${count} ${number > 10 && number < 20 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many}`;
  }

  const api = { createNotesView };
  global.RhythmNotesView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
