// Task, habit, goal, calendar, timeline, archive, journal and notes views.

import * as tasksViewModule from "../tasks/tasks-view.js";
import * as habitsViewModule from "../habits/habits-view.js";
import * as habitConfigHistory from "../habits/habit-config-history.js";
import * as habitTitleHistory from "../habits/habit-title-history.js";
import * as habitFreezeDialogModule from "../habits/habit-freeze-dialog.js";
import * as goalCheckpointEditorModule from "../goals/goal-checkpoint-editor.js";
import * as goalsViewModule from "../goals/goals-view.js";
import * as calendarViewModule from "../calendar/calendar-view.js";
import * as timelineControllerModule from "../timeline/timeline-controller.js";
import * as calendarScheduleModule from "../calendar/calendar-schedule.js";
import * as taskMoves from "../tasks/task-moves.js";
import * as timelineViewModule from "../timeline/timeline-view.js";
import * as archiveViewModule from "../tasks/archive-view.js";
import * as journalViewModule from "../journal/journal-view.js";
import * as journalModel from "../journal/journal-model.js";
import * as notesViewModule from "../notes/notes-view.js";
import { app } from "./store.js";
import { todayKey, nowInTimeZone } from "./state.js";
import { els } from "./dom.js";
import { subtaskController, taskFormController } from "./editors.js";
import { confirmDiscardOpenForms, fillHabitForm, fillTaskForm, markFormPristine, openFloatingTaskForm, resetHabitForm, resetTaskForm, updateQuickTaskPreview } from "./forms.js";
import { render, renderDailyPulse, renderGoalSurfaces, renderHabitSurfaces, renderTaskSurfaces, scrollWorkspaceTop, syncNavigationRoute } from "./lifecycle.js";
import { confirmAction, createUndoSnapshot, normalizeState, replaceState, restoreFailedSave, saveState, showToast } from "./persistence.js";
import { archiveEntries, archiveEntryMatchesSearch, excludedTasksForDate, formatHabitRepeat, formatTaskRepeat, formatTaskWindow, getCategory, getOrderedTasksForDate, habitConfigOnDate, habitStatusOnDate, habitStreak, habitsForDate, isTaskDone, isTaskExcluded, isTimeBlock, isValidTimeBlock, matchesCategoryFilter, overdueTaskEntries, reorderTask, statsForDate, taskDetails, taskMatchesSearch, taskMetaItems, taskOccursOn, taskScheduledOn, taskSortTime } from "./queries.js";
import { calendarDragController, priorityLabels, remoteAuth, saveSubtaskChange, setTaskScheduleMode, syncTaskScheduleMode, syncTaskTimePresets } from "./services.js";
import { saveUiState } from "./settings.js";
import { appShellController, focusTimer } from "./shell.js";
import { addDays, cleanText, cleanTimeValue, createId, escapeHtml, formatLongDate, formatMonthLabel, formatShortDate, formatTime, formatWeekday, getMonthCalendarDates, getWeekDates, heatAlpha, minutesToTime, normalizeDateKey, parseDate, timeToMinutes, toDateKey } from "./state.js";
import { acknowledgeAllOverdueTasks, acknowledgeOverdueTask, attachTaskChipDrag, attachTaskDropZone, clearTaskDragState, deferSelectedTasks, deleteGoal, deleteHabit, deleteMovedReplacement, deleteTask, dismissSelectedTasks, excludeTaskDate, getStudyEvents, moveSelectedTasks, notesForTask, openDateTasks, openLinkedHabit, openLinkedNote, openNotesForTask, openStudyLesson, postponeTask, renderOverview, reorderHabit, restoreOverdueTask, restoreTaskDate, stopTaskSeries } from "./task-actions.js";

export let tasksView, habitsView, habitFreezeDialog, goalCheckpointEditor, goalsView, calendarView, timelineController, calendarSchedule, timelineView, archiveView, journalView, notesView;

export async function toggleCalendarTaskDone(taskId, date) {
  const owner = app.state;
  if (!(await confirmDiscardOpenForms()) || app.state !== owner) { render(); return false; }
  const task = app.state.tasks.find((item) => item.id === taskId);
  if (!task || (!taskOccursOn(task, date) && !(task.date === null && task.repeat === "none" && task.dueDate === date))) { render(); return false; }
  const undo = createUndoSnapshot();
  const done = isTaskDone(task, date);
  task.completed ||= {};
  task.completed[date] = !done;
  task.updatedAt = new Date().toISOString();
  if (saveState() === false) { restoreFailedSave(undo); render(); return false; }
  render();
  showToast(done ? "Задача снова активна" : "Задача выполнена", { undo });
  return true;
}

