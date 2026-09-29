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
    let viewedDateKey = localDateKey(new Date());
    let viewedWeekMonday = studyModel.mondayKey(viewedDateKey);
    let displayedCycleKey = "";

    function bindEvents() {
      root.querySelectorAll("[data-study-tab]").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.studyTab)));
      root.querySelector("#studyHomeworkFilter").addEventListener("change", render);
      root.querySelector("#studyMaterialFilter").addEventListener("change", render);
      root.querySelector("#studyDriveConnect").addEventListener("click", connect);
      root.querySelector("#studyDriveDisconnect").addEventListener("click", disconnect);
      root.querySelector("#studyHomeworkCancel").addEventListener("click", resetHomeworkForm);
      root.querySelector("#studyLessonCancel").addEventListener("click", resetLessonForm);
      root.querySelector("#studySubjectCancel").addEventListener("click", resetSubjectForm);
      homeworkForm.addEventListener("submit", saveHomework);
      homeworkForm.elements.subjectId.addEventListener("change", suggestDeadline);
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
      const token = await ctx.getAccessToken();
      if (!token) throw new Error("Войдите в аккаунт Parsitasks");
      const origin = global.location.protocol === "file:" ? BASE_URL : global.location.origin;
      const response = await fetch(`${origin}/api/google-drive/${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...(options.body && !(options.body instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
      });
      const data = await response.json().catch(() => null);
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
      materialForm.querySelector('button[type="submit"]').disabled = busy || !connected;
    }

    function setTab(next) {
      if (!["homework", "schedule", "materials"].includes(next)) return;
      tab = next;
      root.querySelectorAll("[data-study-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.studyTab === tab)));
      root.querySelectorAll("[data-study-pane]").forEach((pane) => { pane.hidden = pane.dataset.studyPane !== tab; pane.classList.toggle("is-active", !pane.hidden); });
      if (ctx.getUserId() !== statusUserId) refreshStatus();
    }

    function render() {
      const state = ctx.getState();
      const subjects = state.studySubjects || [];
      const files = state.studyFiles || [];
      const choices = subjects.map((subject) => [subject.id, subject.name]);
      [homeworkForm.elements.subjectId, lessonForm.elements.subjectId].forEach((select) => updateOptions(select, [["", "Выберите предмет"], ...choices]));
      updateOptions(materialForm.elements.subjectId, [["", "Без предмета"], ...choices]);
      [root.querySelector("#studyHomeworkFilter"), root.querySelector("#studyMaterialFilter")].forEach((select) => updateOptions(select, [["all", "Все предметы"], ...choices]));
      renderFileChoices(files);
      renderHomework(state);
      syncWeekCycleForm(state.studyWeekCycle);
      renderSchedule(state);
      renderMaterials(state);
      renderSubjects(state);
      renderDrive();
      const open = (state.tasks || []).filter((task) => task.studySubjectId && task.completed?.[task.date] !== true).length;
      root.querySelector("#studySummary").textContent = open ? `${open} ${plural(open, "задание", "задания", "заданий")} ${open === 1 ? "ждёт" : "ждут"} выполнения` : "Все домашние задания выполнены";
      if (!homeworkForm.elements.id.value && !homeworkForm.elements.date.value) homeworkForm.elements.date.value = localDateKey(new Date());
      if (ctx.getUserId() && ctx.getUserId() !== statusUserId && !busy) refreshStatus();
    }

    function renderHomework(state) {
      const filter = root.querySelector("#studyHomeworkFilter").value;
      const subjects = new Map(state.studySubjects.map((item) => [item.id, item]));
      const files = new Map(state.studyFiles.map((item) => [item.id, item]));
      const todayKey = localDateKey(new Date());
      const tasks = state.tasks.filter((task) => task.studySubjectId && studyModel.isHomeworkVisible(task, todayKey) && (filter === "all" || task.studySubjectId === filter))
        .sort((a, b) => Number(a.completed?.[a.date] === true) - Number(b.completed?.[b.date] === true) || a.date.localeCompare(b.date) || String(a.time).localeCompare(String(b.time)));
      const list = root.querySelector("#studyHomeworkList");
      list.replaceChildren(...(tasks.length ? tasks.map((task) => {
        const subject = subjects.get(task.studySubjectId);
        const done = task.completed?.[task.date] === true;
        const attachments = (task.studyFileIds || []).map((id) => files.get(id)).filter(Boolean);
        const row = element("article", `study-item${done ? " is-done" : ""}`);
        const check = element("input", "study-check");
        check.type = "checkbox"; check.checked = done; check.dataset.studyCheck = task.id; check.setAttribute("aria-label", `Выполнено: ${task.title}`);
        const body = element("div");
        body.append(element("p", "study-item-title", task.title));
        const meta = element("div", "study-item-meta");
        const subjectLabel = element("span");
        subjectLabel.append(subjectDot(subject?.color), document.createTextNode(` ${subject?.name || "Предмет удалён"}`));
        meta.append(subjectLabel, element("span", "", `Сдать ${displayDate(task.date)}${task.time ? `, ${task.time}` : ""}`));
        body.append(meta);
        if (task.studyDetails) body.append(element("p", "study-item-details", task.studyDetails));
        if (attachments.length) {
          const links = element("div", "study-item-meta study-attachments");
          attachments.forEach((file) => { const anchor = element("a", "", file.name); anchor.href = file.url; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; links.append(anchor); });
          body.append(links);
        }
        const actions = element("div", "study-item-actions");
        actions.append(actionButton("studyEdit", task.id, "Изменить задание", "icon-edit"), actionButton("studyDelete", task.id, "Удалить задание", "icon-trash"));
        row.append(check, body, actions);
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
      const viewedWeekday = new Date(`${viewedDateKey}T00:00:00Z`).getUTCDay();
      const lessons = [...state.studyLessons]
        .filter((lesson) => (scheduleMode === "week" || lesson.weekday === viewedWeekday) && (!parity || lesson.weekType === "all" || !lesson.weekType || lesson.weekType === parity))
        .sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.startTime.localeCompare(b.startTime));
      let lastDay = -1;
      const nodes = [];
      lessons.forEach((lesson) => {
        if (scheduleMode === "week" && lesson.weekday !== lastDay) nodes.push(element("h4", "study-day-heading", `${WEEKDAYS[lesson.weekday]}, ${shortDate(addDaysKey(viewedWeekMonday, (lesson.weekday + 6) % 7))}`));
        lastDay = lesson.weekday;
        const subject = subjects.get(lesson.subjectId);
        const row = element("article", "study-item");
        const body = element("div");
        const headline = element("div", "study-item-headline");
        headline.append(element("p", "study-item-title", subject?.name || "Предмет"));
        if (lesson.lessonType) headline.append(element("span", `study-lesson-type is-${lesson.lessonType}`, lesson.lessonType === "lecture" ? "Лекция" : "Практика"));
        body.append(headline);
        const meta = element("div", "study-item-meta");
        meta.append(element("span", "", `${lesson.startTime}–${lesson.endTime}`));
        if (lesson.room) meta.append(element("span", "", lesson.room));
        if (lesson.teacher || subject?.teacher) meta.append(element("span", "", lesson.teacher || subject.teacher));
        body.append(meta);
        const actions = element("div", "study-item-actions");
        actions.append(actionButton("studyLessonEdit", lesson.id, "Изменить занятие", "icon-edit"), actionButton("studyLessonDelete", lesson.id, "Удалить занятие", "icon-trash"));
        row.append(subjectDot(subject?.color), body, actions);
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
      if (scheduleMode === "day") {
        viewedDateKey = direction === 0 ? localDateKey(new Date()) : addDaysKey(viewedDateKey, direction);
        viewedWeekMonday = studyModel.mondayKey(viewedDateKey);
      } else {
        viewedWeekMonday = direction === 0 ? studyModel.mondayKey(localDateKey(new Date())) : addDaysKey(viewedWeekMonday, direction * 7);
        viewedDateKey = direction === 0 ? localDateKey(new Date()) : viewedWeekMonday;
      }
      renderSchedule(ctx.getState());
    }

    function saveWeekCycle(event) {
      event.preventDefault();
      const anchorMonday = weekCycleForm.elements.anchorMonday.value;
      if (studyModel.mondayKey(anchorMonday) !== anchorMonday) { ctx.showToast("Выбери дату понедельника"); return; }
      ctx.getState().studyWeekCycle = studyModel.normalizeWeekCycle({
        anchorMonday,
        anchorParity: weekCycleForm.elements.anchorParity.value,
        updatedAt: new Date().toISOString(),
      });
      ctx.saveState(); ctx.render(); ctx.showToast("Цикл недель сохранён");
    }

    function renderSubjects(state) {
      root.querySelector("#studySubjectList").replaceChildren(...state.studySubjects.map((subject) => {
        const row = element("div", "study-subject-row");
        const label = element("span");
        label.append(element("span", "", subject.name));
        if (subject.teacher) label.append(element("small", "", subject.teacher));
        row.append(subjectDot(subject.color), label, actionButton("studySubjectEdit", subject.id, `Изменить предмет ${subject.name}`, "icon-edit"), actionButton("studySubjectDelete", subject.id, `Удалить предмет ${subject.name}`, "icon-trash"));
        return row;
      }));
    }

    function renderMaterials(state) {
      const filter = root.querySelector("#studyMaterialFilter").value;
      const subjects = new Map(state.studySubjects.map((item) => [item.id, item]));
      const files = state.studyFiles.filter((file) => filter === "all" || file.subjectId === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      root.querySelector("#studyMaterialList").replaceChildren(...(files.length ? files.map((file) => {
        const row = element("article", "study-item");
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
        row.append(subjectDot(subjects.get(file.subjectId)?.color), body, actions);
        return row;
      }) : [element("div", "study-empty", "Материалов пока нет. Подключите Google Drive и загрузите файл.")]));
    }

    function saveSubject(event) {
      event.preventDefault();
      const name = subjectForm.elements.name.value.trim();
      if (!name) return;
      const state = ctx.getState();
      const existing = state.studySubjects.find((subject) => subject.id === subjectForm.elements.id.value);
      if (state.studySubjects.some((subject) => subject.id !== existing?.id && subject.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"))) { ctx.showToast("Такой предмет уже есть"); return; }
      const now = new Date().toISOString();
      const next = { id: existing?.id || ctx.createId(), name, color: subjectForm.elements.color.value, teacher: subjectForm.elements.teacher.value.trim(), createdAt: existing?.createdAt || now, updatedAt: now };
      if (existing) Object.assign(existing, next);
      else state.studySubjects.push(next);
      resetSubjectForm(); ctx.saveState(); ctx.render(); ctx.showToast(existing ? "Предмет обновлён" : "Предмет добавлен");
    }

    function saveLesson(event) {
      event.preventDefault();
      const form = lessonForm.elements;
      if (form.endTime.value <= form.startTime.value) { ctx.showToast("Время окончания должно быть позже начала"); return; }
      const state = ctx.getState();
      const existing = state.studyLessons.find((lesson) => lesson.id === form.id.value);
      const now = new Date().toISOString();
      const next = { id: existing?.id || ctx.createId(), subjectId: form.subjectId.value, weekday: Number(form.weekday.value), weekType: form.weekType.value, startTime: form.startTime.value, endTime: form.endTime.value, lessonType: form.lessonType.value, teacher: form.teacher.value.trim(), room: form.room.value.trim(), createdAt: existing?.createdAt || now, updatedAt: now };
      if (existing) Object.assign(existing, next);
      else state.studyLessons.push(next);
      resetLessonForm(); ctx.saveState(); ctx.render(); ctx.showToast(existing ? "Занятие обновлено" : "Занятие добавлено");
    }

    function resetLessonForm() {
      lessonForm.reset(); lessonForm.elements.id.value = "";
      root.querySelector("#studyLessonFormTitle").textContent = "Добавить занятие";
      lessonForm.querySelector('button[type="submit"]').textContent = "Добавить в расписание";
      root.querySelector("#studyLessonCancel").hidden = true;
    }

    function resetSubjectForm() {
      subjectForm.reset(); subjectForm.elements.id.value = "";
      root.querySelector("#studySubjectFormTitle").textContent = "Предметы";
      subjectForm.querySelector('button[type="submit"]').textContent = "Добавить предмет";
      root.querySelector("#studySubjectCancel").hidden = true;
    }

    function saveHomework(event) {
      event.preventDefault();
      const form = homeworkForm.elements;
      const state = ctx.getState();
      const existing = state.tasks.find((task) => task.id === form.id.value);
      const now = new Date().toISOString();
      const time = form.time.value;
      const next = {
        id: existing?.id || ctx.createId(), title: form.title.value.trim(), date: form.date.value,
        time, scheduleMode: time ? "deadline" : "none", startTime: "", endTime: "",
        categoryId: existing?.categoryId || "", priority: existing?.priority || "medium", repeat: "none", repeatUntil: "", customRepeat: {},
        reminderOffset: time ? (existing?.reminderOffset && existing.reminderOffset !== "none" ? existing.reminderOffset : "60") : "none",
        completed: existing?.completed || {}, acknowledgedOverdue: existing?.acknowledgedOverdue || {}, excludedDates: {}, notified: {},
        studySubjectId: form.subjectId.value, studyDetails: form.details.value.trim(), studyAssignedDate: existing?.studyAssignedDate || localDateKey(new Date()),
        studyFileIds: [...root.querySelectorAll('#studyHomeworkFiles input[type="checkbox"]:checked')].map((input) => input.value),
        createdAt: existing?.createdAt || now, updatedAt: now,
      };
      if (!next.title || !next.studySubjectId || !next.date) return;
      if (existing) Object.assign(existing, next);
      else state.tasks.push(next);
      resetHomeworkForm(); ctx.saveState(); ctx.render(); ctx.showToast(existing ? "Задание обновлено" : "Задание добавлено");
    }

    function resetHomeworkForm() {
      homeworkForm.reset(); homeworkForm.elements.id.value = "";
      homeworkForm.elements.date.value = localDateKey(new Date());
      root.querySelector("#studyHomeworkFormTitle").textContent = "Новое задание";
      root.querySelector("#studyHomeworkCancel").hidden = true;
    }

    function suggestDeadline() {
      if (homeworkForm.elements.id.value) return;
      const subjectId = homeworkForm.elements.subjectId.value;
      const state = ctx.getState();
      const nextDate = studyModel.nextLessonDate(state.studyLessons, subjectId, localDateKey(new Date()), state.studyWeekCycle);
      if (nextDate) homeworkForm.elements.date.value = nextDate;
    }

    async function uploadMaterial(event) {
      event.preventDefault();
      const file = materialForm.elements.file.files?.[0];
      if (!file || busy) return;
      if (!connected) { ctx.showToast("Сначала подключите Google Drive"); return; }
      if (file.size > 5 * 1024 * 1024 * 1024) { ctx.showToast("Файл больше 5 ГБ"); return; }
      const progress = root.querySelector("#studyUploadProgress");
      const status = root.querySelector("#studyUploadStatus");
      busy = true; progress.hidden = false; progress.value = 0; status.textContent = "Подготовка загрузки..."; renderDrive();
      try {
        const start = await api("upload-start", { method: "POST", body: JSON.stringify({ name: file.name, mime: file.type || "application/octet-stream", size: file.size }) });
        let offset = 0;
        let uploaded;
        let stalled = 0;
        while (offset < file.size) {
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
        ctx.getState().studyFiles.push({ id: ctx.createId(), googleId: uploaded.file.id, name: uploaded.file.name || file.name, mime: uploaded.file.mime || file.type, size: uploaded.file.size || file.size, subjectId: materialForm.elements.subjectId.value, url: uploaded.file.url, createdAt: now, updatedAt: now });
        materialForm.reset(); ctx.saveState(); ctx.render(); ctx.showToast("Файл загружен в Google Drive");
      } catch (error) { status.textContent = error.message; ctx.showToast(error.message); }
      finally { busy = false; renderDrive(); }
    }

    async function handleAction(event) {
      const button = event.target.closest("button[data-study-edit],button[data-study-delete],button[data-study-lesson-edit],button[data-study-lesson-delete],button[data-study-subject-edit],button[data-study-subject-delete],button[data-study-file-delete]");
      if (!button) return;
      const state = ctx.getState();
      if (button.dataset.studyEdit) {
        const task = state.tasks.find((item) => item.id === button.dataset.studyEdit);
        if (!task) return;
        const form = homeworkForm.elements;
        form.id.value = task.id; form.subjectId.value = task.studySubjectId; form.title.value = task.title;
        form.details.value = task.studyDetails || ""; form.date.value = task.date; form.time.value = task.time || "";
        root.querySelectorAll('#studyHomeworkFiles input[type="checkbox"]').forEach((input) => { input.checked = task.studyFileIds?.includes(input.value) || false; });
        root.querySelector("#studyHomeworkFormTitle").textContent = "Изменить задание";
        root.querySelector("#studyHomeworkCancel").hidden = false;
        homeworkForm.scrollIntoView({ behavior: "smooth", block: "start" });
        form.title.focus();
        return;
      }
      if (button.dataset.studyDelete) {
        if (!await confirmDelete("Удалить задание?", "Задание исчезнет и из общего списка задач.")) return;
        ctx.deleteTask(button.dataset.studyDelete); ctx.saveState(); ctx.render(); return;
      }
      if (button.dataset.studyLessonEdit) {
        const lesson = state.studyLessons.find((item) => item.id === button.dataset.studyLessonEdit);
        if (!lesson) return;
        const form = lessonForm.elements;
        form.id.value = lesson.id; form.subjectId.value = lesson.subjectId; form.weekday.value = String(lesson.weekday);
        form.weekType.value = lesson.weekType || "all";
        form.startTime.value = lesson.startTime; form.endTime.value = lesson.endTime;
        form.lessonType.value = lesson.lessonType || ""; form.teacher.value = lesson.teacher || ""; form.room.value = lesson.room || "";
        root.querySelector("#studyLessonFormTitle").textContent = "Изменить занятие";
        lessonForm.querySelector('button[type="submit"]').textContent = "Сохранить занятие";
        root.querySelector("#studyLessonCancel").hidden = false;
        lessonForm.scrollIntoView({ behavior: "smooth", block: "start" });
        form.startTime.focus();
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
        root.querySelector("#studySubjectFormTitle").textContent = "Изменить предмет";
        subjectForm.querySelector('button[type="submit"]').textContent = "Сохранить предмет";
        root.querySelector("#studySubjectCancel").hidden = false;
        subjectForm.scrollIntoView({ behavior: "smooth", block: "start" });
        form.name.focus();
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
        state.tasks.forEach((task) => { task.studyFileIds = (task.studyFileIds || []).filter((fileId) => fileId !== id); });
        removeEntity("studyFiles", id);
      }
    }

    function handleChange(event) {
      const id = event.target.dataset.studyCheck;
      if (!id) return;
      const task = ctx.getState().tasks.find((item) => item.id === id);
      if (!task) return;
      task.completed ||= {};
      if (event.target.checked) task.completed[task.date] = true;
      else delete task.completed[task.date];
      task.updatedAt = new Date().toISOString();
      ctx.saveState(); ctx.render();
    }

    function removeEntity(type, id) {
      const state = ctx.getState();
      state.tombstones[type] ||= {};
      state.tombstones[type][id] = new Date().toISOString();
      state[type] = state[type].filter((item) => item.id !== id);
      ctx.saveState(); ctx.render();
    }

    function confirmDelete(title, message = "") { return ctx.confirmAction({ title, message, confirmText: "Удалить", danger: true }); }
    return { bindEvents, initialize, refreshStatus, render, setTab };
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
  function actionButton(action, id, label, icon) {
    const button = element("button");
    button.type = "button"; button.dataset[action] = id; button.title = label; button.setAttribute("aria-label", label);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("ui-icon"); svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${icon}`); svg.append(use); button.append(svg);
    return button;
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
