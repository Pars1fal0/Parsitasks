// Board, search, nutrition and the task, habit and category editors.

import * as taskSubtasks from "../tasks/task-subtasks.js";
import * as habitConfigHistory from "../habits/habit-config-history.js";
import * as habitTitleHistory from "../habits/habit-title-history.js";
import * as taskMoves from "../tasks/task-moves.js";
import * as boardAssetsModule from "../board/board-assets.js";
import * as boardViewModule from "../board/board-view.js";
import * as boardModel from "../board/board-model.js";
import * as boardLinks from "../board/board-links.js";
import * as globalSearchModule from "../ui/global-search.js";
import * as nutritionControllerModule from "../nutrition/nutrition-controller.js";
import * as nutritionModel from "../nutrition/nutrition-model.js";
import * as nutritionViewModule from "../nutrition/nutrition-view.js";
import * as taskFormModule from "../tasks/task-form.js";
import * as habitFormModule from "../habits/habit-form.js";
import * as recurrence from "../tasks/recurrence.js";
import * as categoriesModule from "../tasks/categories.js";
import { app } from "./store.js";
import { els } from "./dom.js";
import { clearTaskFilters, closeFloatingTaskForm, confirmDiscardOpenForms, getCustomRepeatFromForm, getHabitCustomRepeatFromForm, markFormPristine, resetHabitForm, resetTaskForm, setCustomRepeatForm, setHabitCustomRepeatForm, syncCustomRepeatPanel, syncHabitCustomRepeatPanel, syncHabitTypeFields } from "./forms.js";
import { render, renderTaskSurfaces, renderTasks, scrollWorkspaceTop, syncNavigationRoute } from "./lifecycle.js";
import { confirmAction, createUndoSnapshot, replaceState, restoreFailedSave, saveState, showToast } from "./persistence.js";
import { syncDesktopReminders } from "./platform.js";
import { habitConfigOnDate, isTaskDone, isTimeBlock, isValidTimeBlock, matchesCategoryFilter, normalizeHabitRepeat, taskMatchesSearch } from "./queries.js";
import { getTaskScheduleMode, remoteAuth, setTaskScheduleMode, syncTaskScheduleMode, syncTaskTimePresets } from "./services.js";
import { saveUiState } from "./settings.js";
import { studyController } from "./shell.js";
import { cleanText, cleanTimeValue, createId, escapeHtml, formatLongDate, normalizeDateKey, toDateKey } from "./state.js";
import { openBoardSource, resetGoalForm } from "./task-actions.js";
import { archiveView, goalsView, notesView, tasksView } from "./views.js";

export let boardAssets, boardView, globalSearch, nutritionController, nutritionView, taskFormController, subtaskController, habitFormController, categoriesController;

