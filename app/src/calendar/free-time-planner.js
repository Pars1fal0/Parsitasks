import { DURATIONS, findFreeSlots, minuteOf, normalizePlanning, timeOf } from "./free-time.js";

export function createFreeTimePlanner(ctx) {
  let dialog, anchor, owner, mode, selected, candidates, settings, days;
  const node = (tag, className, text = "") => { const result = document.createElement(tag); result.className = className; result.textContent = text; return result; };
  const button = (text, action, className = "ghost-button") => { const result = node("button", className, text); result.type = "button"; result.addEventListener("click", action); return result; };
  const field = (label, input) => { const result = node("label", "planner-field"); result.append(node("span", "", label), input); return result; };
  const select = (label, choices) => { const result = node("select", ""); result.setAttribute("aria-label", label); choices.forEach(([value, text]) => { const option = node("option", "", text); option.value = value; result.append(option); }); return result; };
  const timeInput = (label, value) => { const result = node("input", ""); result.type = "time"; result.step = "900"; result.value = value; result.required = true; result.setAttribute("aria-label", label); return result; };
  function close() { dialog?.close(); anchor?.focus?.({ preventScroll: true }); }
  function open(options = {}) {
    if (dialog?.open) return;
    dialog?.remove();
    owner = ctx.getOwner(); anchor = document.activeElement; selected = null;
    mode = options.mode || ctx.getMode();
    const date = options.anchorDate || ctx.getActiveDate();
    days = mode === "week" ? ctx.getWeekDates(date) : [date];
    if (!days.includes(date)) days = [date];
    settings = normalizePlanning(ctx.getState().profile.planning);
    candidates = ctx.getCandidates(date);
    if (options.taskId && !candidates.some((item) => item.id === options.taskId)) {
      const task = ctx.getState().tasks.find((item) => item.id === options.taskId);
      if (task) candidates.push({ id: task.id, sourceDate: task.date, title: task.title });
    }
    dialog = node("dialog", "calendar-planner-dialog"); dialog.setAttribute("aria-labelledby", "calendarPlannerTitle");
    const header = node("header", "planner-heading"); const title = node("h2", "", "Найти время"); title.id = "calendarPlannerTitle";
    header.append(title, button("Закрыть", close));
    const form = node("form", "planner-controls");
    const task = select("Задача для планирования", [["", "Новая задача"], ...candidates.map((item) => [item.id, item.title])]); task.value = options.taskId || "";
    const duration = select("Длительность", DURATIONS.map((value) => [value, `${value} мин`])); duration.value = String(settings.duration);
    const period = select("Период поиска", [["day", "День"], ["week", "Неделя"]]); period.value = mode;
    const start = timeInput("Начало дня", settings.start), end = timeInput("Конец дня", settings.end);
    const submit = node("button", "primary-button", "Найти окна"); submit.type = "submit";
    form.append(field("Задача", task), field("Длительность", duration), field("Период", period), field("Начало дня", start), field("Конец дня", end), submit);
    const status = node("p", "planner-status"); status.setAttribute("role", "status");
    const results = node("div", "planner-results"); results.setAttribute("aria-label", "Свободные окна");
    const preview = node("section", "planner-preview"); preview.hidden = true;
    const begin = timeInput("Начало работы", "09:00"), summary = node("p", ""), confirm = button("Запланировать", commit, "primary-button");
    preview.append(field("Начало работы", begin), summary, confirm);
    dialog.append(header, form, status, results, preview); document.body.append(dialog);
    dialog.addEventListener("close", () => anchor?.focus?.({ preventScroll: true }));
    dialog.addEventListener("click", (event) => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); } });
    form.addEventListener("submit", (event) => { event.preventDefault(); search(); });
    task.addEventListener("change", () => { selected = null; preview.hidden = true; search(); });
    period.addEventListener("change", () => search());
    [duration, start, end].forEach((input) => input.addEventListener("change", search));
    begin.addEventListener("input", updatePreview);
    dialog.showModal(); search();

    function values() { return { start: start.value, end: end.value, duration: Number(duration.value) }; }
    function search() {
      selected = null; preview.hidden = true; results.replaceChildren();
      if (!current()) return;
      if (minuteOf(start.value) === null || minuteOf(end.value) === null || start.value >= end.value) { status.textContent = "Конец дня должен быть позже начала"; return; }
      mode = period.value; days = mode === "week" ? ctx.getWeekDates(date) : [date];
      const source = ctx.getState().tasks.find((item) => item.id === task.value);
      const now = ctx.getNow();
      const slots = findFreeSlots(days.map((day) => ({ date: day, entries: ctx.getEntries(day) })), values(), {
        today: ctx.todayKey(), nowMinute: now.getHours() * 60 + now.getMinutes(), dueDate: source?.dueDate, dueTime: source?.dueTime,
      });
      status.textContent = slots.length ? `Подходящих окон: ${slots.length}` : "На выбранный период подходящих окон нет";
      slots.forEach((slot) => {
        const item = button("", () => {
          selected = slot; begin.value = timeOf(slot.start); preview.hidden = false;
          results.querySelectorAll("button").forEach((entry) => entry.setAttribute("aria-pressed", String(entry === item)));
          updatePreview(); begin.focus();
        }, "planner-slot");
        item.setAttribute("aria-pressed", "false"); item.append(node("strong", "", ctx.formatDate(slot.date)), node("span", "", `${timeOf(slot.start)}–${timeOf(slot.availableEnd)}`)); results.append(item);
      });
    }
    function current() { if (owner === ctx.getOwner()) return true; close(); return false; }
    function updatePreview() {
      if (!selected) return;
      const minute = minuteOf(begin.value), finish = minute === null ? null : minute + Number(duration.value);
      const valid = minute !== null && minute % 15 === 0 && minute >= selected.start && finish <= selected.availableEnd;
      confirm.disabled = !valid;
      summary.textContent = valid ? `${ctx.formatDate(selected.date)} · ${begin.value}–${timeOf(finish)} · ${duration.value} мин` : "Выбери время внутри свободного окна, с шагом 15 минут";
    }
    async function commit() {
      if (!selected || confirm.disabled || !current()) return;
      const chosen = { ...selected, start: minuteOf(begin.value), end: minuteOf(begin.value) + Number(duration.value) };
      const existing = candidates.find((item) => item.id === task.value);
      const source = ctx.getState().tasks.find((item) => item.id === task.value);
      if (task.value && (!existing || !source || (source.repeat === "none" && source.date !== existing.sourceDate) || source.completed?.[existing.sourceDate || source.dueDate] === true)) { status.textContent = "Задача изменилась или больше недоступна. Открой поиск заново"; return; }
      const now = ctx.getNow();
      const live = findFreeSlots([{ date: chosen.date, entries: ctx.getEntries(chosen.date) }], values(), { today: ctx.todayKey(), nowMinute: now.getHours() * 60 + now.getMinutes(), dueDate: source?.dueDate, dueTime: source?.dueTime });
      if (!live.some((gap) => chosen.start >= gap.start && chosen.end <= gap.availableEnd)) { status.textContent = "Расписание изменилось. Найди свободное окно заново"; confirm.disabled = true; return; }
      confirm.disabled = true;
      try {
        if (ctx.savePreferences(values()) === false) { status.textContent = "Не удалось сохранить настройки поиска"; confirm.disabled = false; return; }
        close();
        if (existing) await ctx.scheduleTask(existing.id, existing.sourceDate, chosen.date, timeOf(chosen.start), timeOf(chosen.end));
        else await ctx.createTask(chosen.date, timeOf(chosen.start), timeOf(chosen.end));
      } catch { ctx.showToast?.("Не удалось запланировать задачу. Попробуй ещё раз"); }
    }
  }
  return { open, close };
}
