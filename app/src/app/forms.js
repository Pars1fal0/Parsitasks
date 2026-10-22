// Quick task input and the task, habit and goal forms.

import * as recurrence from "../tasks/recurrence.js";
import * as quickInput from "../tasks/quick-input.js";
import { app } from "./store.js";
import { els } from "./dom.js";
import { categoriesController, habitFormController, taskFormController } from "./editors.js";
import { render, syncNavigationRoute } from "./lifecycle.js";
import { confirmAction, createUndoSnapshot, restoreFailedSave, saveState, showToast } from "./persistence.js";
import { formatTaskTime, formatTaskWindow, getCategory, getOrCreateCategory, matchesCategoryFilter, normalizeQuickCategoryName, taskMatchesSearch } from "./queries.js";
import { priorityLabels, taskFormHome } from "./services.js";
import { saveUiState } from "./settings.js";
import { cleanText, createId, formSnapshots, formatLongDate, normalizeDateKey, nowInTimeZone, toDateKey } from "./state.js";
import { importExportController } from "./sync.js";
import { openDateTasks } from "./task-actions.js";
import { notesView, tasksView } from "./views.js";

export async function saveQuickTask(event) {
  event.preventDefault();
  if (!(await confirmDiscardOpenForms())) return;
  const parsed = parseQuickTaskPreview(els.quickTaskInput.value);
  if (!parsed.title) {
    showToast("Напиши название задачи");
    els.quickTaskInput.focus();
    return;
  }
  if (parsed.warnings?.length) {
    showToast(parsed.warnings[0]);
    return;
  }
  const undo = createUndoSnapshot();
  if (!parsed.categoryId && parsed.categoryName) parsed.categoryId = getOrCreateCategory(parsed.categoryName);

  const task = {
    id: createId(),
    title: parsed.title,
    date: parsed.date,
    time: parsed.time,
    scheduleMode: parsed.scheduleMode || (parsed.time ? "deadline" : "none"),
    startTime: parsed.startTime || "",
    endTime: parsed.endTime || "",
    categoryId: parsed.categoryId,
    priority: parsed.priority,
    repeat: "none",
    customRepeat: {},
    reminderOffset: parsed.time ? "15" : "none",
    completed: {},
    excludedDates: {},
    notified: {},
    createdAt: new Date().toISOString(),
  };

  app.state.tasks.push(task);
  app.activeView = "tasks";
  if (app.taskPane === "later") Object.assign(task, { date: null, time: "", scheduleMode: "none", startTime: "", endTime: "", reminderOffset: "none" });
  if (app.taskPane === "backlog") tasksView.setPane("day");
  if (app.taskFilter === "done" || !matchesCategoryFilter(task, app.taskCategoryFilter) ||
    !taskMatchesSearch(task, app.taskSearchQuery, app.activeDate)) clearTaskFilters();
  saveUiState();
  syncNavigationRoute();
  if (saveState() === false) {
    restoreFailedSave(undo);
    render();
    return;
  }
  els.quickTaskInput.value = "";
  updateQuickTaskPreview();
  resetTaskForm({ open: false });
  render();
  showToast(task.date ? `Добавлено на ${formatLongDate(task.date)}: ${task.title}` : `Добавлено в Позже: ${task.title}`, {
    undo,
    ...(task.date && task.date !== app.activeDate ? { action: { label: "Открыть день", onClick: () => openDateTasks(task.date) } } : {}),
  });
}

export function updateQuickTaskPreview() {
  const rawValue = cleanText(els.quickTaskInput.value);
  if (!rawValue) {
    els.quickTaskPreview.hidden = true;
    els.quickTaskPreview.replaceChildren();
    return;
  }

  const parsed = parseQuickTaskPreview(rawValue);
  const category = parsed.categoryId
    ? getCategory(parsed.categoryId)?.name
    : parsed.categoryName
      ? `новая категория: ${parsed.categoryName}`
      : "";
  const details = [
    app.taskPane === "later" ? "Позже · без даты" : formatLongDate(parsed.date),
    app.taskPane === "later" ? "" : parsed.scheduleMode === "block" ? formatTaskWindow(parsed) : parsed.time ? formatTaskTime(parsed.time) : "",
    category,
    parsed.priority !== "medium" ? priorityLabels[parsed.priority] : "",
  ].filter(Boolean);

  els.quickTaskPreview.hidden = false;
  const children = [createQuickPreviewSummary(parsed), createQuickPreviewChips(details)];
  if (parsed.warnings?.length) {
    const warning = document.createElement("p");
    warning.className = "quick-preview-warning";
    warning.textContent = parsed.warnings.join(". ");
    children.push(warning);
  }
  els.quickTaskPreview.replaceChildren(...children);
}

export function createQuickPreviewSummary(parsed) {
  const summary = document.createElement("div");
  const label = document.createElement("span");
  const title = document.createElement("strong");
  label.textContent = "Будет создано";
  title.textContent = parsed.title || "Задача без названия";
  summary.append(label, title);
  return summary;
}

