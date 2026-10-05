(function (global) {
  const WEEKDAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
  const BASE_URL = "https://parsitasks.ru";
  const studyModel = global.RhythmStudyModel;

  function createStudyController(ctx) {
    const root = document.querySelector("#studyView");
    const homeworkForm = root.querySelector("#studyHomeworkForm");
    const lessonForm = root.querySelector("#studyLessonForm");
    const weekCycleForm = root.querySelector("#studyWeekCycleForm");
    const subjectForm = root.querySelector("#studySubjectForm");
    const materialForm = root.querySelector("#studyMaterialForm");
    let tab = "homework";
    let connected = false;
    let configured = true;
    let setupRequired = false;
    let lastError = "";
    let statusUserId = "";
    let busy = false;
    let scheduleMode = "week";
    let viewedDateKey = ctx.getActiveDate();
    let viewedWeekMonday = studyModel.mondayKey(viewedDateKey);
    let displayedCycleKey = "";
    let draftOwner = null;
    let subjectReturnTab = "";
    let archivedView = false;
    let semester = "all";
    let homeworkHistory = false;
    let focusedMaterialId = "";
    let suggestedTime = "";
    let deadlineTimeEdited = false;
    let pendingUpload = null;
    let uploadOwner = "";
    function pendingMaterial() {
      if (uploadOwner !== local.owner()) { uploadOwner = local.owner(); pendingUpload = local.read("study-upload-pending"); }
      return pendingUpload;
    }
    const periodControls = element("div", "study-period-controls");
    const periodSelect = element("select");
    periodSelect.setAttribute("aria-label", "Учебный период");
    const archiveToggle = element("button", "ghost-button compact-button", "Архив семестров");
    archiveToggle.type = "button";
    archiveToggle.setAttribute("aria-pressed", "false");
    const archivePeriod = element("button", "ghost-button compact-button", "Завершить семестр");
    archivePeriod.type = "button";
    const periodMenu = element("details", "study-period-menu");
    const periodMenuSummary = element("summary", "icon-button");
    periodMenuSummary.setAttribute("aria-label", "Управление семестрами");
    periodMenuSummary.title = "Управление семестрами";
    const periodMenuIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    periodMenuIcon.classList.add("ui-icon");
    periodMenuIcon.setAttribute("aria-hidden", "true");
    const periodMenuUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
    periodMenuUse.setAttribute("href", "#icon-more");
    periodMenuIcon.append(periodMenuUse);
    periodMenuSummary.append(periodMenuIcon);
    const periodMenuActions = element("div", "study-period-menu-actions");
    periodMenuActions.append(archiveToggle, archivePeriod);
    periodMenu.append(periodMenuSummary, periodMenuActions);
    periodControls.append(periodSelect, periodMenu);
    root.querySelector(".study-tabs").after(periodControls);
    const archivedNotice = element("div", "study-archive-notice");
    archivedNotice.hidden = true;
    const returnToCurrent = element("button", "ghost-button compact-button", "К текущим предметам");
    returnToCurrent.type = "button";
    archivedNotice.append(element("span", "", "Архив семестров"), returnToCurrent);
    periodControls.after(archivedNotice);
    const historyToggle = element("button", "ghost-button compact-button", "История ДЗ");
    historyToggle.type = "button";
    historyToggle.setAttribute("aria-pressed", "false");
    root.querySelector(".study-homework-tools").append(historyToggle);
    const materialSearch = element("input");
    materialSearch.type = "search";
    materialSearch.placeholder = "Найти материал";
    materialSearch.setAttribute("aria-label", "Поиск материалов");
    root.querySelector("#studyMaterialList").before(materialSearch);

    function includesSubject(subject) {
      return Boolean(subject) && Boolean(subject.archived) === archivedView && (semester === "all" || (subject.semester || "") === semester);
    }

    async function setArchived(subjects, archived) {
      if (!subjects.length) return;
      if (!await ctx.confirmAction({ title: archived ? "Завершить учебный период?" : "Вернуть предметы из архива?", message: "Занятия, задания, заметки и файлы сохранятся. Архив доступен в разделе учёбы.", confirmLabel: archived ? "В архив" : "Восстановить" })) return;
      const previous = subjects.map((subject) => ({ subject, archived: subject.archived, updatedAt: subject.updatedAt }));
      subjects.forEach((subject) => { subject.archived = archived; subject.updatedAt = new Date().toISOString(); });
      if (ctx.saveState() === false) previous.forEach(({ subject, ...fields }) => Object.assign(subject, fields));
      ctx.render();
    }
    const local = global.RhythmWorkspaceLocal.createWorkspaceLocal({ getUserId: ctx.getUserId,
      onError: () => ctx.showToast("Не удалось сохранить черновик. Не закрывай приложение до сохранения задания.") });
    const draftStatus = root.querySelector("#studyHomeworkDraftStatus");
    const discardDraftButton = root.querySelector("#studyHomeworkDiscardDraft");
    const homeworkDraft = local.formDraft(homeworkForm, "study-homework-draft", (saved) => {
      draftStatus.textContent = saved ? "Черновик сохранён на этом устройстве" : "Черновик не сохранён";
      discardDraftButton.hidden = !saved;
    });
    const formDialogs = new Map();
    const fingerprints = new Map();
    const formErrors = new Map();
    let closingForm = false;
    const fingerprint = (form) => JSON.stringify([...new FormData(form)].map(([key, value]) => [key, value instanceof File ? `${value.name}:${value.size}:${value.lastModified}` : value]));
    [homeworkForm, lessonForm, subjectForm, materialForm].forEach((form) => {
      const dialog = element("dialog", "study-create-dialog");
      const saveError = element("small", "form-save-error"); saveError.setAttribute("role", "alert");
      form.insertBefore(saveError, form.querySelector('.study-form-actions, button[type="submit"]'));
      formErrors.set(form, saveError);
      dialog.id = `${form.getAttribute("id")}Dialog`;
      const heading = form.querySelector("h3"); heading.id ||= `${form.getAttribute("id")}Title`;
      dialog.setAttribute("aria-labelledby", heading.id);
      const close = element("button", "icon-button study-dialog-close"); close.type = "button";
      close.setAttribute("aria-label", "Закрыть форму");
      close.append(actionIcon("icon-close"));
      dialog.append(close, form); root.append(dialog); formDialogs.set(form, dialog);
      close.addEventListener("click", () => closeForm(form));
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeForm(form); });
      dialog.addEventListener("click", (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeForm(form); } });
    });
    function showForm(form, focus) {
      formErrors.get(form).textContent = "";
      form.hidden = false;
      fingerprints.set(form, fingerprint(form));
      const dialog = formDialogs.get(form);
      if (!dialog.open) dialog.showModal();
      if (form !== materialForm) form.querySelector('[id$="Cancel"]').hidden = false;
      (focus || form.querySelector("input:not([type=hidden]), select"))?.focus();
    }
    async function closeForm(form) {
      if (closingForm || !formDialogs.get(form).open) return;
      const dialog = formDialogs.get(form);
      const owner = ctx.getState();
      const returnTab = subjectReturnTab;
      if (form === materialForm && busy) { formErrors.get(form).textContent = "Дождитесь завершения загрузки перед закрытием."; return; }
      if (form === homeworkForm) {
        const fields = homeworkForm.elements;
        const hasDraft = [fields.id, fields.subjectId, fields.title, fields.details, fields.time, fields.planDate].some((input) => input.value.trim()) || homeworkForm.querySelector('input[name="studyFile"]:checked');
        if (hasDraft && !homeworkDraft.save()) return;
        if (!hasDraft) { homeworkDraft.clear(); draftStatus.textContent = ""; discardDraftButton.hidden = true; }
      } else if (fingerprints.get(form) !== fingerprint(form)) {
        closingForm = true;
        let discard;
        try { discard = await ctx.confirmAction({ title: "Закрыть без сохранения?", message: "Изменения в форме будут потеряны.", confirmLabel: "Закрыть", tone: "danger" }); }
        finally { closingForm = false; }
        if (!discard || owner !== ctx.getState()) return;
        if (form === lessonForm) resetLessonForm();
        else if (form === subjectForm) resetSubjectForm();
        else form.reset();
      }
      dialog.close();
      if (form === subjectForm && returnTab === "homework") { subjectReturnTab = ""; if (ctx.getState().studySubjects.some((subject) => !subject.archived)) showForm(homeworkForm, homeworkForm.elements.title); }
    }
    function newSubject(returnTab) {
      subjectReturnTab = returnTab;
      formDialogs.get(homeworkForm).close();
      resetSubjectForm(); subjectReturnTab = returnTab;
      root.querySelector("#studySubjectFormTitle").textContent = "Новый предмет";
      showForm(subjectForm, subjectForm.elements.name);
    }
    global.addEventListener("beforeunload", (event) => {
      if ([lessonForm, subjectForm, materialForm].some((form) => formDialogs.get(form).open && fingerprints.get(form) !== fingerprint(form))) { event.preventDefault(); event.returnValue = ""; }
    });

    function bindEvents() {
      periodSelect.addEventListener("change", () => { semester = periodSelect.value; render(); });
      archiveToggle.addEventListener("click", () => { periodMenu.open = false; archivedView = !archivedView; render(); });
      returnToCurrent.addEventListener("click", () => { archivedView = false; render(); });
      archivePeriod.addEventListener("click", () => { periodMenu.open = false; setArchived(ctx.getState().studySubjects.filter(includesSubject), true); });
      periodMenu.addEventListener("keydown", (event) => { if (event.key === "Escape") { periodMenu.open = false; periodMenuSummary.focus(); } });
      document.addEventListener("click", (event) => { if (!periodMenu.contains(event.target)) periodMenu.open = false; });
      document.addEventListener("click", (event) => root.querySelectorAll(".study-row-menu[open]").forEach((menu) => { if (!menu.contains(event.target)) menu.open = false; }));
      historyToggle.addEventListener("click", () => { homeworkHistory = !homeworkHistory; historyToggle.setAttribute("aria-pressed", String(homeworkHistory)); renderHomework(ctx.getState()); });
      materialSearch.addEventListener("input", () => { focusedMaterialId = ""; renderMaterials(ctx.getState()); });
      root.querySelectorAll("[data-study-tab]").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.studyTab)));
      root.querySelector("#studyHomeworkFilter").addEventListener("change", render);
      root.querySelector("#studyJumpToHomeworkForm").addEventListener("click", () => {
        if (!ctx.getState().studySubjects.some((subject) => !subject.archived)) return newSubject("homework");
        showForm(homeworkForm, homeworkForm.elements.title);
      });
      root.querySelector("#studyNewLesson").addEventListener("click", () => {
        if (!ctx.getState().studySubjects.some((subject) => !subject.archived)) return newSubject("schedule");
        resetLessonForm(); showForm(lessonForm);
      });
      root.querySelector("#studyNewMaterial").addEventListener("click", () => showForm(materialForm));
      root.querySelectorAll("[data-study-add-subject]").forEach((button) => button.addEventListener("click", () => {
        newSubject(button.dataset.studyAddSubject);
      }));
      root.querySelector("#studyOpenNotes").addEventListener("click", () => ctx.openNotesForSubject?.(root.querySelector("#studyHomeworkFilter").value));
      root.querySelector("#studyMaterialFilter").addEventListener("change", render);
      root.querySelector("#studyDriveConnect").addEventListener("click", connect);
      root.querySelector("#studyDriveDisconnect").addEventListener("click", disconnect);
      root.querySelector("#studyHomeworkCancel").addEventListener("click", () => closeForm(homeworkForm));
      root.querySelector("#studyLessonCancel").addEventListener("click", () => closeForm(lessonForm));
      root.querySelector("#studySubjectCancel").addEventListener("click", () => closeForm(subjectForm));
      homeworkForm.addEventListener("submit", saveHomework);
      homeworkForm.elements.subjectId.addEventListener("change", suggestDeadline);
      homeworkForm.elements.time.addEventListener("input", () => { deadlineTimeEdited = true; });
      homeworkDraft.bind();
      discardDraftButton.addEventListener("click", async () => {
        if (await ctx.confirmAction({ title: "Удалить черновик задания?", confirmLabel: "Удалить", tone: "danger" })) resetHomeworkForm();
      });
      lessonForm.addEventListener("submit", saveLesson);
      weekCycleForm.addEventListener("submit", saveWeekCycle);
      root.querySelectorAll("[data-study-schedule-mode]").forEach((button) => button.addEventListener("click", () => setScheduleMode(button.dataset.studyScheduleMode)));
      root.querySelector("#studyPreviousWeek").addEventListener("click", () => changePeriod(-1));
      root.querySelector("#studyCurrentWeek").addEventListener("click", () => changePeriod(0));
      root.querySelector("#studyNextWeek").addEventListener("click", () => changePeriod(1));
      subjectForm.addEventListener("submit", saveSubject);
      materialForm.addEventListener("submit", uploadMaterial);
      root.addEventListener("click", handleAction);
      root.addEventListener("change", handleChange);
      global.addEventListener("focus", () => { if (document.body.dataset.view === "study") refreshStatus(); });
    }

    async function initialize() {
      const url = new URL(global.location.href);
      const result = url.searchParams.get("googleDrive");
      if (result) {
        url.searchParams.delete("googleDrive");
        global.history.replaceState(global.history.state, "", url);
        ctx.showToast(result === "connected" ? "Google Drive подключён" : "Не удалось подключить Google Drive");
      }
      await refreshStatus();
    }

    async function refreshStatus() {
      const userId = ctx.getUserId();
      if (!userId) { connected = false; statusUserId = ""; renderDrive(); return; }
      try {
        const result = await api("status");
        if (ctx.getUserId() !== userId) return;
        connected = result.connected === true;
        configured = result.configured !== false;
        setupRequired = result.setupRequired === true;
        lastError = "";
        statusUserId = userId;
      } catch (error) {
        if (ctx.getUserId() !== userId) return;
        connected = false;
        statusUserId = userId;
        lastError = error.message;
      }
      renderDrive();
    }

    async function api(path, options = {}) {
      const owner = ctx.getUserId();
      const token = await ctx.getAccessToken();
      if (owner !== ctx.getUserId()) throw new Error("Аккаунт изменился. Повтори действие в нужном аккаунте.");
      if (!token) throw new Error("Войдите в аккаунт Parsitasks");
      const origin = global.location.protocol === "file:" ? BASE_URL : global.location.origin;
      const response = await fetch(`${origin}/api/google-drive/${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...(options.body && !(options.body instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
      });
      const data = await response.json().catch(() => null);
      if (owner !== ctx.getUserId()) throw new Error("Аккаунт изменился. Ответ Google Drive не применён.");
      if (!response.ok) throw new Error(data?.message || "Google Drive недоступен");
      return data || {};
    }

    async function connect() {
      if (busy) return;
      if (global.location.protocol === "file:") {
        global.open(`${BASE_URL}/app#study`, "_blank", "noopener");
        ctx.showToast("Подключите Google Drive в открытой веб-версии");
        return;
      }
      try {
        busy = true; renderDrive();
        const result = await api("connect", { method: "POST" });
        if (!result.authorizationUrl) throw new Error("Google не вернул ссылку подключения");
        global.location.assign(result.authorizationUrl);
      } catch (error) { ctx.showToast(error.message); }
      finally { busy = false; renderDrive(); }
    }

    async function disconnect() {
      if (busy || !connected) return;
      const confirmed = await ctx.confirmAction({ title: "Отключить Google Drive?", message: "Файлы останутся в вашем диске. Ссылки в Parsitasks сохранятся, но загрузка новых файлов будет недоступна.", confirmText: "Отключить", danger: true });
      if (!confirmed) return;
      try { busy = true; renderDrive(); await api("disconnect", { method: "POST" }); connected = false; ctx.showToast("Google Drive отключён"); }
      catch (error) { ctx.showToast(error.message); }
      finally { busy = false; renderDrive(); }
    }

    function renderDrive() {
      const status = root.querySelector("#studyDriveStatus");
      const connectButton = root.querySelector("#studyDriveConnect");
      const disconnectButton = root.querySelector("#studyDriveDisconnect");
      status.textContent = !ctx.getUserId() ? "Войдите в аккаунт для загрузки файлов" : lastError || (setupRequired ? "Нужно обновить схему Supabase" : !configured ? "Google Drive не настроен на сервере" : connected ? "Google Drive подключён" : "Google Drive не подключён");
      connectButton.hidden = connected;
      disconnectButton.hidden = !connected;
      connectButton.disabled = busy || !ctx.getUserId() || !configured;
      disconnectButton.disabled = busy;
      const pending = pendingMaterial();
      materialForm.elements.file.required = !pending;
      materialForm.querySelector('button[type="submit"]').disabled = busy || (!connected && !pending);
      materialForm.querySelector('button[type="submit"]').textContent = pending ? "Сохранить загруженный файл" : "Загрузить файл";
      if (pending && !busy) root.querySelector("#studyUploadStatus").textContent = `«${pending.name}» уже в Drive. Осталось сохранить карточку файла.`;
    }

    function setTab(next) {
      if (!["homework", "schedule", "materials"].includes(next)) return;
      tab = next;
      document.body.classList.toggle("study-schedule-mode", tab === "schedule");
      root.querySelectorAll("[data-study-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.studyTab === tab)));
      root.querySelectorAll("[data-study-pane]").forEach((pane) => { pane.hidden = pane.dataset.studyPane !== tab; pane.classList.toggle("is-active", !pane.hidden); });
      if (ctx.getUserId() !== statusUserId) refreshStatus();
    }

    function render() {
      document.body.classList.toggle("study-schedule-mode", tab === "schedule");
      const state = ctx.getState();
      const allSubjects = state.studySubjects || [];
      if (draftOwner !== local.owner()) { semester = "all"; archivedView = false; homeworkHistory = false; focusedMaterialId = ""; historyToggle.setAttribute("aria-pressed", "false"); }
      updateOptions(periodSelect, [["all", "Все семестры"], ...[...new Set(allSubjects.map((subject) => subject.semester || ""))].map((value) => [value, value || "Без семестра"])]);
      periodSelect.value = semester;
      archiveToggle.setAttribute("aria-pressed", String(archivedView));
      archivedNotice.hidden = !archivedView;
      archivePeriod.hidden = archivedView;
      const subjects = allSubjects.filter(includesSubject);
      const files = state.studyFiles || [];
      const choices = subjects.map((subject) => [subject.id, subject.name]);
      const formChoices = allSubjects.filter((subject) => !subject.archived || [homeworkForm.elements.subjectId.value, lessonForm.elements.subjectId.value, materialForm.elements.subjectId.value].includes(subject.id)).map((subject) => [subject.id, subject.name]);
      const setup = root.querySelector("#studySubjectSetup");
      setup.hidden = allSubjects.some((subject) => !subject.archived);
      [homeworkForm.elements.subjectId, lessonForm.elements.subjectId].forEach((select) => updateOptions(select, [["", "Выберите предмет"], ...formChoices]));
      updateOptions(materialForm.elements.subjectId, [["", "Без предмета"], ...formChoices]);
      [root.querySelector("#studyHomeworkFilter"), root.querySelector("#studyMaterialFilter")].forEach((select) => updateOptions(select, [["all", "Все предметы"], ...choices]));
      renderFileChoices(files);
      if (draftOwner !== local.owner()) {
        formDialogs.forEach((dialog) => dialog.close());
        resetLessonForm(); resetSubjectForm(); materialForm.reset();
        homeworkForm.reset();
        suggestedTime = "";
        deadlineTimeEdited = false;
        homeworkForm.elements.id.value = "";
        homeworkForm.elements.date.value = localDateKey(new Date());
        draftOwner = local.owner();
        const restored = homeworkDraft.restore();
        deadlineTimeEdited = Boolean(restored);
        const editing = Boolean(homeworkForm.elements.id.value);
        root.querySelector("#studyHomeworkFormTitle").textContent = editing ? "Изменить задание" : "Новое задание";
        root.querySelector("#studyHomeworkCancel").hidden = !editing;
        draftStatus.textContent = restored ? "Восстановлен черновик на этом устройстве" : "";
        discardDraftButton.hidden = !restored;
      }
      viewedDateKey = ctx.getActiveDate();
      viewedWeekMonday = studyModel.mondayKey(viewedDateKey);
      if (!local.read("study-homework-draft") && !homeworkForm.elements.id.value && !homeworkForm.elements.title.value) {
        homeworkForm.elements.date.value = localDateKey(new Date());
      }
      renderHomework(state);
      syncWeekCycleForm(state.studyWeekCycle);
      renderSchedule(state);
      renderMaterials(state);
      renderSubjects(state);
      renderDrive();
      const open = (state.tasks || []).filter((task) => task.studySubjectId && task.completed?.[task.date || task.dueDate] !== true).length;
      root.querySelector("#studySummary").textContent = open ? `${open} ${plural(open, "задание", "задания", "заданий")} ${open === 1 ? "ждёт" : "ждут"} выполнения`
        : state.tasks.some((task) => task.studySubjectId) ? "Все домашние задания выполнены" : "Домашних заданий пока нет";
      if (!homeworkForm.elements.id.value && !homeworkForm.elements.date.value) homeworkForm.elements.date.value = localDateKey(new Date());
      if (ctx.getUserId() && ctx.getUserId() !== statusUserId && !busy) refreshStatus();
    }

    function renderHomework(state) {
      const filter = root.querySelector("#studyHomeworkFilter").value;
      const subjects = new Map(state.studySubjects.map((item) => [item.id, item]));
      const files = new Map(state.studyFiles.map((item) => [item.id, item]));
      const todayKey = localDateKey(new Date());
      const tasks = state.tasks.filter((task) => task.studySubjectId && includesSubject(subjects.get(task.studySubjectId)) && (homeworkHistory ? !studyModel.isHomeworkVisible(task, todayKey) : studyModel.isHomeworkVisible(task, todayKey)) && (filter === "all" || task.studySubjectId === filter))
        .sort((a, b) => Number(a.completed?.[a.date || a.dueDate] === true) - Number(b.completed?.[b.date || b.dueDate] === true)
          || String(a.dueDate || a.date).localeCompare(String(b.dueDate || b.date)) || String(a.dueTime || a.time).localeCompare(String(b.dueTime || b.time)));
      const list = root.querySelector("#studyHomeworkList");
      list.replaceChildren(...(tasks.length ? tasks.map((task) => {
        const subject = subjects.get(task.studySubjectId);
        const done = task.completed?.[task.date || task.dueDate] === true;
        const attachments = (task.studyFileIds || []).map((id) => files.get(id)).filter(Boolean);
        const row = element("article", `study-item${done ? " is-done" : ""}`);
        const check = element("input", "study-check");
        check.type = "checkbox"; check.checked = done; check.dataset.studyCheck = task.id; check.setAttribute("aria-label", `Выполнено: ${task.title}`);
        const body = element("div");
        body.append(element("p", "study-item-title", task.title));
        const meta = element("div", "study-item-meta");
        const subjectLabel = element("span");
        subjectLabel.append(subjectDot(subject?.color), document.createTextNode(` ${subject?.name || "Предмет удалён"}`));
        const due = task.dueDate || task.date;
        const dueTime = task.dueTime ?? task.time;
        meta.append(subjectLabel, element("span", "", `Сдать ${displayDate(due)}${dueTime ? `, ${dueTime}` : ""}`));
        if (task.date !== due) meta.append(element("span", "", task.date ? `Подготовка ${displayDate(task.date)}` : "Подготовка пока не запланирована"));
        body.append(meta);
        if (task.studyDetails) body.append(element("p", "study-item-details", task.studyDetails));
        if (attachments.length) {
          const links = element("div", "study-item-meta study-attachments");
          attachments.forEach((file) => { const anchor = element("a", "", file.name); anchor.href = file.url; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; links.append(anchor); });
          body.append(links);
        }
        const actions = element("div", "study-item-actions");
        const linkedNotes = (state.notes || []).filter((note) => note.taskId === task.id);
        if (linkedNotes.length) actions.append(actionButton("studyNote", task.id, `Открыть заметки к заданию «${task.title}»`, "icon-journal"));
        actions.append(actionButton("studyEdit", task.id, "Изменить задание", "icon-edit"), actionButton("studyDelete", task.id, "Удалить задание", "icon-trash"));
        row.append(check, body, actionMenu(actions, `Действия с заданием «${task.title}»`));
        return row;
      }) : [element("div", "study-empty", "Актуальных заданий нет.")]));
    }

    function renderFileChoices(files) {
      const container = root.querySelector("#studyHomeworkFiles");
      const checked = new Set([...container.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value));
      container.replaceChildren(...(files.length ? files.map((file) => {
        const label = element("label");
        const input = element("input");
        input.type = "checkbox"; input.value = file.id; input.checked = checked.has(file.id); input.name = "studyFile";
        label.append(input, element("span", "", file.name));
        return label;
      }) : [element("div", "study-empty", "Материалов пока нет")]));
    }

    function renderSchedule(state) {
      const subjects = new Map(state.studySubjects.map((item) => [item.id, item]));
      const cycle = state.studyWeekCycle || {};
      const parity = studyModel.weekParity(viewedDateKey, cycle);
      const endOfWeek = addDaysKey(viewedWeekMonday, 6);
      const periodLabel = scheduleMode === "day"
        ? `${WEEKDAYS[new Date(`${viewedDateKey}T00:00:00Z`).getUTCDay()]}, ${shortDate(viewedDateKey)}`
        : `${shortDate(viewedWeekMonday)} – ${shortDate(endOfWeek)}`;
      root.querySelector("#studyWeekLabel").textContent = `${periodLabel} · ${parity ? `${parity === "even" ? "Чётная" : "Нечётная"} неделя` : "Цикл не настроен"}`;
      root.querySelectorAll("[data-study-schedule-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.studyScheduleMode === scheduleMode)));
      root.querySelector("#studyCurrentWeek").disabled = scheduleMode === "day"
        ? viewedDateKey === localDateKey(new Date())
        : viewedWeekMonday === studyModel.mondayKey(localDateKey(new Date()));
      for (const [id, dayLabel, weekLabel] of [["studyPreviousWeek", "Предыдущий день", "Предыдущая неделя"], ["studyNextWeek", "Следующий день", "Следующая неделя"]]) {
        const button = root.querySelector(`#${id}`);
        const label = scheduleMode === "day" ? dayLabel : weekLabel;
        button.setAttribute("aria-label", label);
        button.title = label;
      }
      const dates = scheduleMode === "day" ? [viewedDateKey] : Array.from({ length: 7 }, (_, index) => addDaysKey(viewedWeekMonday, index));
      const lessons = dates.flatMap((date) => {
        const events = studyModel.eventsForDate(state, date, { includeArchived: archivedView });
        const cancelled = state.studyLessons.flatMap((lesson) => Object.entries(lesson.exceptions || {}).filter(([source, entry]) => entry.cancelled && (entry.date || source) === date).map(([, entry]) => ({ ...lesson, ...entry, date, cancelled: true })));
        return [...events, ...cancelled].filter((lesson) => includesSubject(subjects.get(lesson.subjectId))).map((lesson) => ({ ...lesson, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() }));
      }).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      let lastDay = -1;
      const nodes = [];
      lessons.forEach((lesson) => {
        if (scheduleMode === "week" && lesson.weekday !== lastDay) nodes.push(element("h4", "study-day-heading", `${WEEKDAYS[lesson.weekday]}, ${shortDate(lesson.date)}`));
        lastDay = lesson.weekday;
        const subject = subjects.get(lesson.subjectId);
        const row = element("article", "study-item");
        row.classList.toggle("is-cancelled", Boolean(lesson.cancelled));
        const body = element("div");
        const headline = element("div", "study-item-headline");
        headline.append(element("p", "study-item-title", subject?.name || "Предмет"));
        if (lesson.lessonType) headline.append(element("span", `study-lesson-type is-${lesson.lessonType}`, lesson.lessonType === "lecture" ? "Лекция" : "Практика"));
        body.append(headline);
        const meta = element("div", "study-item-meta");
        meta.append(element("span", "", `${lesson.startTime}–${lesson.endTime}`));
        if (lesson.cancelled) meta.append(element("span", "", "Отменено"));
        if (lesson.room) meta.append(element("span", "", lesson.room));
        if (lesson.teacher || subject?.teacher) meta.append(element("span", "", lesson.teacher || subject.teacher));
        body.append(meta);
        const actions = element("div", "study-item-actions");
        actions.append(actionButton("studyLessonEdit", lesson.id, "Изменить занятие", "icon-edit"), actionButton("studyLessonDelete", lesson.id, "Удалить занятие", "icon-trash"));
        const occurrence = actionButton("studyOccurrence", lesson.id, lesson.cancelled ? "Восстановить эту пару" : "Перенести или отменить эту пару", "icon-calendar");
        occurrence.dataset.date = lesson.date;
        actions.prepend(occurrence);
        row.append(subjectDot(subject?.color), body, actionMenu(actions, `Действия с занятием «${subject?.name || "Предмет"}»`));
        nodes.push(row);
      });
      root.querySelector("#studyScheduleList").replaceChildren(...(nodes.length ? nodes : [element("div", "study-empty", state.studyLessons.length ? `На ${scheduleMode === "day" ? "этот день" : "этой неделе"} занятий нет.` : "Расписание пусто. Добавьте предмет и занятие.")]));
    }

    function syncWeekCycleForm(cycle = {}) {
      const key = `${cycle.anchorMonday || ""}|${cycle.anchorParity || ""}|${cycle.updatedAt || ""}`;
      if (key === displayedCycleKey) return;
      weekCycleForm.elements.anchorMonday.value = cycle.anchorMonday || studyModel.mondayKey(localDateKey(new Date()));
      weekCycleForm.elements.anchorParity.value = cycle.anchorParity || "even";
      displayedCycleKey = key;
    }

    function setScheduleMode(next) {
      if (next !== "day" && next !== "week") return;
      if (next === "week") viewedWeekMonday = studyModel.mondayKey(viewedDateKey);
      scheduleMode = next;
      renderSchedule(ctx.getState());
    }

    function changePeriod(direction) {
      const dateKey = direction === 0 ? localDateKey(new Date())
        : addDaysKey(ctx.getActiveDate(), direction * (scheduleMode === "day" ? 1 : 7));
      ctx.setActiveDate(dateKey);
    }

    function saveWeekCycle(event) {
      event.preventDefault();
      const anchorMonday = weekCycleForm.elements.anchorMonday.value;
      if (studyModel.mondayKey(anchorMonday) !== anchorMonday) { ctx.showToast("Выбери дату понедельника"); return; }
      const previous = ctx.getState().studyWeekCycle;
      ctx.getState().studyWeekCycle = studyModel.normalizeWeekCycle({
        anchorMonday,
        anchorParity: weekCycleForm.elements.anchorParity.value,
        updatedAt: new Date().toISOString(),
      });
      if (ctx.saveState() === false) { ctx.getState().studyWeekCycle = previous; return; }
      ctx.render(); ctx.showToast("Цикл недель сохранён");
    }

    function renderSubjects(state) {
      root.querySelector("#studySubjectList").replaceChildren(...state.studySubjects.filter(includesSubject).map((subject) => {
        const row = element("div", "study-subject-row");
        row.dataset.studySubjectId = subject.id;
        const label = element("span");
        label.append(element("span", "", subject.name));
        if (subject.teacher) label.append(element("small", "", subject.teacher));
        if (subject.semester) label.append(element("small", "", subject.semester));
        row.append(subjectDot(subject.color), label, actionButton("studySubjectEdit", subject.id, `Изменить предмет ${subject.name}`, "icon-edit"), actionButton("studySubjectDelete", subject.id, `Удалить предмет ${subject.name}`, "icon-trash"));
        row.append(actionButton("studySubjectArchive", subject.id, subject.archived ? "Вернуть из архива" : "Архивировать предмет", "icon-archive"));
        return row;
      }));
    }

    function renderMaterials(state) {
      const filter = root.querySelector("#studyMaterialFilter").value;
      const subjects = new Map(state.studySubjects.map((item) => [item.id, item]));
      const query = materialSearch.value.trim().toLocaleLowerCase("ru");
      const files = state.studyFiles.filter((file) => (!file.subjectId ? !archivedView : includesSubject(subjects.get(file.subjectId))) && (filter === "all" || file.subjectId === filter) && (!query || `${file.name} ${subjects.get(file.subjectId)?.name || ""}`.toLocaleLowerCase("ru").includes(query))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      root.querySelector("#studyMaterialList").replaceChildren(...(files.length ? files.map((file) => {
        const row = element("article", "study-item");
        row.dataset.studyFileId = file.id;
        row.classList.toggle("is-search-highlight", file.id === focusedMaterialId);
        row.tabIndex = -1;
        const body = element("div");
        const title = element("p", "study-item-title");
        const link = element("a", "", file.name);
        link.href = file.url; link.target = "_blank"; link.rel = "noopener noreferrer";
        title.append(link); body.append(title);
        const meta = element("div", "study-item-meta");
        meta.append(element("span", "", subjects.get(file.subjectId)?.name || "Без предмета"), element("span", "", formatSize(file.size)));
        body.append(meta);
        const actions = element("div", "study-item-actions");
        actions.append(actionButton("studyFileDelete", file.id, "Убрать материал из Parsitasks", "icon-trash"));
        actions.prepend(actionButton("studyFileEdit", file.id, "Изменить название и предмет материала", "icon-edit"));
        row.append(subjectDot(subjects.get(file.subjectId)?.color), body, actions);
        return row;
      }) : [element("div", "study-empty", "Материалов пока нет. Подключите Google Drive и загрузите файл.")]));
    }

    function saveSubject(event) {
      event.preventDefault();
      formErrors.get(subjectForm).textContent = "";
      const name = subjectForm.elements.name.value.trim();
      if (!name) return;
      const state = ctx.getState();
      const existing = state.studySubjects.find((subject) => subject.id === subjectForm.elements.id.value);
      if (state.studySubjects.some((subject) => subject.id !== existing?.id && (subject.semester || "") === subjectForm.elements.semester.value.trim() && subject.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"))) { ctx.showToast("Такой предмет уже есть в этом семестре"); return; }
      const now = new Date().toISOString();
      const next = { id: existing?.id || ctx.createId(), name, semester: subjectForm.elements.semester.value.trim(), archived: existing?.archived || false, color: subjectForm.elements.color.value, teacher: subjectForm.elements.teacher.value.trim(), createdAt: existing?.createdAt || now, updatedAt: now };
      const previous = existing ? { ...existing } : null;
      if (existing) Object.assign(existing, next);
      else state.studySubjects.push(next);
      const returnTab = subjectReturnTab;
      if (ctx.saveState() === false) { if (existing) Object.assign(existing, previous); else state.studySubjects = state.studySubjects.filter((item) => item.id !== next.id); formErrors.get(subjectForm).textContent = "Не удалось сохранить предмет. Ввод оставлен, попробуйте снова."; return; }
      resetSubjectForm(); ctx.render(); ctx.showToast(existing ? "Предмет обновлён" : "Предмет добавлен");
      if (returnTab === "homework") {
        homeworkForm.elements.subjectId.value = next.id;
        homeworkForm.elements.subjectId.dispatchEvent(new Event("change", { bubbles: true }));
        showForm(homeworkForm, homeworkForm.elements.title);
      }
      if (returnTab === "schedule") { resetLessonForm(); lessonForm.elements.subjectId.value = next.id; showForm(lessonForm); }
    }

    function saveLesson(event) {
      event.preventDefault();
      formErrors.get(lessonForm).textContent = "";
      const form = lessonForm.elements;
      if (form.endTime.value <= form.startTime.value) { formErrors.get(lessonForm).textContent = "Время окончания должно быть позже начала."; form.endTime.focus(); return; }
      const state = ctx.getState();
      const existing = state.studyLessons.find((lesson) => lesson.id === form.id.value);
      const now = new Date().toISOString();
      const next = { id: existing?.id || ctx.createId(), subjectId: form.subjectId.value, weekday: Number(form.weekday.value), weekType: form.weekType.value, startTime: form.startTime.value, endTime: form.endTime.value, lessonType: form.lessonType.value, teacher: form.teacher.value.trim(), room: form.room.value.trim(), createdAt: existing?.createdAt || now, updatedAt: now };
      const previous = existing ? { ...existing } : null;
      if (existing) Object.assign(existing, next);
      else state.studyLessons.push(next);
      if (ctx.saveState() === false) { if (existing) Object.assign(existing, previous); else state.studyLessons = state.studyLessons.filter((item) => item.id !== next.id); formErrors.get(lessonForm).textContent = "Не удалось сохранить занятие. Ввод оставлен, попробуйте снова."; return; }
      resetLessonForm(); ctx.render(); ctx.showToast(existing ? "Занятие обновлено" : "Занятие добавлено");
    }

    function resetLessonForm() {
      formDialogs.get(lessonForm).close();
      lessonForm.reset(); lessonForm.elements.id.value = "";
      root.querySelector("#studyLessonFormTitle").textContent = "Добавить занятие";
      lessonForm.querySelector('button[type="submit"]').textContent = "Добавить в расписание";
      root.querySelector("#studyLessonCancel").hidden = true;
    }

    function resetSubjectForm() {
      formDialogs.get(subjectForm).close();
      subjectReturnTab = "";
      subjectForm.reset(); subjectForm.elements.id.value = "";
      root.querySelector("#studySubjectFormTitle").textContent = "Предметы";
      subjectForm.querySelector('button[type="submit"]').textContent = "Добавить предмет";
      root.querySelector("#studySubjectCancel").hidden = true;
    }

    function saveHomework(event) {
      event.preventDefault();
      formErrors.get(homeworkForm).textContent = "";
      const form = homeworkForm.elements;
      const state = ctx.getState();
      const existing = state.tasks.find((task) => task.id === form.id.value);
      const previous = existing ? JSON.parse(JSON.stringify(existing)) : null;
      const now = new Date().toISOString();
      const time = form.time.value;
      const next = {
        id: existing?.id || ctx.createId(), title: form.title.value.trim(), date: form.date.value,
        time: existing?.time || "", scheduleMode: existing?.scheduleMode || "none", startTime: existing?.startTime || "", endTime: existing?.endTime || "",
        dueDate: form.date.value, dueTime: time, dueReminderOffset: time ? existing?.dueReminderOffset || "60" : "none",
        categoryId: existing?.categoryId || "", priority: existing?.priority || "medium", repeat: "none", repeatUntil: "", customRepeat: {},
        reminderOffset: existing?.reminderOffset || "none",
        completed: { ...existing?.completed }, acknowledgedOverdue: { ...existing?.acknowledgedOverdue }, excludedDates: {}, notified: {},
        checklist: existing?.checklist || [], checklistLogs: JSON.parse(JSON.stringify(existing?.checklistLogs || {})),
        studySubjectId: form.subjectId.value, studyDetails: form.details.value.trim(), studyAssignedDate: existing?.studyAssignedDate || localDateKey(new Date()),
        studyFileIds: [...root.querySelectorAll('#studyHomeworkFiles input[type="checkbox"]:checked')].map((input) => input.value),
        createdAt: existing?.createdAt || now, updatedAt: now,
      };
      next.date = form.planDate.value || form.date.value;
      if (existing && next.date !== existing.date) {
        const sourceDate = existing.date || (existing.completed?.[existing.dueDate] === true ? existing.dueDate : existing.deferredFromDate);
        global.RhythmTaskChecklist?.moveDate(next, sourceDate, next.date);
        if (next.completed[sourceDate] === true) { delete next.completed[sourceDate]; next.completed[next.date] = true; }
        next.notified = {};
      }
      if (!next.title || !next.studySubjectId || !next.date) return;
      if (existing) Object.assign(existing, next);
      else state.tasks.push(next);
      if (ctx.saveState() === false) {
        if (existing) Object.assign(existing, previous);
        else state.tasks = state.tasks.filter((task) => task.id !== next.id);
        homeworkDraft.save();
        formErrors.get(homeworkForm).textContent = "Не удалось сохранить задание. Ввод оставлен, попробуйте снова.";
        return;
      }
      resetHomeworkForm(); ctx.render(); ctx.showToast(existing ? "Задание обновлено" : "Задание добавлено");
    }

    function resetHomeworkForm() {
      formDialogs.get(homeworkForm).close();
      homeworkDraft.clear();
      homeworkForm.reset(); homeworkForm.elements.id.value = "";
      suggestedTime = "";
      deadlineTimeEdited = false;
      homeworkForm.elements.date.value = localDateKey(new Date());
      root.querySelector("#studyDeadlineSuggestion").textContent = "";
      draftStatus.textContent = "";
      discardDraftButton.hidden = true;
      root.querySelector("#studyHomeworkFormTitle").textContent = "Новое задание";
      root.querySelector("#studyHomeworkCancel").hidden = true;
    }

    function suggestDeadline() {
      if (homeworkForm.elements.id.value) return;
      const subjectId = homeworkForm.elements.subjectId.value;
      const state = ctx.getState();
      const now = new Date();
      const referenceDate = localDateKey(now);
      const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const lesson = studyModel.nextLessonOccurrence(state.studyLessons, subjectId, referenceDate, state.studyWeekCycle, time);
      const nextDate = lesson?.date || "";
      const hint = root.querySelector("#studyDeadlineSuggestion");
      if (nextDate) {
        homeworkForm.elements.date.value = nextDate;
        if (!deadlineTimeEdited && (!homeworkForm.elements.time.value || homeworkForm.elements.time.value === suggestedTime)) {
          homeworkForm.elements.time.value = lesson?.startTime || "";
          suggestedTime = homeworkForm.elements.time.value;
        }
        const kind = lesson?.lessonType === "practice" ? "практика" : lesson?.lessonType === "lecture" ? "лекция" : "пара";
        hint.textContent = `Следующая ${kind}: ${shortDate(nextDate)}${lesson?.startTime ? ` в ${lesson.startTime}` : ""} · отсчёт от сегодня, ${shortDate(referenceDate)}`;
      } else {
        if (!deadlineTimeEdited && homeworkForm.elements.time.value === suggestedTime) homeworkForm.elements.time.value = "";
        suggestedTime = "";
        hint.textContent = "Следующего занятия нет. Выберите срок сдачи.";
      }
    }

    async function uploadMaterial(event) {
      event.preventDefault();
      if (busy) return;
      const pending = pendingMaterial();
      if (pending) { saveUploadedMaterial(pending); return; }
      const file = materialForm.elements.file.files?.[0];
      if (!file || busy) return;
      if (!connected) { ctx.showToast("Сначала подключите Google Drive"); return; }
      if (file.size > 5 * 1024 * 1024 * 1024) { ctx.showToast("Файл больше 5 ГБ"); return; }
      const progress = root.querySelector("#studyUploadProgress");
      const status = root.querySelector("#studyUploadStatus");
      const owner = local.owner();
      const subjectId = materialForm.elements.subjectId.value;
      busy = true; progress.hidden = false; progress.value = 0; status.textContent = "Подготовка загрузки..."; renderDrive();
      try {
        const start = await api("upload-start", { method: "POST", body: JSON.stringify({ name: file.name, mime: file.type || "application/octet-stream", size: file.size }) });
        let offset = 0;
        let uploaded;
        let stalled = 0;
        while (offset < file.size) {
          if (owner !== local.owner()) throw new Error("Аккаунт изменился. Загрузка остановлена.");
          const end = Math.min(file.size, offset + start.chunkSize) - 1;
          try {
            uploaded = await api("upload-chunk", { method: "PUT", body: file.slice(offset, end + 1), headers: { "X-Upload-Session": start.session, "Content-Range": `bytes ${offset}-${end}/${file.size}` } });
          } catch (error) {
            status.textContent = "Проверяем загруженную часть...";
            let resumed = false;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                uploaded = await api("upload-status", { method: "POST", body: JSON.stringify({ session: start.session }) });
                resumed = true;
                break;
              } catch { await new Promise((resolve) => global.setTimeout(resolve, 500 * (attempt + 1))); }
            }
            if (!resumed) throw error;
          }
          if (uploaded.complete) break;
          const next = uploaded.next;
          if (!Number.isInteger(next) || next < 0 || next > file.size) throw new Error("Google Drive вернул некорректный прогресс загрузки");
          stalled = next <= offset ? stalled + 1 : 0;
          if (stalled >= 3) throw new Error("Загрузка остановилась. Повторите попытку позже");
          offset = next;
          progress.value = Math.round(offset / file.size * 100);
          status.textContent = `Загружено ${progress.value}%`;
        }
        if (!uploaded?.complete || !uploaded.file?.id) throw new Error("Загрузка не была завершена");
        const now = new Date().toISOString();
        if (owner !== local.owner()) throw new Error("Аккаунт изменился во время загрузки. Файл остался в Google Drive исходного аккаунта.");
        const record = { id: ctx.createId(), googleId: uploaded.file.id, name: uploaded.file.name || file.name, mime: uploaded.file.mime || file.type, size: uploaded.file.size || file.size, subjectId, url: uploaded.file.url, createdAt: now, updatedAt: now };
        pendingUpload = record; uploadOwner = owner;
        local.write("study-upload-pending", record);
        saveUploadedMaterial(record);
      } catch (error) { status.textContent = error.message; ctx.showToast(error.message); }
      finally { busy = false; renderDrive(); }
    }

    function saveUploadedMaterial(record) {
      const state = ctx.getState();
      const previous = state.studyFiles;
      if (!state.studyFiles.some((item) => item.googleId === record.googleId)) state.studyFiles = [...state.studyFiles, record];
      if (ctx.saveState() === false) {
        state.studyFiles = previous;
        root.querySelector("#studyUploadStatus").textContent = "Файл уже в Drive. Повтори сохранение карточки, загружать файл заново не нужно.";
        renderDrive(); return false;
      }
      local.remove("study-upload-pending");
      pendingUpload = null;
      materialForm.reset(); formDialogs.get(materialForm).close(); ctx.render(); ctx.showToast("Файл сохранён");
      return true;
    }

    async function handleAction(event) {
      const button = event.target.closest("button[data-study-note],button[data-study-edit],button[data-study-delete],button[data-study-lesson-edit],button[data-study-lesson-delete],button[data-study-subject-edit],button[data-study-subject-delete],button[data-study-file-delete],button[data-study-subject-archive],button[data-study-occurrence],button[data-study-file-edit]");
      if (!button) return;
      const menu = button.closest(".study-row-menu"); if (menu) menu.open = false;
      const state = ctx.getState();
      if (button.dataset.studySubjectArchive) { const subject = state.studySubjects.find((item) => item.id === button.dataset.studySubjectArchive); return subject && setArchived([subject], !subject.archived); }
      if (button.dataset.studyOccurrence) return editOccurrence(button.dataset.studyOccurrence, button.dataset.date);
      if (button.dataset.studyFileEdit) return editMaterial(button.dataset.studyFileEdit);
      if (button.dataset.studyNote) return ctx.openNotesForTask?.(button.dataset.studyNote);
      if (button.dataset.studyEdit) {
        const task = state.tasks.find((item) => item.id === button.dataset.studyEdit);
        if (!task) return;
        if (local.read("study-homework-draft") && homeworkForm.elements.id.value !== task.id) {
          if (!await ctx.confirmAction({ title: "Заменить черновик задания?", message: "Несохранённый черновик будет удалён.", confirmLabel: "Заменить", tone: "danger" })) return;
          homeworkDraft.clear();
          draftStatus.textContent = "";
          discardDraftButton.hidden = true;
        }
        const form = homeworkForm.elements;
        updateOptions(form.subjectId, [["", "Выберите предмет"], ...state.studySubjects.map((item) => [item.id, item.name])]);
        form.id.value = task.id; form.subjectId.value = task.studySubjectId; form.title.value = task.title;
        form.details.value = task.studyDetails || ""; form.date.value = task.dueDate || task.date; form.time.value = task.dueTime ?? task.time ?? "";
        form.planDate.value = task.date !== (task.dueDate || task.date) ? task.date || "" : "";
        root.querySelector("#studyDeadlineSuggestion").textContent = "";
        root.querySelectorAll('#studyHomeworkFiles input[type="checkbox"]').forEach((input) => { input.checked = task.studyFileIds?.includes(input.value) || false; });
        root.querySelector("#studyHomeworkFormTitle").textContent = "Изменить задание";
        root.querySelector("#studyHomeworkCancel").hidden = false;
        showForm(homeworkForm, form.title);
        return;
      }
      if (button.dataset.studyDelete) {
        if (!await confirmDelete("Удалить задание?", "Задание исчезнет и из общего списка задач.")) return;
        ctx.deleteTask(button.dataset.studyDelete); ctx.render(); return;
      }
      if (button.dataset.studyLessonEdit) {
        const lesson = state.studyLessons.find((item) => item.id === button.dataset.studyLessonEdit);
        if (!lesson) return;
        const form = lessonForm.elements;
        updateOptions(form.subjectId, [["", "Выберите предмет"], ...state.studySubjects.map((item) => [item.id, item.name])]);
        form.id.value = lesson.id; form.subjectId.value = lesson.subjectId; form.weekday.value = String(lesson.weekday);
        form.weekType.value = lesson.weekType || "all";
        form.startTime.value = lesson.startTime; form.endTime.value = lesson.endTime;
        form.lessonType.value = lesson.lessonType || ""; form.teacher.value = lesson.teacher || ""; form.room.value = lesson.room || "";
        root.querySelector("#studyLessonFormTitle").textContent = "Изменить занятие";
        lessonForm.querySelector('button[type="submit"]').textContent = "Сохранить занятие";
        root.querySelector("#studyLessonCancel").hidden = false;
        showForm(lessonForm, form.startTime);
        return;
      }
      if (button.dataset.studyLessonDelete) {
        if (!await confirmDelete("Удалить занятие?")) return;
        if (lessonForm.elements.id.value === button.dataset.studyLessonDelete) resetLessonForm();
        removeEntity("studyLessons", button.dataset.studyLessonDelete);
      }
      if (button.dataset.studySubjectEdit) {
        const subject = state.studySubjects.find((item) => item.id === button.dataset.studySubjectEdit);
        if (!subject) return;
        const form = subjectForm.elements;
        form.id.value = subject.id; form.name.value = subject.name; form.color.value = subject.color; form.teacher.value = subject.teacher || "";
        form.semester.value = subject.semester || "";
        root.querySelector("#studySubjectFormTitle").textContent = "Изменить предмет";
        subjectForm.querySelector('button[type="submit"]').textContent = "Сохранить предмет";
        root.querySelector("#studySubjectCancel").hidden = false;
        showForm(subjectForm, form.name);
        return;
      }
      if (button.dataset.studySubjectDelete) {
        const id = button.dataset.studySubjectDelete;
        if (state.studyLessons.some((item) => item.subjectId === id) || state.tasks.some((item) => item.studySubjectId === id) || state.studyFiles.some((item) => item.subjectId === id)) { ctx.showToast("Сначала удалите занятия, задания и материалы этого предмета"); return; }
        if (!await confirmDelete("Удалить предмет?")) return;
        if (subjectForm.elements.id.value === id) resetSubjectForm();
        removeEntity("studySubjects", id);
      }
      if (button.dataset.studyFileDelete) {
        if (!await confirmDelete("Убрать материал из Parsitasks?", "В Google Drive файл останется. Вложения с этим файлом исчезнут из домашних заданий.")) return;
        const id = button.dataset.studyFileDelete;
        removeEntity("studyFiles", id);
      }
    }

    function handleChange(event) {
      const id = event.target.dataset.studyCheck;
      if (!id) return;
      const task = ctx.getState().tasks.find((item) => item.id === id);
      if (!task) return;
      const date = task.date || task.dueDate;
      if (!date) return;
      const previous = { completed: { ...task.completed }, updatedAt: task.updatedAt };
      task.completed ||= {};
      if (event.target.checked) task.completed[date] = true;
      else delete task.completed[date];
      task.updatedAt = new Date().toISOString();
      if (ctx.saveState() === false) Object.assign(task, previous);
      ctx.render();
    }

    function removeEntity(type, id) {
      const state = ctx.getState();
      const previous = JSON.parse(JSON.stringify({ entities: state[type], tombstones: state.tombstones[type], tasks: state.tasks }));
      if (type === "studyFiles") state.tasks.forEach((task) => {
        if (task.studyFileIds?.includes(id)) {
          task.studyFileIds = task.studyFileIds.filter((fileId) => fileId !== id);
          task.updatedAt = new Date().toISOString();
        }
      });
      state.tombstones[type] ||= {};
      state.tombstones[type][id] = new Date().toISOString();
      state[type] = state[type].filter((item) => item.id !== id);
      if (ctx.saveState() === false) {
        state[type] = previous.entities;
        state.tombstones[type] = previous.tombstones || {};
        state.tasks = previous.tasks;
        ctx.render(); return false;
      }
      ctx.render(); return true;
    }

    function confirmDelete(title, message = "") { return ctx.confirmAction({ title, message, confirmText: "Удалить", danger: true }); }
    function openMaterial(id) {
      const file = ctx.getState().studyFiles.find((item) => item.id === id);
      if (!file) return;
      render();
      archivedView = Boolean(ctx.getState().studySubjects.find((item) => item.id === file.subjectId)?.archived);
      semester = "all"; materialSearch.value = ""; focusedMaterialId = id;
      root.querySelector("#studyMaterialFilter").value = "all";
      setTab("materials"); render();
      requestAnimationFrame(() => { const row = [...root.querySelectorAll("[data-study-file-id]")].find((node) => node.dataset.studyFileId === id); row?.scrollIntoView({ block: "center" }); row?.focus({ preventScroll: true }); });
    }

    function openSubject(id) {
      const subject = ctx.getState().studySubjects.find((item) => item.id === id);
      if (!subject) return;
      // Initialize drafts before setting the navigation filters for a found subject.
      render();
      archivedView = Boolean(subject.archived); semester = subject.semester || "";
      setTab("schedule"); render();
    }

    function editingDialog(title, fields, onSave, extra) {
      const dialog = element("dialog", "workspace-edit-dialog");
      const form = element("form", "study-form");
      form.append(element("h3", "", title));
      fields.forEach(([label, control]) => { const row = element("label", "", label); row.append(control); form.append(row); });
      const actions = element("div", "study-form-actions");
      const save = element("button", "primary-button", "Сохранить"); save.type = "submit";
      const cancel = element("button", "ghost-button", "Отмена"); cancel.type = "button"; cancel.onclick = () => dialog.close();
      actions.append(save, cancel);
      if (extra) actions.append(extra);
      form.append(actions); dialog.append(form); document.body.append(dialog);
      const owner = ctx.getUserId();
      form.addEventListener("submit", (event) => { event.preventDefault(); if (owner !== ctx.getUserId()) { dialog.close(); return; } if (onSave() !== false) dialog.close(); });
      dialog.addEventListener("close", () => dialog.remove(), { once: true }); dialog.showModal();
      return dialog;
    }

    function editMaterial(id) {
      const file = ctx.getState().studyFiles.find((item) => item.id === id);
      if (!file) return;
      const name = element("input"); name.value = file.name; name.required = true; name.maxLength = 240;
      const subject = element("select"); updateOptions(subject, [["", "Без предмета"], ...ctx.getState().studySubjects.map((item) => [item.id, `${item.name}${item.archived ? " · архив" : ""}`])]); subject.value = file.subjectId;
      editingDialog("Изменить материал", [["Название", name], ["Предмет", subject]], () => {
        const current = ctx.getState().studyFiles.find((item) => item.id === id);
        if (!current) { ctx.showToast("Материал больше не существует"); return; }
        const title = name.value.trim(); if (!title) return false;
        if (subject.value && !ctx.getState().studySubjects.some((item) => item.id === subject.value)) { ctx.showToast("Предмет больше не существует"); return false; }
        const previous = { ...current }; current.name = title;
        current.subjectId = subject.value; current.updatedAt = new Date().toISOString();
        if (ctx.saveState() === false) { Object.assign(current, previous); return false; } ctx.render();
      });
    }

    function editOccurrence(id, date) {
      const lesson = ctx.getState().studyLessons.find((item) => item.id === id);
      if (!lesson) return;
      const sourceDate = Object.keys(lesson.exceptions || {}).find((key) => lesson.exceptions[key].date === date) || date;
      const existing = lesson.exceptions?.[sourceDate];
      const target = element("input"); target.type = "date"; target.required = true; target.value = existing?.date || date;
      const start = element("input"); start.type = "time"; start.required = true; start.value = existing?.startTime || lesson.startTime;
      const end = element("input"); end.type = "time"; end.required = true; end.value = existing?.endTime || lesson.endTime;
      const room = element("input"); room.value = existing?.room ?? lesson.room ?? ""; room.maxLength = 80;
      const cancelled = element("input"); cancelled.type = "checkbox"; cancelled.checked = existing?.cancelled === true;
      const restore = element("button", "ghost-button", "По исходному расписанию"); restore.type = "button"; restore.hidden = !existing;
      function commit(value) {
        const current = ctx.getState().studyLessons.find((item) => item.id === id);
        if (!current) { ctx.showToast("Занятие больше не существует"); return; }
        const previous = JSON.parse(JSON.stringify(current)); current.exceptions ||= {};
        if (value) current.exceptions[sourceDate] = value; else delete current.exceptions[sourceDate];
        current.updatedAt = new Date().toISOString();
        if (ctx.saveState() === false) { Object.assign(current, previous); return false; } ctx.render();
      }
      const dialog = editingDialog(`Пара · ${shortDate(sourceDate)}`, [["Дата", target], ["Начало", start], ["Конец", end], ["Аудитория", room], ["Отменить только эту пару", cancelled]], () => {
        if (!cancelled.checked && end.value <= start.value) { ctx.showToast("Окончание должно быть позже начала"); return false; }
        const current = ctx.getState().studyLessons.find((item) => item.id === id);
        if (!current) { ctx.showToast("Занятие больше не существует"); return; }
        const natural = { ...current, exceptions: {} };
        if (!cancelled.checked && Object.entries(current.exceptions || {}).some(([source, entry]) => source !== sourceDate && !entry.cancelled && entry.date === target.value)) { ctx.showToast("На эту дату уже перенесено другое выполнение этой пары"); return false; }
        if (!cancelled.checked && target.value !== sourceDate && studyModel.lessonOccursOnDate(natural, target.value, ctx.getState().studyWeekCycle)) { ctx.showToast("В этот день эта пара уже есть в расписании"); return false; }
        return commit({ date: target.value, startTime: start.value, endTime: end.value, room: room.value.trim(), cancelled: cancelled.checked });
      }, restore);
      const owner = ctx.getUserId();
      restore.onclick = () => { if (owner === ctx.getUserId() && commit(null) !== false) dialog.close(); };
    }
    return { bindEvents, initialize, openMaterial, openSubject, refreshStatus, render, setTab };
  }

  function updateOptions(select, choices) {
    const previous = select.value;
    select.replaceChildren(...choices.map(([value, label]) => { const option = document.createElement("option"); option.value = value; option.textContent = label; return option; }));
    if (choices.some(([value]) => value === previous)) select.value = previous;
  }
  function element(tag, className = "", value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function subjectDot(color) { const dot = element("span", "study-subject-dot"); dot.style.setProperty("--subject-color", color || "#56c8a6"); return dot; }
  function actionMenu(actions, label) {
    const menu = element("details", "study-row-menu");
    const summary = element("summary", "icon-button"); summary.setAttribute("aria-label", label); summary.title = label;
    summary.append(actionIcon("icon-more"));
    [...actions.children].forEach((button) => button.append(document.createTextNode(button.getAttribute("aria-label"))));
    menu.append(summary, actions);
    menu.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); menu.open = false; summary.focus(); } });
    return menu;
  }
  function actionButton(action, id, label, icon) {
    const button = element("button");
    button.type = "button"; button.dataset[action] = id; button.title = label; button.setAttribute("aria-label", label);
    button.append(actionIcon(icon));
    return button;
  }
  function actionIcon(icon) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("ui-icon"); svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${icon}`); svg.append(use);
    return svg;
  }
  function localDateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
  function addDaysKey(dateKey, days) {
    const date = new Date(`${dateKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  function shortDate(dateKey) {
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${dateKey}T00:00:00Z`));
  }
  function displayDate(value) { const [year, month, day] = String(value).split("-"); return `${day}.${month}.${year}`; }
  function formatSize(bytes) { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`; }
  function plural(count, one, few, many) { const n = count % 100; return n >= 11 && n <= 14 ? many : count % 10 === 1 ? one : count % 10 >= 2 && count % 10 <= 4 ? few : many; }

  const api = { createStudyController };
  global.RhythmStudyController = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