export async function calendarScheduleTask(taskId, sourceDate, targetDate, startTime) {
  const owner = app.state;
  if (!(await confirmDiscardOpenForms()) || app.state !== owner) return false;
  const task = app.state.tasks.find((item) => item.id === taskId);
  if (!task || !taskOccursOn(task, sourceDate)) return false;
  if (sourceDate === targetDate) {
    app.activeDate = sourceDate;
    saveUiState();
    const result = await timelineController.setTaskTime(taskId, startTime);
    if (!result) render();
    return result;
  }
  if (task.repeat !== "none") {
    const choice = await confirmAction({ title: "Перенести этот повтор?",
      message: "На другой день будет перенесено только выбранное выполнение. Остальное расписание останется прежним.",
      confirmLabel: "Перенести", secondaryLabel: "Отмена" });
    if (choice !== true || app.state !== owner) return false;
  }
  const undo = createUndoSnapshot();
  let moved = task;
  taskMoves.postponeTask({ state: app.state, task, sourceDateKey: sourceDate, targetDateKey: targetDate,
    options: { separateOccurrence: true }, helpers: { createId, taskScheduledOn } });
  if (task.repeat !== "none") moved = app.state.tasks.at(-1);
  const duration = isTimeBlock(task) ? timeToMinutes(task.endTime) - timeToMinutes(task.startTime) : 60;
  const end = Math.min(23 * 60 + 59, timeToMinutes(startTime) + duration);
  Object.assign(moved, { scheduleMode: "block", startTime: minutesToTime(Math.max(0, end - duration)),
    endTime: minutesToTime(end), time: minutesToTime(end), updatedAt: new Date().toISOString() });
  delete moved.notified?.[targetDate];
  delete moved.workNotified?.[targetDate];
  if (saveState() === false) { restoreFailedSave(undo); render(); return false; }
  app.activeDate = targetDate;
  saveUiState();
  render();
  showToast(`Запланировано на ${formatLongDate(targetDate)}`, { undo });
  return true;
}