export function createQuickPreviewChips(details) {
  const chips = document.createElement("div");
  chips.className = "quick-preview-chips";
  details.forEach((detail) => {
    const chip = document.createElement("span");
    chip.textContent = detail;
    chips.appendChild(chip);
  });
  return chips;
}

export function parseQuickTaskPreview(value) {
  return quickInput.parseQuickTaskInput(value, {
    now: nowInTimeZone(),
    activeDate: app.activeDate,
    cleanText,
    getOrCreateCategory: (categoryValue) => {
      const name = normalizeQuickCategoryName(categoryValue);
      return app.state.categories.find((category) => category.name.toLowerCase() === name.toLowerCase())?.id || "";
    },
    normalizeCategoryName: normalizeQuickCategoryName,
    normalizeDateKey,
    toDateKey,
  });
}

export function getCustomRepeatFromForm() {
  const activeMode = document.querySelector("[data-repeat-mode].is-active")?.dataset.repeatMode || "weekdays";
  if (activeMode === "monthDay") {
    return recurrence.normalizeCustomRepeat({
      type: "monthDay",
      day: Number(els.customRepeatMonthDay.value || 15),
    });
  }
  if (activeMode === "interval") {
    return recurrence.normalizeCustomRepeat({
      type: "interval",
      every: Number(els.customRepeatInterval.value || 5),
    });
  }

  return recurrence.normalizeCustomRepeat({
    type: "weekdays",
    weekdays: [...document.querySelectorAll("[data-weekday].is-active")].map((button) => Number(button.dataset.weekday)),
  });
}

export function setCustomRepeatForm(value = {}) {
  const custom = recurrence.normalizeCustomRepeat(value);
  setCustomRepeatMode(custom.type);
  const activeWeekdays = custom.weekdays || [1, 3, 5];
  document.querySelectorAll("[data-weekday]").forEach((button) => {
    button.classList.toggle("is-active", activeWeekdays.includes(Number(button.dataset.weekday)));
  });
  els.customRepeatMonthDay.value = custom.type === "monthDay" ? custom.day : 15;
  els.customRepeatInterval.value = custom.type === "interval" ? custom.every : 5;
  updateCustomRepeatSummary();
}

export function syncCustomRepeatPanel() {
  const hasRepeat = els.taskRepeat.value !== "none";
  const isCustom = els.taskRepeat.value === "custom";
  els.taskRepeatUntilField.hidden = !hasRepeat;
  if (hasRepeat) els.taskRepeatUntil.min = els.taskDate.value || app.activeDate;
  els.customRepeatPanel.hidden = !isCustom;
  if (isCustom) updateCustomRepeatSummary();
}

export function setCustomRepeatMode(mode = "weekdays") {
  document.querySelectorAll("[data-repeat-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.repeatMode === mode);
  });
  document.querySelectorAll("[data-repeat-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.repeatPanel !== mode;
  });
  updateCustomRepeatSummary();
}

export function updateCustomRepeatSummary() {
  els.customRepeatSummary.textContent = recurrence.customRepeatLabel(getCustomRepeatFromForm());
}

export function getHabitCustomRepeatFromForm() {
  const activeMode = document.querySelector("[data-habit-repeat-mode].is-active")?.dataset.habitRepeatMode || "weekdays";
  if (activeMode === "monthDay") {
    return recurrence.normalizeCustomRepeat({
      type: "monthDay",
      day: Number(els.habitCustomRepeatMonthDay.value || 15),
    });
  }
  if (activeMode === "interval") {
    return recurrence.normalizeCustomRepeat({
      type: "interval",
      every: Number(els.habitCustomRepeatInterval.value || 5),
    });
  }

  return recurrence.normalizeCustomRepeat({
    type: "weekdays",
    weekdays: [...document.querySelectorAll("[data-habit-weekday].is-active")].map((button) =>
      Number(button.dataset.habitWeekday),
    ),
  });
}

export function setHabitCustomRepeatForm(value = {}) {
  const custom = recurrence.normalizeCustomRepeat(value);
  setHabitCustomRepeatMode(custom.type);
  const activeWeekdays = custom.weekdays || [1, 3, 5];
  document.querySelectorAll("[data-habit-weekday]").forEach((button) => {
    button.classList.toggle("is-active", activeWeekdays.includes(Number(button.dataset.habitWeekday)));
  });
  els.habitCustomRepeatMonthDay.value = custom.type === "monthDay" ? custom.day : 15;
  els.habitCustomRepeatInterval.value = custom.type === "interval" ? custom.every : 5;
  updateHabitCustomRepeatSummary();
}

export function syncHabitCustomRepeatPanel() {
  const isCustom = els.habitRepeat.value === "custom";
  els.habitCustomRepeatPanel.hidden = !isCustom;
  document.querySelector("#habitWeeklyTargetField").hidden = els.habitRepeat.value !== "weeklyGoal";
  document.querySelector("#habitGoalLabel").textContent = els.habitRepeat.value === "weeklyGoal" ? "Цель за выполнение" : "Цель в день";
  if (isCustom) updateHabitCustomRepeatSummary();
}

