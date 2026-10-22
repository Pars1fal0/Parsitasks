// Task, habit, goal and note actions triggered from the views.

import * as taskMoves from "../tasks/task-moves.js";
import * as studyModel from "../study/study-model.js";
import { app } from "./store.js";
import { els } from "./dom.js";
import { categoriesController, taskFormController } from "./editors.js";
import { clearTaskFilters, confirmDiscardOpenForms, resetHabitForm, resetTaskForm } from "./forms.js";
import { render, scrollWorkspaceTop, syncNavigationRoute } from "./lifecycle.js";
import { confirmAction, createUndoSnapshot, replaceState, restoreFailedSave, saveState, showToast } from "./persistence.js";
import { taskScheduledOn } from "./queries.js";
import { calendarDragController, remoteAuth } from "./services.js";
import { saveUiState } from "./settings.js";
import { studyController } from "./shell.js";
import { addDays, cleanTimeValue, createId, formatLongDate, normalizeDateKey, taskState, toDateKey } from "./state.js";
import { archiveView, calendarView, goalsView, habitsView, notesView, tasksView } from "./views.js";

export function excludeTaskDate(task, dateKey) {
  if (task.repeat === "none") return;
  const undo = createUndoSnapshot();
  task.excludedDates = task.excludedDates || {};
  task.excludedDates[dateKey] = true;
  task.updatedAt = new Date().toISOString();
  delete task.completed?.[dateKey];
  delete task.notified?.[dateKey];
  delete task.workNotified?.[dateKey];
  if (Array.isArray(app.state.taskOrder[dateKey])) {
    app.state.taskOrder[dateKey] = app.state.taskOrder[dateKey].filter((id) => id !== task.id);
  }
  return commitTaskChange("Повтор исключен на выбранный день", undo);
}

export function acknowledgeOverdueTask(task, dateKey) {
  const undo = createUndoSnapshot();
  task.acknowledgedOverdue = task.acknowledgedOverdue || {};
  task.acknowledgedOverdue[dateKey] = true;
  task.updatedAt = new Date().toISOString();
  return commitTaskChange("Скрыта из просроченных · задача остаётся невыполненной", undo);
}

export function acknowledgeAllOverdueTasks(entries) {
  if (!entries.length) return;
  const undo = createUndoSnapshot();
  entries.forEach(({ task, dateKey }) => {
    task.acknowledgedOverdue = task.acknowledgedOverdue || {};
    task.acknowledgedOverdue[dateKey] = true;
    task.updatedAt = new Date().toISOString();
  });
  return commitTaskChange(`Скрыто из просроченных: ${entries.length} · отметки выполнения не изменены`, undo);
}

export function restoreOverdueTask(task, dateKey) {
  if (!task.acknowledgedOverdue?.[dateKey]) return;
  const undo = createUndoSnapshot();
  delete task.acknowledgedOverdue[dateKey];
  task.updatedAt = new Date().toISOString();
  return commitTaskChange("Задача снова появится в просроченных на следующем дне", undo);
}

export function restoreTaskDate(task, dateKey) {
  const undo = createUndoSnapshot();
  if (task.excludedDates) {
    delete task.excludedDates[dateKey];
  }
  task.updatedAt = new Date().toISOString();
  return commitTaskChange(`Повтор возвращен на ${formatLongDate(dateKey)}`, undo);
}

export function stopTaskSeries(task, dateKey) {
  if (task.repeat === "none") return;
  const undo = createUndoSnapshot();
  const cutoff = addDays(dateKey, -1);
  task.repeatUntil = cutoff;
  task.updatedAt = new Date().toISOString();
  [task.completed, task.acknowledgedOverdue, task.excludedDates, task.notified, task.workNotified].forEach((flags) => {
    Object.keys(flags || {}).forEach((key) => {
      if (key >= dateKey) delete flags[key];
    });
  });
  Object.keys(app.state.taskOrder).forEach((key) => {
    if (key >= dateKey) app.state.taskOrder[key] = app.state.taskOrder[key].filter((id) => id !== task.id);
  });
  return commitTaskChange(`Повтор завершен с ${formatLongDate(dateKey)}`, undo);
}

export function commitTaskChange(message, undo, toastOptions = {}) {
  if (saveState() === false) {
    restoreFailedSave(undo);
    render();
    return false;
  }
  render();
  showToast(message, { ...toastOptions, undo });
  return true;
}