export function wireEditors() {
  boardAssets = boardAssetsModule.createBoardAssetStore({
    getOwner: () => remoteAuth.getSession()?.user?.id ? JSON.stringify([app.remoteSyncUrl, remoteAuth.getSession().user.id]) : "",
    getRemoteConfig: async () => {
      const session = await remoteAuth.ensureFreshSession().catch(() => remoteAuth.getSession());
      return {
        accessToken: session?.access_token || "",
        anonKey: app.remoteSyncAnonKey,
        enabled: app.remoteSyncEnabled === "on",
        supabaseUrl: app.remoteSyncUrl,
        userId: session?.user?.id || "",
      };
    },
  });

  boardAssets.pruneCache().catch(() => {});

  boardView = boardViewModule.createBoardView({
    getUserId: () => remoteAuth.getSession()?.user?.id || "",
    assets: boardAssets,
    commitItems: (items, options = {}) => {
      const previous = createUndoSnapshot();
      const normalized = boardModel.normalizeItems(items, { createId });
      app.state.boardItems = normalized;
      app.state.tombstones.boardItems ||= {};
      (options.deletedIds || []).forEach((id) => {
        app.state.tombstones.boardItems[id] = new Date().toISOString();
      });
      normalized.forEach((item) => {
        delete app.state.tombstones.boardItems[item.id];
      });
      if (saveState() === false) {
        restoreFailedSave(previous);
        return false;
      }
      return true;
    },
    createId,
    els,
    getState: () => app.state,
    getItems: () => app.state.boardItems,
    links: boardLinks,
    model: boardModel,
    openSource: openBoardSource,
    showToast,
    todayKey: () => toDateKey(new Date()),
  });

  globalSearch = globalSearchModule.createGlobalSearch({
    els,
    formatDate: formatLongDate,
    getState: () => app.state,
    openResult: async (result) => {
      if (!(await confirmDiscardOpenForms())) return;
      resetTaskForm({ open: false });
      resetHabitForm({ open: false });
      resetGoalForm({ open: false });
      if (result.view === "tasks") clearTaskFilters();
      if (result.type === "material") studyController.openMaterial(result.id);
      if (result.type === "subject") studyController.openSubject(result.id);
      if (result.type === "goal") goalsView.revealGoal(result.id);
      if (result.view === "tasks") tasksView.setPane(result.date === null ? "later" : "day");
      if (result.type === "note") await notesView.openNote(result.id);
      if (result.type === "journal") await notesView.setMode("journal");
      if (result.view === "archive") {
        app.archiveCategoryFilter = "all";
        app.archiveSearchQuery = result.title;
        els.archiveSearch.value = app.archiveSearchQuery;
        archiveView.setPeriod("all");
      }
      if (result.date) {
        app.activeDate = result.date;
        els.activeDate.value = app.activeDate;
      }
      app.activeView = result.view;
      saveUiState();
      syncNavigationRoute();
      render();
      scrollWorkspaceTop();
      if (result.type === "board") requestAnimationFrame(() => boardView.focusItem(result.id));
      if (result.type === "subject") requestAnimationFrame(() => {
        const row = [...document.querySelectorAll("[data-study-subject-edit]")].find((button) => button.dataset.studySubjectEdit === result.id);
        for (let parent = row?.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
        row?.scrollIntoView({ block: "center" }); row?.focus({ preventScroll: true });
      });
      if (result.type === "task") {
        tasksView.setPane(result.date === null ? "later" : "day");
        requestAnimationFrame(() => {
          if (app.state.tasks.find((task) => task.id === result.id)?.date === null) {
            const panel = document.querySelector("#laterTaskPanel");
            panel.open = true;
            const row = [...document.querySelector("#laterTaskList").children].find((item) => item.dataset.taskId === result.id);
            row?.scrollIntoView({ block: "center" });
            row?.querySelector("button")?.focus({ preventScroll: true });
            return;
          }
          const row = [...els.taskList.children].find((item) => item.dataset.taskId === result.id);
          if (!row) return;
          if (result.checklistMatch) row.querySelector(".task-checklist")?.setAttribute("open", "");
          row.scrollIntoView({ block: "center" });
          row.querySelector(".check-button")?.focus({ preventScroll: true });
        });
      }
    },
    search: globalSearchModule.searchWorkspace,
  });

  nutritionController = nutritionControllerModule.createNutritionController({
    confirmAction,
    createId,
    createUndoSnapshot,
    getState: () => app.state,
    model: nutritionModel,
    now: () => new Date().toISOString(),
    onRollback: syncDesktopReminders,
    render,
    saveState,
    showToast,
  });

  nutritionView = nutritionViewModule.createNutritionView({
    ...nutritionController,
    createId,
    els,
    formatDate: (dateKey) => new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${dateKey}T00:00:00.000Z`)),
    formatDay: (dateKey) => new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${dateKey}T00:00:00.000Z`)),
    formatWeekday: (dateKey) => new Intl.DateTimeFormat("ru-RU", {
      weekday: "short",
      timeZone: "UTC",
    }).format(new Date(`${dateKey}T00:00:00.000Z`)),
    getActiveDate: () => app.activeDate,
    getFirstDayOfWeek: () => app.firstDayOfWeek,
    getState: () => app.state,
    getUserId: () => remoteAuth.getSession()?.user?.id || "",
    confirmAction,
    model: nutritionModel,
    setActiveDate: (dateKey) => {
      app.activeDate = dateKey;
      els.activeDate.value = app.activeDate;
      saveUiState();
      render();
    },
    showToast,
    today: () => toDateKey(new Date()),
  });

  taskFormController = taskFormModule.createTaskForm({
    els,
    afterClose: closeFloatingTaskForm,
    restoreState: (snapshot) => { replaceState(JSON.parse(snapshot.state)); render(); },
    getDefaultCategoryId: () => app.state.categories.some((category) => category.id === app.taskCategoryFilter)
      ? app.taskCategoryFilter : "",
    afterSave: (task) => {
      if (app.activeView === "tasks") tasksView.setPane(task.date === null ? "later" : "day");
      if (app.activeView === "tasks" && (
        (app.taskFilter === "done" && !isTaskDone(task, app.activeDate)) ||
        (app.taskFilter === "open" && isTaskDone(task, app.activeDate)) || !matchesCategoryFilter(task, app.taskCategoryFilter) ||
        !taskMatchesSearch(task, app.taskSearchQuery, app.activeDate)
      )) {
        clearTaskFilters();
        saveUiState();
        renderTasks();
      }
    },
    cleanText,
    cleanTimeValue,
    createId,
    createUndoSnapshot,
    findTask: (id) => app.state.tasks.find((task) => task.id === id),
    getActiveDate: () => app.activeDate,
    getCustomRepeatFromForm,
    getTaskScheduleMode,
    isTimeBlock,
    isValidTimeBlock,
    markFormPristine,
    normalizeDateKey,
    render,
    saveState,
    setActiveDate: (dateKey) => {
      app.activeDate = dateKey;
    },
    setCustomRepeatForm,
    setTaskScheduleMode,
    showToast,
    syncCustomRepeatPanel,
    syncTaskScheduleMode,
    syncTaskTimePresets,
    updateRecurringTask: (task, editedTask, dateKey, scope) => taskMoves.updateRecurringTaskDetails({
      state: app.state,
      task,
      editedTask,
      dateKey,
      scope,
      helpers: { createId },
    }),
    upsertTask: (task) => {
      delete app.state.tombstones?.tasks?.[task.id];
      const existing = app.state.tasks.find((item) => item.id === task.id);
      if (existing) {
        Object.assign(existing, task);
      } else {
        app.state.tasks.push(task);
      }
    },
  });

  subtaskController = taskSubtasks.createSubtaskDialog({
    getState: () => app.state, createId, createUndoSnapshot, saveState, showToast, formatLongDate,
    restoreState: restoreFailedSave,
    render: renderTaskSurfaces,
    today: () => toDateKey(new Date()),
    expandChecklist: (taskId, dateKey) => tasksView.expandChecklist(taskId, dateKey),
  });

  habitFormController = habitFormModule.createHabitForm({
    applyHabitConfigChange: habitConfigHistory.applyHabitConfigChange,
    applyHabitTitleChange: habitTitleHistory.applyHabitTitleChange,
    els,
    cleanText,
    cleanTimeValue,
    createId,
    createUndoSnapshot,
    restoreState: restoreFailedSave,
    findHabit: (id) => app.state.habits.find((habit) => habit.id === id),
    getActiveDate: () => app.activeDate,
    getHabitCustomRepeatFromForm,
    habitConfigOnDate,
    habitTitleOnDate: habitTitleHistory.habitTitleOnDate,
    markFormPristine,
    normalizeHabitRepeat,
    normalizeCustomRepeat: recurrence.normalizeCustomRepeat,
    render,
    saveState,
    setHabitCustomRepeatForm,
    showToast,
    syncHabitCustomRepeatPanel,
    syncHabitTypeFields,
    upsertHabit: (habit) => {
      delete app.state.tombstones?.habits?.[habit.id];
      const existing = app.state.habits.find((item) => item.id === habit.id);
      if (existing) {
        Object.assign(existing, habit);
      } else {
        app.state.habits.push(habit);
      }
    },
  });

  categoriesController = categoriesModule.createCategories({
    els,
    cleanText,
    confirmAction,
    createId,
    createUndoSnapshot,
    escapeHtml,
    getArchiveCategoryFilter: () => app.archiveCategoryFilter,
    getState: () => app.state,
    getTaskCategoryFilter: () => app.taskCategoryFilter,
    render,
    saveState,
    saveUiState,
    setArchiveCategoryFilter: (value) => {
      app.archiveCategoryFilter = value;
    },
    setTaskCategoryFilter: (value) => {
      app.taskCategoryFilter = value;
    },
    showToast,
  });
}
