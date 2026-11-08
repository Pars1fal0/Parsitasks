import * as model from "./notes-model.js";
import * as workspaceLocal from "../core/workspace-local.js";

function createNotesView(ctx) {
  const { els } = ctx;
  let mode = "notes";
  let selectedId = "";
  let creating = false;
  let pinnedOnly = false;
  let formSnapshot = "";
  let loadedUpdatedAt = "";
  let draftOwner = null;
  let restorePending = true;
  let reading = false;
  let selectedText = "";
  const readView = document.querySelector("#noteReadView");
  const createTaskButton = document.querySelector("#noteCreateTask");

  function setReading(next) {
    reading = next;
    els.noteForm.classList.toggle("is-reading", reading);
    els.noteTitle.readOnly = reading;
    readView.textContent = els.noteBody.value || "Без текста";
    readView.hidden = !reading;
    els.noteBody.hidden = reading;
    document.querySelectorAll("[data-note-mode]").forEach((button) => button.setAttribute("aria-pressed", String((button.dataset.noteMode === "read") === reading)));
    selectedText = ""; createTaskButton.disabled = true;
  }

  function captureSelection() {
    if (els.noteForm.hidden) return;
    const selection = globalThis.getSelection();
    selectedText = reading
      ? selection?.rangeCount && readView.contains(selection.anchorNode) && readView.contains(selection.focusNode) ? selection.toString().trim() : ""
      : els.noteBody.value.slice(els.noteBody.selectionStart, els.noteBody.selectionEnd).trim();
    createTaskButton.disabled = !selectedText;
  }
  const legacyDrafts = workspaceLocal?.createWorkspaceLocal({ getUserId: ctx.getUserId });
  const local = workspaceLocal?.createWorkspaceLocal({ getUserId: ctx.getUserId, tabScoped: true,
    onError: () => { els.noteStatus.textContent = "Черновик не сохранён. Сохрани заметку перед закрытием."; } });
  const draftKey = (id = selectedId) => `note-draft:${id || "new"}`;

  function bindEvents() {
    document.querySelectorAll("[data-note-mode]").forEach((button) => button.addEventListener("click", () => setReading(button.dataset.noteMode === "read")));
    document.addEventListener("selectionchange", captureSelection);
    els.noteBody.addEventListener("select", captureSelection);
    createTaskButton.addEventListener("pointerdown", (event) => event.preventDefault());
    createTaskButton.addEventListener("click", async () => {
      const text = selectedText;
      if (!text || !await ctx.confirmAction({ title: "Создать задачу из выделения?", message: text.slice(0, 240), confirmLabel: "Создать в «Позже»" })) return;
      if (isDirty() || !currentNote()) saveNote({ preventDefault() {} });
      if (isDirty() || !currentNote()) return;
      ctx.createTaskFromNote?.(currentNote(), text);
      updateOpenTask();
    });
    els.notesTabs.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.notesTab)));
    els.noteNew.addEventListener("click", newNote);
    els.ongoingForm.addEventListener("submit", addOngoing);
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
    els.noteForm.querySelector("#noteDiscardDraft")?.addEventListener("click", async () => {
      if (await ctx.confirmAction({ title: "Удалить черновик заметки?", confirmLabel: "Удалить черновик", tone: "danger" })) discardDraft();
    });
    els.noteForm.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); els.noteForm.requestSubmit(); }
    });
  }

  function render() {
    if (local && draftOwner !== local.owner()) { resetSelection(); draftOwner = local.owner(); restorePending = true; }
    if (restorePending && mode === "notes") {
      restorePending = false;
      let id = local?.read("note-active-draft");
      if (id === null || id === undefined) {
        const legacyId = legacyDrafts?.read("note-active-draft");
        const draft = legacyId !== null && legacyId !== undefined ? legacyDrafts.read(draftKey(legacyId)) : null;
        if (draft && local?.write(draftKey(legacyId), draft) && local.write("note-active-draft", legacyId)) {
          id = legacyId; legacyDrafts.remove(draftKey(legacyId)); legacyDrafts.remove("note-active-draft");
        }
      }
      if (id !== null && id !== undefined) restoreDraft(id);
    }
    document.body.classList.toggle("notes-mode", mode === "notes");
    els.notesTabs.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.notesTab === mode)));
    els.notesPane.hidden = mode !== "notes";
    els.journalPane.hidden = mode !== "journal";
    els.ongoingPane.hidden = mode !== "ongoing";
    els.noteNew.hidden = mode !== "notes";
    if (mode === "journal") {
      ctx.renderJournal();
      return;
    }
    if (mode === "ongoing") {
      renderOngoing();
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

  function ongoingItems() {
    return (ctx.getState().notes || []).filter((note) => note.ongoing === true)
      .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.createdAt.localeCompare(b.createdAt));
  }

  function updateOngoing(note, patch) {
    const next = model.normalizeNote({ ...note, ...patch, updatedAt: new Date(Math.max(Date.now(), (Date.parse(note.updatedAt) || 0) + 1)).toISOString() });
    if (!next) return;
    const undo = ctx.createUndoSnapshot();
    Object.assign(note, next);
    if (ctx.saveState() === false) { ctx.restoreState?.(undo); ctx.showToast("Не удалось сохранить"); }
  }

  function addOngoing(event) {
    event.preventDefault();
    const title = model.cleanTitle(els.ongoingTitle.value);
    if (!title) { els.ongoingTitle.focus(); return; }
    const now = new Date().toISOString();
    const note = model.normalizeNote({ id: ctx.createId(), title, ongoing: true, dueDate: els.ongoingDue.value, createdAt: now, updatedAt: now });
    const undo = ctx.createUndoSnapshot();
    const state = ctx.getState();
    (state.notes ||= []).push(note);
    if (ctx.saveState() === false) { ctx.restoreState?.(undo); ctx.showToast("Не удалось сохранить"); return; }
    els.ongoingForm.reset();
    renderOngoing();
    els.ongoingTitle.focus();
  }

  function finishOngoing(note) {
    const undo = ctx.createUndoSnapshot();
    const state = ctx.getState();
    state.notes = state.notes.filter((item) => item.id !== note.id);
    state.tombstones.notes ||= {};
    state.tombstones.notes[note.id] = new Date().toISOString();
    if (ctx.saveState() === false) { ctx.restoreState?.(undo); ctx.showToast("Не удалось сохранить"); return; }
    renderOngoing();
    ctx.showToast("Готово, убрано из текущих", { undo });
  }

  function renderOngoingStrip() {
    const items = ongoingItems();
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const chips = items.map((note) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ongoing-chip";
      chip.classList.toggle("is-overdue", Boolean(note.dueDate) && note.dueDate < todayKey);
      const progress = model.ongoingProgress(note, ctx.getState().tasks);
      chip.textContent = [note.title, progress.total ? `${progress.done}/${progress.total}` : "", note.dueDate ? `до ${dueLabel(note.dueDate)}` : ""].filter(Boolean).join(" · ");
      chip.title = note.body || note.title;
      chip.addEventListener("click", () => ctx.openOngoing?.());
      return chip;
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "ongoing-chip ongoing-chip-add";
    add.textContent = items.length ? "Изменить" : "+ Добавить текущее";
    add.addEventListener("click", () => ctx.openOngoing?.());
    els.ongoingChips.replaceChildren(...chips, add);
  }

  function dueLabel(dueDate) {
    return dueDate ? `${dueDate.slice(8)}.${dueDate.slice(5, 7)}` : "";
  }

  function todayKeyLocal() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }

  function refreshOngoing() {
    renderOngoing();
    renderOngoingStrip();
  }

  function addNewTask(note, title) {
    const clean = title.trim();
    if (!clean) return false;
    const undo = ctx.createUndoSnapshot();
    const task = ctx.createLaterTask?.(clean);
    if (!task) return false;
    const next = model.normalizeNote({ ...note, linkedTaskIds: [...(note.linkedTaskIds || []), task.id], updatedAt: new Date(Math.max(Date.now(), (Date.parse(note.updatedAt) || 0) + 1)).toISOString() });
    Object.assign(note, next);
    if (ctx.saveState() === false) { ctx.restoreState?.(undo); ctx.showToast("Не удалось сохранить"); return false; }
    return true;
  }

  function renderOngoing() {
    const items = ongoingItems();
    const todayKey = todayKeyLocal();
    const state = ctx.getState();
    els.ongoingEmpty.hidden = items.length > 0;
    els.ongoingList.replaceChildren(...items.map((note) => {
      const progress = model.ongoingProgress(note, state.tasks);
      const card = document.createElement("article");
      card.className = "ongoing-item";
      card.classList.toggle("is-overdue", Boolean(note.dueDate) && note.dueDate < todayKey);

      const top = document.createElement("div");
      top.className = "ongoing-item-top";
      const title = document.createElement("input");
      title.type = "text"; title.maxLength = model.MAX_TITLE_LENGTH; title.className = "ongoing-item-title"; title.value = note.title;
      title.setAttribute("aria-label", "Название");
      title.addEventListener("change", () => {
        const value = model.cleanTitle(title.value);
        if (value) { updateOngoing(note, { title: value }); renderOngoingStrip(); } else title.value = note.title;
      });
      const dueWrap = document.createElement("label");
      dueWrap.className = "ongoing-due-label";
      dueWrap.append(document.createTextNode("Дедлайн "));
      const due = document.createElement("input");
      due.type = "date"; due.value = note.dueDate;
      due.addEventListener("change", () => { updateOngoing(note, { dueDate: due.value }); refreshOngoing(); });
      dueWrap.append(due);
      const done = document.createElement("button");
      done.type = "button"; done.className = "ghost-button compact-button"; done.textContent = "Готово";
      done.title = "Проект завершён: убрать из текущих";
      done.addEventListener("click", () => finishOngoing(note));
      top.append(title, dueWrap, done);
      card.append(top);

      if (progress.total) {
        const label = document.createElement("span");
        label.className = "ongoing-progress-label";
        label.textContent = `Задач выполнено: ${progress.done} из ${progress.total}`;
        const bar = document.createElement("div");
        bar.className = "ongoing-progress";
        const fill = document.createElement("span");
        fill.style.width = `${Math.round((progress.done / progress.total) * 100)}%`;
        bar.append(fill);
        card.append(label, bar);
      }

      if (progress.tasks.length) {
        const list = document.createElement("ul");
        list.className = "ongoing-tasks";
        progress.tasks.forEach((task) => {
          const row = document.createElement("li");
          const isDone = model.taskIsDone(task);
          row.classList.toggle("is-done", isDone);
          const mark = document.createElement("span");
          mark.className = "ongoing-task-mark"; mark.textContent = isDone ? "✓" : "○"; mark.setAttribute("aria-hidden", "true");
          const open = document.createElement("button");
          open.type = "button"; open.className = "ongoing-task-title"; open.textContent = task.title;
          open.title = task.date ? `Открыть задачу · ${task.date}` : "Открыть задачу (в «Позже»)";
          open.addEventListener("click", () => ctx.openTask(task));
          const unlink = document.createElement("button");
          unlink.type = "button"; unlink.className = "icon-button ongoing-task-unlink"; unlink.textContent = "×";
          unlink.setAttribute("aria-label", `Отвязать задачу «${task.title}» от проекта`); unlink.title = "Отвязать (задача останется)";
          unlink.addEventListener("click", () => {
            updateOngoing(note, { linkedTaskIds: note.linkedTaskIds.filter((id) => id !== task.id) });
            refreshOngoing();
          });
          row.append(mark, open, unlink);
          list.append(row);
        });
        card.append(list);
      }

      const actions = document.createElement("div");
      actions.className = "ongoing-item-actions";
      const newTask = document.createElement("input");
      newTask.type = "text"; newTask.maxLength = 240; newTask.placeholder = "+ Новая задача в проект (Enter)";
      newTask.setAttribute("aria-label", "Новая задача в проект");
      newTask.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (addNewTask(note, newTask.value)) refreshOngoing();
      });
      const linked = new Set(note.linkedTaskIds || []);
      const candidates = (state.tasks || []).filter((task) => !linked.has(task.id) && !model.taskIsDone(task) && !task.sourceTaskId)
        .sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 80);
      const picker = document.createElement("select");
      picker.setAttribute("aria-label", "Привязать существующую задачу");
      const placeholder = option("", "Привязать существующую…");
      picker.append(placeholder, ...candidates.map((task) => option(task.id, `${task.title} · ${task.date || "Позже"}`)));
      picker.hidden = candidates.length === 0;
      picker.addEventListener("change", () => {
        if (!picker.value) return;
        updateOngoing(note, { linkedTaskIds: [...(note.linkedTaskIds || []), picker.value] });
        refreshOngoing();
      });
      actions.append(newTask, picker);
      card.append(actions);

      if (note.body) {
        const body = document.createElement("textarea");
        body.className = "ongoing-body"; body.value = note.body; body.maxLength = model.MAX_BODY_LENGTH;
        body.rows = Math.min(8, Math.max(2, note.body.split("\n").length));
        body.setAttribute("aria-label", "Описание");
        body.addEventListener("change", () => { updateOngoing(note, { body: body.value }); if (!body.value.trim()) renderOngoing(); });
        card.append(body);
      } else {
        const addBody = document.createElement("button");
        addBody.type = "button"; addBody.className = "ghost-button compact-button ongoing-add-body"; addBody.textContent = "+ Описание";
        addBody.addEventListener("click", () => {
          const body = document.createElement("textarea");
          body.className = "ongoing-body"; body.rows = 3; body.maxLength = model.MAX_BODY_LENGTH; body.placeholder = "Что важно помнить, ссылки";
          body.setAttribute("aria-label", "Описание");
          body.addEventListener("change", () => { updateOngoing(note, { body: body.value }); renderOngoing(); });
          addBody.replaceWith(body); body.focus();
        });
        card.append(addBody);
      }
      return card;
    }));
  }

  async function setMode(next) {
    if (!["notes", "journal", "ongoing"].includes(next) || next === mode) return true;
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
    restorePending = false;
    fillEditor(null);
    restoreDraft("");
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
    restorePending = false;
    fillEditor(note);
    restoreDraft(id);
    render();
    return true;
  }

  function fillEditor(note) {
    if (local) draftOwner = local.owner();
    els.noteForm.hidden = false;
    els.notePlaceholder.hidden = true;
    els.noteId.value = note?.id || "";
    els.noteTitle.value = note?.title || "";
    els.noteBody.value = note?.body || "";
    setReading(false);
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
    const discard = els.noteForm.querySelector("#noteDiscardDraft");
    if (discard) discard.hidden = true;
    updateOpenTask();
  }

  function renderTaskOptions(preferredId = els.noteTaskId.value) {
    const state = ctx.getState();
    const query = els.noteTaskSearch.value.trim().toLocaleLowerCase("ru-RU");
    const matches = [...(state.tasks || [])]
      .filter((task) => !query || `${task.title} ${task.date}`.toLocaleLowerCase("ru-RU").includes(query))
      .sort((left, right) => (right.date || "").localeCompare(left.date || ""))
      .slice(0, 60);
    const selected = (state.tasks || []).find((task) => task.id === preferredId);
    if (selected && !matches.some((task) => task.id === preferredId)) matches.unshift(selected);
    els.noteTaskId.replaceChildren(option("", "Без задачи"), ...matches.map((task) => option(task.id, `${task.title} · ${task.date || "Позже"}`)));
    els.noteTaskId.value = selected ? preferredId : "";
    updateOpenTask();
  }

  function saveNote(event) {
    event.preventDefault();
    const state = ctx.getState();
    const existing = currentNote();
    const conflict = existing && loadedUpdatedAt && existing.updatedAt !== loadedUpdatedAt;
    const title = model.cleanTitle(els.noteTitle.value);
    if (!title) {
      els.noteTitle.focus();
      ctx.showToast("Укажи название заметки");
      return;
    }
    const now = new Date(Math.max(Date.now(), (Date.parse(existing?.updatedAt) || 0) + 1)).toISOString();
    const note = model.normalizeNote({
      id: !conflict && existing?.id || ctx.createId(),
      title: conflict ? `${title} · моя версия` : title,
      body: els.noteBody.value,
      pinned: els.notePinned.checked,
      subjectId: els.noteSubjectId.value,
      taskId: els.noteTaskId.value,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      bodyBaseUpdatedAt: conflict ? "" : loadedUpdatedAt,
    });
    if (!note) return;
    const undo = ctx.createUndoSnapshot();
    state.notes ||= [];
    if (existing && !conflict) Object.assign(existing, note);
    else state.notes.push(note);
    delete state.tombstones?.notes?.[note.id];
    const saved = ctx.saveState();
    if (saved === false) {
      ctx.restoreState?.(undo);
      persistDraft();
      els.noteStatus.textContent = "Не удалось сохранить заметку. Черновик оставлен на устройстве.";
      renderList();
      return;
    }
    local?.remove(draftKey());
    if (local?.read("note-active-draft") === selectedId) local.remove("note-active-draft");
    selectedId = note.id;
    creating = false;
    loadedUpdatedAt = note.updatedAt;
    els.noteForm.querySelector("#noteDiscardDraft")?.setAttribute("hidden", "");
    if (saved !== false) formSnapshot = captureForm();
    els.noteDelete.hidden = false;
    els.noteUpdatedAt.textContent = `Изменена ${formatDate(note.updatedAt)}`;
    els.noteStatus.textContent = conflict ? "Сохранена отдельная версия: исходная заметка изменена в другой вкладке или на другом устройстве." : "Сохранено";
    renderList();
    els.notesWorkspace.classList.add("is-editing");
    if (saved !== false) ctx.showToast(conflict ? "Заметка изменилась на другом устройстве. Твой текст сохранён отдельной заметкой." : existing ? "Заметка обновлена" : "Заметка создана", { undo });
  }

  async function deleteNote() {
    const note = currentNote();
    const owner = ctx.getUserId?.();
    if (!note || !(await ctx.confirmAction({
      title: "Удалить заметку?",
      message: `Заметка «${note.title}» будет удалена. Связанные задачи и предметы останутся.`,
      confirmLabel: "Удалить",
      tone: "danger",
    }))) return;
    if (ctx.getUserId?.() !== owner) return;
    const undo = ctx.createUndoSnapshot();
    const state = ctx.getState();
    state.notes = state.notes.filter((item) => item.id !== note.id);
    state.tombstones.notes ||= {};
    state.tombstones.notes[note.id] = new Date().toISOString();
    if (ctx.saveState() === false) {
      ctx.restoreState?.(undo);
      persistDraft();
      els.noteStatus.textContent = "Не удалось удалить заметку. Заметка и черновик сохранены.";
      renderList();
      return;
    }
    local?.remove(draftKey(note.id));
    if (local?.read("note-active-draft") === note.id) local.remove("note-active-draft");
    resetSelection();
    render();
    ctx.showToast("Заметка удалена", { undo });
  }

  async function openTask() {
    const taskId = els.noteTaskId.value;
    if (!(await confirmDiscard())) return;
    const task = (ctx.getState().tasks || []).find((item) => item.id === taskId);
    if (task) ctx.openTask(task);
  }

  async function backToList() {
    if (!(await confirmDiscard())) return;
    resetSelection();
    restorePending = false;
    render();
    els.noteNew.focus();
  }

  function isDirty() {
    return mode === "notes" && !els.noteForm.hidden && formSnapshot !== captureForm();
  }

  function hasUnpersistedChanges() {
    return isDirty() && (!local || JSON.stringify(local.read(draftKey())?.fields) !== captureForm());
  }

  async function confirmDiscard() {
    if (!isDirty()) return true;
    const confirmed = await ctx.confirmAction({
      title: "Оставить заметку черновиком?",
      message: "Изменения ещё не сохранены в заметке. Черновик останется на этом устройстве, его можно продолжить позже.",
      confirmLabel: "Оставить черновик и уйти",
      secondaryLabel: "Продолжить редактирование",
      tone: "danger",
    });
    if (confirmed !== true) return false;
    if (!persistDraft()) return false;
    resetSelection();
    restorePending = true;
    return true;
  }

  function discardDraft() {
    local?.remove(draftKey());
    if (local?.read("note-active-draft") === selectedId) local.remove("note-active-draft");
    const note = currentNote();
    if (note) fillEditor(note);
    else resetSelection();
    restorePending = false;
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
    draftOwner = null;
    restorePending = true;
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
    if (isDirty()) persistDraft();
    else els.noteStatus.textContent = "Без изменений";
  }

  function persistDraft() {
    if (!local || (draftOwner !== null && draftOwner !== local.owner())) return false;
    const saved = local.write(draftKey(), { id: selectedId, fields: JSON.parse(captureForm()), baseUpdatedAt: loadedUpdatedAt })
      && local.write("note-active-draft", selectedId);
    els.noteStatus.textContent = saved ? "Черновик на устройстве · не сохранено в заметке" : "Черновик не сохранён";
    const remove = els.noteForm.querySelector("#noteDiscardDraft");
    if (remove) remove.hidden = !saved;
    return saved;
  }

  function restoreDraft(id) {
    const draft = local?.read(draftKey(id));
    if (!draft?.fields) return false;
    const note = (ctx.getState().notes || []).find((item) => item.id === id);
    selectedId = note?.id || ""; creating = !note;
    fillEditor(note || null);
    const fields = draft.fields;
    if (draft.baseUpdatedAt) loadedUpdatedAt = draft.baseUpdatedAt;
    els.noteTitle.value = fields.title || ""; els.noteBody.value = fields.body || "";
    els.notePinned.checked = fields.pinned === true;
    els.noteSubjectId.value = fields.subjectId || "";
    renderTaskOptions(fields.taskId || "");
    els.noteStatus.textContent = note && draft.baseUpdatedAt && note.updatedAt !== draft.baseUpdatedAt
      ? "Восстановлен черновик. Сохранённая заметка изменилась — проверь текст перед сохранением."
      : "Восстановлен черновик на этом устройстве";
    const remove = els.noteForm.querySelector("#noteDiscardDraft");
    if (remove) remove.hidden = false;
    return true;
  }

  function updateOpenTask() {
    els.noteOpenTask.hidden = !(ctx.getState().tasks || []).some((task) => task.id === els.noteTaskId.value);
    const related = (ctx.getState().tasks || []).filter((task) => task.sourceNoteId === selectedId && selectedId);
    document.querySelector("#noteGeneratedTasks").replaceChildren(...related.map((task) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "ghost-button compact-button"; button.textContent = task.title;
      button.addEventListener("click", async () => { if (await confirmDiscard()) ctx.openTask(task); }); return button;
    }));
  }

  return { bindEvents, confirmDiscard, discardDraft, hasUnpersistedChanges, isDirty, newNote, openNote, render, renderOngoingStrip, resetForState, setMode, setSubjectFilter };
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

export { createNotesView };
export default api;