export function deleteTask(taskId) {
  return taskState.deleteTask(taskId);
}

export function deleteMovedReplacement(taskId, options) {
  return taskState.deleteMovedReplacement(taskId, options);
}

export function deleteHabit(habitId) {
  taskState.deleteHabit(habitId);
}

export function reorderHabit(sourceId, targetId) {
  taskState.reorderHabit(sourceId, targetId);
}

export function deleteGoal(goalId) {
  taskState.deleteGoal(goalId);
}

export async function openDateTasks(dateKey, taskId = "") {
  if (!(await confirmDiscardOpenForms())) return;
  tasksView.setPane(dateKey === null ? "later" : "day");
  if (taskId) clearTaskFilters();
  app.activeDate = normalizeDateKey(dateKey, app.activeDate);
  app.activeView = "tasks";
  saveUiState();
  syncNavigationRoute();
  resetTaskForm({ open: false });
  resetHabitForm({ open: false });
  render();
  scrollWorkspaceTop();
  if (taskId) {
    const task = app.state.tasks.find((item) => item.id === taskId);
    if (task) taskFormController.fillTaskForm(task);
  }
}

export async function openLinkedHabit(habit) {
  if (!(await confirmDiscardOpenForms())) return;
  app.activeView = "habits";
  saveUiState();
  syncNavigationRoute();
  render();
  scrollWorkspaceTop();
  requestAnimationFrame(() => {
    const row = [...els.habitList.children].find((item) => item.dataset.habitId === habit.id);
    row?.scrollIntoView({ block: "center" });
    row?.querySelector("button, input")?.focus({ preventScroll: true });
  });
}

export function getStudyEvents(dateKey) {
  return app.showStudyEvents ? studyModel.eventsForDate(app.state, dateKey) : [];
}

export async function openStudyLesson(lessonId, dateKey) {
  if (!(await confirmDiscardOpenForms())) return;
  app.activeDate = dateKey;
  app.activeView = "study";
  studyController.setTab("schedule");
  saveUiState(); syncNavigationRoute(); render();
  requestAnimationFrame(() => {
    const button = [...document.querySelectorAll("[data-study-lesson-edit]")].find((item) => item.dataset.studyLessonEdit === lessonId);
    button?.scrollIntoView({ block: "center" }); button?.focus({ preventScroll: true });
  });
}

export async function openLinkedNote(noteId) {
  if (!(await confirmDiscardOpenForms())) return;
  if (!(await notesView.openNote(noteId))) return;
  app.activeView = "journal";
  saveUiState();
  syncNavigationRoute();
  render();
  scrollWorkspaceTop();
}

export function notesForTask(taskId) {
  const sourceId = app.state.tasks.find((task) => task.id === taskId)?.sourceNoteId;
  return (app.state.notes || []).filter((note) => note.taskId === taskId || note.id === sourceId);
}

export async function openNotesForTask(taskId) {
  const notes = notesForTask(taskId);
  if (notes.length === 1) return openLinkedNote(notes[0].id);
  if (!notes.length) return;
  const dialog = document.createElement("dialog"); dialog.className = "workspace-edit-dialog";
  const heading = document.createElement("h3"); heading.textContent = "Связанные заметки"; dialog.append(heading);
  notes.forEach((note) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "notes-list-item"; button.textContent = note.title;
    button.onclick = () => { dialog.close(); openLinkedNote(note.id); }; dialog.append(button);
  });
  const close = document.createElement("button"); close.type = "button"; close.className = "ghost-button"; close.textContent = "Закрыть"; close.onclick = () => dialog.close(); dialog.append(close);
  dialog.addEventListener("close", () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
}