export function wireViews() {
  tasksView = tasksViewModule.createTasksView({
    todayKey,
    getPane: () => app.taskPane,
    onPaneChange: (value) => { app.taskPane = value; saveUiState(); updateQuickTaskPreview(); },
    deferTasks: deferSelectedTasks,
    dismissTasks: dismissSelectedTasks,
    els,
    priorityLabels,
    addDays,
    acknowledgeOverdueTask,
    acknowledgeAllOverdueTasks,
    clearTaskDragState,
    createUndoSnapshot,
    confirmAction,
    deleteTask,
    deleteMovedReplacement,
    duplicateTask: (taskId) => timelineController.duplicateTask(taskId),
    escapeHtml,
    startFocus: (taskId) => focusTimer?.focusOn(taskId),
    excludeTaskDate,
    excludedTasksForDate,
    fillTaskForm,
    openSubtaskDialog: async (task, dateKey) => {
      const previousState = app.state;
      if (!(await confirmDiscardOpenForms()) || app.state !== previousState) return;
      subtaskController.open(task, dateKey);
    },
    addSubtask: (task, dateKey, title, scope) => saveSubtaskChange(task, dateKey, scope, { title }),
    removeSubtask: (task, dateKey, itemId, scope) => saveSubtaskChange(task, dateKey, scope, { itemId }),
    formatLongDate,
    formatTime,
    formatTaskRepeat,
    getActiveDate: () => app.activeDate,
    getCategory,
    getOrderedTasksForDate,
    getState: () => app.state,
    getNotesForTask: notesForTask,
    openNotesForTask,
    getTaskCategoryFilter: () => app.taskCategoryFilter,
    getTaskFilter: () => app.taskFilter,
    getTaskSearchQuery: () => app.taskSearchQuery,
    openNote: openLinkedNote,
    isTaskDone,
    isTaskExcluded,
    matchesCategoryFilter,
    openDate: async (dateKey) => {
      if (!(await confirmDiscardOpenForms())) return;
      app.activeDate = dateKey;
      saveUiState();
      resetTaskForm({ open: false });
      resetHabitForm({ open: false });
      render();
      scrollWorkspaceTop();
    },
    overdueTaskEntries,
    getOverdueHidden: () => app.overdueHidden,
    setOverdueHidden: (value) => {
      app.overdueHidden = value === true;
      saveUiState();
    },
    postponeTask,
    moveTasks: moveSelectedTasks,
    openLaterTaskForm: async () => {
      if (!(await confirmDiscardOpenForms())) return;
      resetTaskForm({ open: true });
      taskFormController.setDeferred(true);
      markFormPristine(els.taskForm);
      els.taskTitle.focus();
    },
    render: renderTaskSurfaces,
    reorderTask,
    restoreTaskDate,
    restoreOverdueTask,
    stopTaskSeries,
    restoreState: restoreFailedSave,
    saveState,
    setDraggedTask: (taskId, dateKey) => {
      calendarDragController.setDraggedTask(taskId, dateKey);
    },
    showToast,
    taskDetails,
    taskMatchesSearch,
    taskMetaItems,
    taskOccursOn,
    toDateKey,
  });

  habitsView = habitsViewModule.createHabitsView({
    todayKey,
    applyHabitAvailabilityChange: habitConfigHistory.applyHabitAvailabilityChange,
    els,
    confirmAction,
    createUndoSnapshot,
    restoreState: restoreFailedSave,
    deleteHabit,
    escapeHtml,
    fillHabitForm,
    formatHabitRepeat,
    getActiveDate: () => app.activeDate,
    getState: () => app.state,
    isTaskDone,
    habitStreak,
    habitStatusOnDate,
    openFreezeDialog: (habitId, operation) => habitFreezeDialog.open(habitId, operation),
    habitConfigOnDate,
    habitTitleOnDate: habitTitleHistory.habitTitleOnDate,
    habitsForDate,
    render: renderHabitSurfaces,
    renderDailyPulse,
    renderOverviewIfActive: () => {
      if (app.activeView === "overview") renderOverview();
    },
    reorderHabit,
    saveState,
    showToast,
  });

  habitFreezeDialog = habitFreezeDialogModule.createHabitFreezeDialog({
    els,
    createUndoSnapshot,
    restoreState: restoreFailedSave,
    getActiveDate: () => app.activeDate,
    getState: () => app.state,
    habitStatusOnDate,
    habitTitleOnDate: habitTitleHistory.habitTitleOnDate,
    render,
    saveState,
    showToast,
  });

  els.openHabitFreeze.addEventListener("click", () => habitFreezeDialog.open());

  goalCheckpointEditor = goalCheckpointEditorModule.createGoalCheckpointEditor({
    createId,
    els,
  });

  goalsView = goalsViewModule.createGoalsView({
    todayKey,
    confirmDiscardOpenForms,
    checkpointEditor: goalCheckpointEditor,
    els,
    cleanText,
    confirmAction,
    createId,
    createUndoSnapshot,
    restoreState: (snapshot) => replaceState(JSON.parse(snapshot.state)),
    deleteGoal,
    getActiveDate: () => app.activeDate,
    getState: () => app.state,
    habitStatusOnDate,
    markFormPristine,
    normalizeDateKey,
    openTask: (task) => openDateTasks(task.date, task.id),
    openHabit: openLinkedHabit,
    render: renderGoalSurfaces,
    saveState,
    showToast,
    toDateKey,
    upsertGoal: (goal) => {
      delete app.state.tombstones?.goals?.[goal.id];
      const existing = app.state.goals.find((item) => item.id === goal.id);
      if (existing) {
        Object.assign(existing, goal);
      } else {
        app.state.goals.push(goal);
      }
    },
  });

  calendarView = calendarViewModule.createCalendarView({
    todayKey,
    toggleTaskDone: toggleCalendarTaskDone,
    renderSchedule: (mode) => calendarSchedule.render(mode),
    selectCalendarDate: (dateKey) => { app.activeDate = dateKey; saveUiState(); render(); },
    getStudyEvents,
    openStudyLesson,
    els,
    attachTaskChipDrag,
    attachTaskDropZone,
    escapeHtml,
    formatLongDate,
    formatMonthLabel,
    formatShortDate,
    formatWeekday,
    getActiveDate: () => app.activeDate,
    getState: () => app.state,
    getCategory,
    getMonthCalendarDates,
    getOrderedTasksForDate,
    getWeekDates,
    habitsForDate,
    habitStatusOnDate,
    heatAlpha,
    isTaskDone,
    openDateTasks,
    parseDate,
    priorityLabels,
    statsForDate,
    toDateKey,
  });

  timelineController = timelineControllerModule.createTimelineController({
    markFormPristine,
    cleanTimeValue,
    confirmAction,
    createId,
    createUndoSnapshot,
    restoreState: restoreFailedSave,
    deleteTask,
    deleteMovedReplacement,
    excludeTaskDate,
    els,
    findTask: (id) => app.state.tasks.find((task) => task.id === id),
    formatTaskWindow,
    formatLongDate,
    formatTime,
    getActiveDate: () => app.activeDate,
    getOrderedTasksForDate,
    getState: () => app.state,
    isTaskDone,
    isTimeBlock,
    isValidTimeBlock,
    messages: {
      active: "Задача снова активна",
      blockUpdated: "Блок обновлен",
      copySuffix: "копия",
      deleted: "Задача удалена",
      done: "Задача выполнена",
      duplicated: "Задача продублирована",
      movedTo: "Перенесено на",
      timeUpdated: "Время задачи обновлено",
    },
    minutesToTime,
    openFloatingTaskForm,
    render: renderTaskSurfaces,
    resetTaskForm,
    saveState,
    setTaskScheduleMode,
    showToast,
    stopTaskSeries,
    syncTaskScheduleMode,
    syncTaskTimePresets,
    taskSortTime,
    timeToMinutes,
  });

  calendarSchedule = calendarScheduleModule.createCalendarSchedule({
    confirmClose: confirmDiscardOpenForms,
    changeMode: async (mode) => {
      if (!(await confirmDiscardOpenForms())) return false;
      app.overviewMode = mode;
      appShellController.syncOverviewMode();
      saveUiState();
      syncNavigationRoute({ replace: true });
      renderOverview();
      return true;
    },
    toggleTaskDone: toggleCalendarTaskDone,
    getActiveDate: () => app.activeDate,
    getState: () => app.state,
    getTasks: getOrderedTasksForDate,
    getStudyEvents,
    getWeekDates,
    getCategory,
    isTaskDone,
    todayKey,
    getNow: nowInTimeZone,
    formatLongDate,
    formatShortDate,
    openLesson: (lesson, date) => openStudyLesson(lesson.id, date),
    selectDate: async (date) => {
      if (!(await confirmDiscardOpenForms())) return false;
      app.activeDate = date;
      resetTaskForm({ open: false });
      saveUiState();
      render();
      return true;
    },
    createTask: async (date, start, end) => {
      if (!(await confirmDiscardOpenForms())) return;
      app.activeDate = date;
      saveUiState();
      render();
      if (start && end) timelineController.createTaskAtTime(start, end);
      else { resetTaskForm(); openFloatingTaskForm(); els.taskTitle.focus(); }
    },
    editTask: async (task, date) => {
      const owner = app.state;
      if (!(await confirmDiscardOpenForms()) || app.state !== owner || !app.state.tasks.includes(task)) return;
      app.activeDate = date;
      saveUiState();
      render();
      openFloatingTaskForm();
      taskFormController.fillTaskForm(task);
    },
    scheduleTask: calendarScheduleTask,
    resizeTask: async (id, date, start, end) => {
      const owner = app.state;
      if (!(await confirmDiscardOpenForms()) || app.state !== owner) { render(); return false; }
      const task = app.state.tasks.find((item) => item.id === id);
      if (!task || !taskOccursOn(task, date)) return false;
      app.activeDate = date;
      saveUiState();
      const result = await timelineController.resizeTaskBlockTime(id, start, end);
      if (!result) render();
      return result;
    },
  });

  timelineView = timelineViewModule.createTimelineView({
    todayKey,
    getNow: nowInTimeZone,
    getStudyEvents,
    openStudyLesson,
    addDays,
    els,
    clearTaskTime: timelineController.clearTaskTime,
    createTaskAtTime: timelineController.createTaskAtTime,
    deleteTask: timelineController.deleteTask,
    duplicateTask: timelineController.duplicateTask,
    fillTaskForm,
    formatTime,
    getActiveDate: () => app.activeDate,
    getCategory,
    getOrderedTasksForDate,
    isTaskDone,
    moveTaskTime: timelineController.moveTaskTime,
    priorityLabels,
    postponeTask,
    resizeTaskBlockTime: timelineController.resizeTaskBlockTime,
    setTaskTime: timelineController.setTaskTime,
    shiftTaskTime: timelineController.shiftTaskTime,
    toggleTaskDone: timelineController.toggleTaskDone,
    toDateKey,
  });

  archiveView = archiveViewModule.createArchiveView({
    todayKey,
    addDays,
    initialPeriod: app.archivePeriod,
    els,
    archiveEntries,
    archiveEntryMatchesSearch,
    confirmAction,
    createUndoSnapshot,
    getState: () => app.state,
    restoreState: restoreFailedSave,
    deleteTask,
    escapeHtml,
    formatLongDate,
    getArchiveCategoryFilter: () => app.archiveCategoryFilter,
    getArchiveSearchQuery: () => app.archiveSearchQuery,
    getCategory,
    matchesCategoryFilter,
    onPeriodChange: (value) => {
      app.archivePeriod = value;
      saveUiState();
    },
    postponeTask,
    priorityLabels,
    render: renderTaskSurfaces,
    saveState,
    showToast,
    toDateKey,
  });

  journalView = journalViewModule.createJournalView({
    buildMonth: journalModel.buildJournalMonth,
    confirmRestore: () => confirmAction({
      title: "Восстановить эту версию?",
      message: "Текущий текст останется в истории, поэтому его можно будет вернуть.",
      confirmLabel: "Восстановить",
    }),
    els,
    formatDateTime: (timestamp) => new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp)),
    formatLongDate,
    formatTime: (timestamp) => new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp)),
    getActiveDate: () => app.activeDate,
    getEntry: (dateKey) => journalModel.journalEntryForDate(app.state.journalEntries, dateKey),
    getEntries: () => app.state.journalEntries,
    getUserId: () => remoteAuth.getSession()?.user?.id || "",
    getFirstDayOfWeek: () => app.firstDayOfWeek,
    maxLength: journalModel.MAX_JOURNAL_LENGTH,
    restoreRevision: (dateKey, savedAt) => {
      const previous = app.state.journalEntries;
      const result = journalModel.restoreJournalRevision(
        app.state.journalEntries,
        dateKey,
        savedAt,
        { createId },
      );
      if (!result.changed) return result;
      app.state.journalEntries = result.entries;
      if (saveState() === false) { app.state.journalEntries = previous; return { changed: false, saved: false }; }
      return result;
    },
    searchEntries: journalModel.searchJournalEntries,
    saveEntry: (dateKey, text) => {
      const previous = app.state.journalEntries;
      const result = journalModel.upsertJournalEntry(
        app.state.journalEntries,
        { date: dateKey, text },
        { createId, forceRevision: true },
      );
      if (!result.changed) return result;
      app.state.journalEntries = result.entries;
      if (result.entry) delete app.state.tombstones?.journalEntries?.[result.entry.id];
      if (saveState() === false) { app.state.journalEntries = previous; return { ...result, saved: false }; }
      return result;
    },
    setActiveDate: (dateKey) => {
      app.activeDate = dateKey;
      els.activeDate.value = app.activeDate;
      saveUiState();
      resetTaskForm({ open: false });
      resetHabitForm({ open: false });
      render();
    },
    showToast,
  });

  notesView = notesViewModule.createNotesView({
    createTaskFromNote: (note, text) => {
      const undo = createUndoSnapshot();
      const now = new Date().toISOString();
      const task = normalizeState({ ...app.state, tasks: [{ id: createId(), title: cleanText(text).slice(0, 240), date: null, repeat: "none", sourceNoteId: note.id, priority: "medium", createdAt: now, updatedAt: now }] }).tasks[0];
      if (!task) return;
      app.state.tasks.push(task);
      if (saveState() === false) { app.state.tasks = app.state.tasks.filter((item) => item.id !== task.id); return; }
      showToast("Задача создана в «Позже»", { undo });
    },
    restoreState: (snapshot) => replaceState(normalizeState(JSON.parse(snapshot.state))),
    getUserId: () => remoteAuth.getSession()?.user?.id || "",
    confirmAction,
    createId,
    createUndoSnapshot,
    els,
    getState: () => app.state,
    openTask: (task) => openDateTasks(task.date, task.id),
    renderJournal: journalView.render,
    saveState,
    showToast,
  });
}