export function syncHabitTypeFields() {
  const isNumber = els.habitType.value === "number";
  if (els.habitNumericFields) els.habitNumericFields.hidden = !isNumber;
  els.habitUnit.disabled = !isNumber;
  els.habitGoal.disabled = !isNumber;
  els.habitForm.querySelector("#habitNumberStep").disabled = !isNumber;
}

export function setHabitCustomRepeatMode(mode = "weekdays") {
  document.querySelectorAll("[data-habit-repeat-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.habitRepeatMode === mode);
  });
  document.querySelectorAll("[data-habit-repeat-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.habitRepeatPanel !== mode;
  });
  updateHabitCustomRepeatSummary();
}

export function updateHabitCustomRepeatSummary() {
  els.habitCustomRepeatSummary.textContent = recurrence.customRepeatLabel(getHabitCustomRepeatFromForm());
}

export async function fillTaskForm(task) {
  if (!(await confirmDiscardOpenForms())) return;
  if (["timeline", "overview"].includes(app.activeView)) openFloatingTaskForm();
  taskFormController.fillTaskForm(task);
}

export function resetTaskForm(options) {
  taskFormController.resetTaskForm(options);
}

export function saveHabitFromForm(event) {
  habitFormController.saveHabitFromForm(event);
}

export async function fillHabitForm(habit) {
  if (!(await confirmDiscardOpenForms())) return;
  habitFormController.fillHabitForm(habit);
}

export function resetHabitForm(options) {
  habitFormController.resetHabitForm(options);
}

export function markFormPristine(form) {
  if (form) formSnapshots.set(form, serializeForm(form));
}

export function isFormDirty(form) {
  return Boolean(form && formSnapshots.has(form) && formSnapshots.get(form) !== serializeForm(form));
}

export function serializeForm(form) {
  const values = [...form.querySelectorAll("input, select, textarea")].filter((control) => !control.classList.contains("goal-link-control") && !control.classList.contains("goal-link-search")).map((control) => [
    control.id || control.name || "",
    control.type === "checkbox" || control.type === "radio" ? control.checked : control.value,
  ]);
  const choices = [...form.querySelectorAll("[data-weekday], [data-habit-weekday], [data-repeat-mode], [data-habit-repeat-mode]")]
    .map((button) => [Object.entries(button.dataset), button.classList.contains("is-active")]);
  return JSON.stringify({ values, choices });
}

export function clearTaskFilters() {
  app.taskFilter = "all";
  app.taskCategoryFilter = "all";
  app.taskSearchQuery = "";
  els.taskSearch.value = "";
  els.taskCategoryFilter.value = "all";
  document.querySelectorAll("[data-task-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.taskFilter === "all");
  });
}

export async function closeFormWithConfirmation(form, panel, focusTarget, afterClose) {
  if (isFormDirty(form)) {
    const confirmed = await confirmAction({
      title: "Закрыть без сохранения?",
      message: "Внесённые в форму изменения будут потеряны.",
      confirmLabel: "Закрыть",
      secondaryLabel: "Продолжить редактирование",
      tone: "danger",
    });
    if (confirmed !== true) return false;
  }
  panel?.classList.add("is-collapsed");
  afterClose?.();
  focusTarget?.focus();
  return true;
}

export async function confirmDiscardOpenForms() {
  const forms = [
    [els.taskForm, els.taskFormPanel],
    [els.habitForm, els.habitFormPanel],
    [els.goalForm, els.goalFormPanel],
  ];
  const hasDirtyOpenForm = forms.some(([form, panel]) => panel && !panel.classList.contains("is-collapsed") && isFormDirty(form));
  const hasDirtyNote = app.activeView === "journal" && notesView.isDirty();
  if (hasDirtyNote && !(await notesView.confirmDiscard())) return false;
  if (!hasDirtyOpenForm) return true;
  const confirmed = await confirmAction({
    title: "Перейти без сохранения?",
    message: "Открытая форма содержит несохранённые изменения.",
    confirmLabel: "Перейти",
    secondaryLabel: "Остаться",
    tone: "danger",
  });
  return confirmed === true;
}

export function saveCategoryFromForm(event) {
  categoriesController.saveCategoryFromForm(event);
}

export function openFloatingTaskForm() {
  if (!els.taskFormPanel || !taskFormHome.parent) return;
  if (!els.taskFormPanel.classList.contains("is-floating-panel")) {
    document.body.appendChild(els.taskFormPanel);
    els.taskFormPanel.classList.add("is-floating-panel");
  }
  document.body.classList.add("has-floating-task-form");
  els.taskFormPanel.classList.remove("is-collapsed");
}

export function closeFloatingTaskForm() {
  document.body.classList.remove("has-floating-task-form");
}

export function restoreTaskFormPanel() {
  if (!els.taskFormPanel || !taskFormHome.parent || !els.taskFormPanel.classList.contains("is-floating-panel")) return;
  taskFormHome.parent.insertBefore(els.taskFormPanel, taskFormHome.next);
  els.taskFormPanel.classList.remove("is-floating-panel");
  document.body.classList.remove("has-floating-task-form");
}

export function exportData() {
  importExportController.exportData();
}

export async function importData() {
  return importExportController.importData();
}