export async function openBoardSource(type, id) {
  if (type === "task") {
    const task = app.state.tasks.find((item) => item.id === id);
    if (task) await openDateTasks(task.date, task.id);
    return;
  }
  if (type === "note") {
    await openLinkedNote(id);
    return;
  }
  if (!(await confirmDiscardOpenForms())) return;
  if (type === "material") {
    if (!app.state.studyFiles.some((item) => item.id === id)) return;
    studyController.openMaterial(id);
    app.activeView = "study";
  } else if (type === "subject") {
    if (!app.state.studySubjects.some((item) => item.id === id)) return;
    studyController.openSubject(id);
    app.activeView = "study";
  } else if (type === "goal") {
    if (!app.state.goals.some((item) => item.id === id)) return;
    goalsView.revealGoal(id);
    app.activeView = "goals";
  } else return;
  saveUiState();
  syncNavigationRoute();
  render();
  scrollWorkspaceTop();
  if (type === "goal") requestAnimationFrame(() => {
    const row = [...els.goalList.children].find((item) => item.dataset.goalId === id);
    row?.scrollIntoView({ block: "center" });
  });
  if (type === "subject" || type === "material") requestAnimationFrame(() => {
    const list = document.querySelector(type === "subject" ? "#studySubjectList" : "#studyMaterialList");
    const field = type === "subject" ? "studySubjectId" : "studyFileId";
    const row = [...(list?.children || [])].find((item) => item.dataset[field] === id);
    for (let parent = row?.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS") parent.open = true;
    }
    row?.scrollIntoView({ block: "center" });
    row?.querySelector("a, button")?.focus({ preventScroll: true });
  });
}

export async function openNotesForSubject(subjectId = "all") {
  if (!(await confirmDiscardOpenForms())) return;
  notesView.setSubjectFilter(subjectId);
  app.activeView = "journal";
  saveUiState();
  syncNavigationRoute();
  render();
  scrollWorkspaceTop();
}

export async function moveTaskToDate(taskId, sourceDateKey, targetDateKey) {
  const task = app.state.tasks.find((item) => item.id === taskId);
  const sourceDate = normalizeDateKey(sourceDateKey || app.activeDate, "");
  const targetDate = normalizeDateKey(targetDateKey, "");
  if (!task || !sourceDate || !targetDate || sourceDate === targetDate) return;
  if (task.repeat !== "none" && !task.sourceTaskId && targetDate > sourceDate) {
    const scope = await confirmAction({
      title: "Перенести повторяющуюся задачу?",
      message: `Перенести только ${formatLongDate(sourceDate)} или сдвинуть эту дату и все последующие повторения?`,
      secondaryLabel: "Перенести только этот день",
      confirmLabel: "Перенести этот и последующие",
    });
    if (!scope) return;
    if (scope === true) {
      const undo = createUndoSnapshot();
      const movedSeries = taskMoves.moveRecurringSeriesFollowing({
        state: app.state,
        task,
        sourceDateKey: sourceDate,
        targetDateKey: targetDate,
        helpers: { createId },
      });
      if (!movedSeries) {
        showToast("Не удалось перенести серию");
        return;
      }
      if (saveState() === false) {
        restoreFailedSave(undo);
        render();
        return;
      }
      render();
      showToast(`Серия перенесена на ${formatLongDate(targetDate)}`, {
        undo,
        action: { label: "Открыть день", onClick: () => openDateTasks(targetDate) },
      });
      return;
    }
  }
  postponeTask(task, sourceDate, targetDate);
}

export function attachTaskDropZone(element, dateKey) {
  calendarDragController.attachTaskDropZone(element, dateKey);
}

export function attachTaskChipDrag(chip) {
  calendarDragController.attachTaskChipDrag(chip);
}

export function clearTaskDragState() {
  calendarDragController.clearTaskDragState();
}

export function postponeTask(task, sourceDateKey, targetDateKey, options = {}) {
  const targetDate = normalizeDateKey(targetDateKey, "");
  if (!targetDate) {
    showToast("Не удалось перенести задачу");
    return;
  }
  const undo = options.undo || createUndoSnapshot();
  taskMoves.postponeTask({
    state: app.state,
    task,
    sourceDateKey,
    targetDateKey: targetDate,
    options,
    helpers: {
      cleanTimeValue,
      createId,
      taskScheduledOn,
      toDateKey,
    },
  });

  return commitTaskChange(`Задача перенесена на ${formatLongDate(targetDate)}`, undo, {
    action: { label: "Открыть день", onClick: () => openDateTasks(targetDate) },
  });
}

export function renderHabits() {
  habitsView.renderHabits();
}

export async function chooseRepeatMoveStrategy(entries, targetDateKey) {
  const groups = taskMoves.recurringBacklogGroups({ state: app.state, entries, targetDateKey, helpers: { taskScheduledOn, toDateKey } });
  if (!groups.size) return "each";
  const userId = remoteAuth.getSession()?.user?.id || "";
  const snapshot = app.state;
  const count = [...groups.values()].reduce((total, group) => total + group.length, 0);
  const choice = await confirmAction({ title: "Как перенести пропущенные повторы?",
    message: `Выбрано пропусков повторяющихся задач: ${count}. «Каждый отдельно» перенесёт каждое выполнение отдельной карточкой ${targetDateKey ? `на ${formatLongDate(targetDateKey)}` : "в Позже"}. «Одно на задачу» оставит одно актуальное действие для каждой серии; остальные выбранные пропуски сохранятся в истории как невыполненные. Обычные задачи будут перенесены без объединения.`,
    secondaryLabel: "Одно на задачу", confirmLabel: "Каждый отдельно" });
  if (!choice || app.state !== snapshot || (remoteAuth.getSession()?.user?.id || "") !== userId) return null;
  return choice === "secondary" ? "single" : "each";
}

export async function moveSelectedTasks(entries, targetDateKey) {
  const targetDate = normalizeDateKey(targetDateKey, "");
  if (!targetDate) return false;
  const recurringMode = await chooseRepeatMoveStrategy(entries, targetDate);
  if (!recurringMode) return false;
  const undo = createUndoSnapshot();
  const result = taskMoves.moveTasksToDate({
    state: app.state, entries, targetDateKey: targetDate, recurringMode,
    helpers: { cleanTimeValue, createId, taskScheduledOn, toDateKey },
  });
  if (!result.moved) {
    showToast("Выбранные задачи уже на этой дате");
    return true;
  }
  if (saveState() === false) {
    replaceState(JSON.parse(undo.state));
    render();
    return false;
  }
  render();
  showToast(result.consolidated ? `Повторы разобраны: ${result.moved} · по одному действию на серию` : `Перенесено задач: ${result.moved}${result.skipped ? ` · без изменений: ${result.skipped}` : ""}`, {
    undo, action: { label: "Открыть день", onClick: () => openDateTasks(targetDate) },
  });
  return true;
}

export async function deferSelectedTasks(entries) {
  const recurringMode = await chooseRepeatMoveStrategy(entries, null);
  if (!recurringMode) return false;
  const undo = createUndoSnapshot();
  const result = taskMoves.moveTasksToLater({ state: app.state, entries, recurringMode, helpers: { createId, taskScheduledOn, toDateKey } });
  if (!result.moved) { showToast("Выполненные и уже отложенные задачи не изменены"); return false; }
  if (saveState() === false) { replaceState(JSON.parse(undo.state)); render(); return false; }
  render(); showToast(result.consolidated ? "В Позже: по одному действию на серию" : `В Позже: ${result.moved}`, { undo });
  return true;
}

export async function dismissSelectedTasks(entries) {
  const dated = entries.filter((entry) => entry.dateKey);
  if (!dated.length) { showToast("У отложенных задач ещё нет даты выполнения"); return false; }
  if (!await confirmAction({ title: "Убрать из незавершённых?",
    message: "Выбранные дни больше не появятся в этом списке. Задачи останутся в своей дате без отметки выполнения; будущие повторы не изменятся.", confirmLabel: "Не выполнять" })) return false;
  const undo = createUndoSnapshot();
  dated.forEach(({ taskId, dateKey }) => {
    const task = app.state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    task.acknowledgedOverdue ||= {}; task.acknowledgedOverdue[dateKey] = true; task.updatedAt = new Date().toISOString();
  });
  if (saveState() === false) { replaceState(JSON.parse(undo.state)); render(); return false; }
  render(); showToast(`Убрано из незавершённых: ${dated.length}`, { undo });
  return true;
}

export function renderGoals() {
  goalsView.renderGoals();
}

export function renderOverview() {
  return calendarView.renderOverview();
}

export function renderArchive() {
  return archiveView.renderArchive();
}

export function renderCategories() {
  categoriesController.renderCategories();
}

export function saveTaskFromForm(event) {
  taskFormController.saveTaskFromForm(event);
}

export function saveGoalFromForm(event) {
  goalsView.saveGoalFromForm(event);
}

export function resetGoalForm(options) {
  goalsView.resetGoalForm(options);
}
