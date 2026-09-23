const assert = require("node:assert/strict");
const { installDom } = require("./dom-test-utils.cjs");

function loadDomModules() {
  installDom();
  global.RhythmHeatmapView = { createHeatmapView: () => ({ renderHeatmap() {} }) };
  delete require.cache[require.resolve("../app/src/tasks/archive-view.js")];
  delete require.cache[require.resolve("../app/src/calendar/calendar-view.js")];
  delete require.cache[require.resolve("../app/src/tasks/categories.js")];
  delete require.cache[require.resolve("../app/src/habits/habits-view.js")];
  delete require.cache[require.resolve("../app/src/tasks/tasks-view.js")];
  const archive = require("../app/src/tasks/archive-view.js");
  const calendar = require("../app/src/calendar/calendar-view.js");
  const tasks = require("../app/src/tasks/tasks-view.js");
  require("../app/src/tasks/categories.js");
  const habits = require("../app/src/habits/habits-view.js");
  return { archive, calendar, categories: global.RhythmCategories, habits, tasks };
}

function createHabitTemplate() {
  const template = document.createElement("template");
  const article = document.createElement("article");
  const title = document.createElement("h3");
  const streak = document.createElement("p");
  const control = document.createElement("div");
  const edit = document.createElement("button");
  const remove = document.createElement("button");
  streak.className = "habit-streak";
  control.className = "habit-control";
  edit.className = "edit-habit";
  remove.className = "delete-habit";
  article.append(title, streak, control, edit, remove);
  template.content.appendChild(article);
  return template;
}

function createDataTransfer() {
  const data = new Map();
  return {
    dropEffect: "",
    effectAllowed: "",
    getData: (type) => data.get(type) || "",
    setData: (type, value) => data.set(type, String(value)),
  };
}

module.exports = [
  {
    name: "renders archive item without innerHTML",
    fn() {
      const { archive } = loadDomModules();
      const view = archive.createArchiveView({
        createUndoSnapshot: () => ({}),
        formatLongDate: (dateKey) => `date:${dateKey}`,
        getCategory: () => ({ color: "#34d399", name: "Work" }),
        priorityLabels: { high: "High" },
        render() {},
        saveState() {},
        showToast() {},
      });
      const node = view.createArchiveNode({
        dateKey: "2026-07-02",
        task: { categoryId: "work", completed: {}, priority: "high", title: "Call doctor" },
      });

      assert.equal(node.classList.contains("archive-item"), true);
      assert.equal(node.querySelector("h3").textContent, "Call doctor");
      assert.equal(node.querySelector(".category-dot").style.values["--category-color"], "#34d399");
      assert.equal(node.querySelector(".restore-task").textContent, "Вернуть в задачи");
    },
  },
  {
    name: "renders category item without innerHTML",
    fn() {
      const { categories } = loadDomModules();
      const els = {
        archiveCategoryFilter: document.createElement("select"),
        categoryList: document.createElement("div"),
        taskCategoryFilter: document.createElement("select"),
        taskCategoryId: document.createElement("select"),
      };
      const controller = categories.createCategories({
        cleanText: (value) => String(value).trim(),
        confirmAction: async () => true,
        createUndoSnapshot: () => ({}),
        els,
        getArchiveCategoryFilter: () => "all",
        getState: () => ({ categories: [{ color: "#38bdf8", id: "work", name: "Work" }], tasks: [] }),
        getTaskCategoryFilter: () => "all",
        saveUiState() {},
        setArchiveCategoryFilter() {},
        setTaskCategoryFilter() {},
        showToast() {},
      });

      controller.renderCategories();

      const item = els.categoryList.querySelector(".category-item");
      assert.ok(item);
      assert.equal(item.textContent.includes("Work"), true);
      assert.equal(item.querySelector(".category-dot").style.values["--category-color"], "#38bdf8");
      const buttons = item.querySelectorAll("button");
      assert.equal(buttons[0].getAttribute("aria-label"), "Изменить категорию Work");
      assert.equal(buttons[1].getAttribute("aria-label"), "Удалить категорию");
    },
  },
  {
    name: "renders habit number control without innerHTML",
    fn() {
      const { habits } = loadDomModules();
      const view = habits.createHabitsView({
        createUndoSnapshot: () => ({}),
        deleteHabit() {},
        els: { habitTemplate: createHabitTemplate() },
        fillHabitForm() {},
        formatHabitRepeat: () => "daily",
        getActiveDate: () => "2026-07-02",
        habitStreak: () => 4,
        render() {},
        renderDailyPulse() {},
        renderOverview() {},
        saveState() {},
        showToast() {},
      });
      const node = view.createHabitNode({
        goal: 8,
        id: "habit-1",
        logs: { "2026-07-02": 4 },
        title: "Water",
        type: "number",
        unit: "cups",
      });

      assert.equal(node.querySelector("h3").textContent, "Water");
      assert.equal(node.querySelector("input").value, "4");
      assert.equal(node.querySelector(".progress-fill").style.values.width, "50%");
      assert.equal(node.querySelector(".habit-number-row").textContent.includes("4 / 8 cups"), true);
    },
  },
  {
    name: "clears number habit log when value is reset to zero",
    fn() {
      const { habits } = loadDomModules();
      const habit = {
        goal: 8,
        id: "habit-1",
        logs: { "2026-07-02": 4 },
        title: "Water",
        type: "number",
        unit: "cups",
      };
      const view = habits.createHabitsView({
        createUndoSnapshot: () => ({}),
        deleteHabit() {},
        els: { habitTemplate: createHabitTemplate() },
        fillHabitForm() {},
        formatHabitRepeat: () => "daily",
        getActiveDate: () => "2026-07-02",
        habitStreak: () => 0,
        render() {},
        renderDailyPulse() {},
        renderOverview() {},
        saveState() {},
        showToast() {},
      });
      const node = view.createHabitNode(habit);
      const input = node.querySelector("input");

      input.value = "0";
      input.validity = { badInput: false };
      input.dispatchEvent({ type: "input" });
      assert.equal(habit.logs["2026-07-02"], 4);
      input.dispatchEvent({ type: "change" });

      assert.equal(habit.logs["2026-07-02"], undefined);
      assert.equal(node.querySelector(".progress-fill").style.values.width, "0%");
      assert.equal(node.querySelector(".habit-number-row").textContent.includes("0 / 8 cups"), true);
    },
  },
  {
    name: "updates number habit with stepper controls",
    fn() {
      const { habits } = loadDomModules();
      const habit = {
        goal: 8,
        id: "habit-1",
        logs: { "2026-07-02": 4 },
        title: "Water",
        type: "number",
        unit: "cups",
      };
      const view = habits.createHabitsView({
        createUndoSnapshot: () => ({}),
        deleteHabit() {},
        els: { habitTemplate: createHabitTemplate() },
        fillHabitForm() {},
        formatHabitRepeat: () => "daily",
        getActiveDate: () => "2026-07-02",
        habitStreak: () => 0,
        render() {},
        renderDailyPulse() {},
        renderOverview() {},
        saveState() {},
        showToast() {},
      });
      const node = view.createHabitNode(habit);
      const [decrement, increment] = node.querySelectorAll(".habit-stepper");

      increment.dispatchEvent({ type: "click" });
      assert.equal(habit.logs["2026-07-02"], 5);
      assert.equal(node.querySelector("input").value, "5");

      decrement.dispatchEvent({ type: "click" });
      assert.equal(habit.logs["2026-07-02"], 4);
      assert.equal(node.querySelector("input").value, "4");
    },
  },
  {
    name: "reorders habits with drag and drop",
    fn() {
      const { habits } = loadDomModules();
      let reordered = [];
      let saved = false;
      let rendered = false;
      const view = habits.createHabitsView({
        createUndoSnapshot: () => ({}),
        deleteHabit() {},
        els: { habitList: document.createElement("div"), habitTemplate: createHabitTemplate() },
        fillHabitForm() {},
        formatHabitRepeat: () => "daily",
        getActiveDate: () => "2026-07-02",
        habitStreak: () => 0,
        render: () => {
          rendered = true;
        },
        renderDailyPulse() {},
        renderOverview() {},
        reorderHabit: (sourceId, targetId) => {
          reordered = [sourceId, targetId];
        },
        saveState: () => {
          saved = true;
        },
        showToast() {},
      });
      const first = view.createHabitNode({ id: "habit-1", logs: {}, title: "Water", type: "check" });
      const second = view.createHabitNode({ id: "habit-2", logs: {}, title: "Walk", type: "check" });
      const dataTransfer = createDataTransfer();

      first.dispatchEvent({ dataTransfer, type: "dragstart" });
      second.dispatchEvent({ dataTransfer, preventDefault() {}, type: "dragover" });
      second.dispatchEvent({ dataTransfer, preventDefault() {}, type: "drop" });

      assert.deepEqual(reordered, ["habit-1", "habit-2"]);
      assert.equal(saved, true);
      assert.equal(rendered, true);
    },
  },
  {
    name: "renders overdue delete action and calls delete task",
    fn() {
      const { tasks } = loadDomModules();
      const task = { categoryId: "", completed: {}, id: "task-1", priority: "high", repeat: "none", time: "09:00", title: "Missed call" };
      let deletedId = "";
      let saved = false;
      let rendered = false;
      const els = {
        overdueCounter: document.createElement("span"),
        overdueList: document.createElement("div"),
        overduePanel: document.createElement("section"),
      };
      const view = tasks.createTasksView({
        createUndoSnapshot: () => ({}),
        deleteTask: (taskId) => {
          deletedId = taskId;
        },
        els,
        formatLongDate: (dateKey) => dateKey,
        formatTaskRepeat: () => "",
        formatTime: (value) => value,
        getCategory: () => null,
        overdueTaskEntries: () => [{ dateKey: "2026-07-01", task }],
        priorityLabels: { high: "High" },
        render: () => {
          rendered = true;
        },
        saveState: () => {
          saved = true;
        },
        showToast() {},
        toDateKey: () => "2026-07-02",
      });

      view.renderOverdueTasks();
      const deleteButton = els.overdueList.querySelector(".overdue-delete");
      assert.ok(deleteButton);
      deleteButton.dispatchEvent({ type: "click" });

      assert.equal(deletedId, "task-1");
      assert.equal(saved, true);
      assert.equal(rendered, true);
    },
  },
  {
    name: "overdue delete action excludes one recurring occurrence",
    fn() {
      const { tasks } = loadDomModules();
      const task = { categoryId: "", completed: {}, id: "repeat-1", priority: "high", repeat: "daily", time: "09:00", title: "Daily check" };
      let deletedId = "";
      let excluded = null;
      const els = {
        overdueCounter: document.createElement("span"),
        overdueList: document.createElement("div"),
        overduePanel: document.createElement("section"),
      };
      const view = tasks.createTasksView({
        createUndoSnapshot: () => ({}),
        deleteTask: (taskId) => {
          deletedId = taskId;
        },
        els,
        excludeTaskDate: (excludedTask, dateKey) => {
          excluded = { dateKey, taskId: excludedTask.id };
        },
        formatLongDate: (dateKey) => dateKey,
        formatTaskRepeat: () => "daily",
        formatTime: (value) => value,
        getCategory: () => null,
        overdueTaskEntries: () => [{ dateKey: "2026-07-01", task }],
        priorityLabels: { high: "High" },
        render() {},
        saveState() {},
        showToast() {},
        toDateKey: () => "2026-07-02",
      });

      view.renderOverdueTasks();
      const deleteButton = els.overdueList.querySelector(".overdue-delete");
      assert.equal(deleteButton.textContent, "Только этот день");
      assert.equal(els.overdueList.querySelector(".overdue-delete-future").textContent, "Этот и последующие");
      deleteButton.dispatchEvent({ type: "click" });

      assert.deepEqual(excluded, { dateKey: "2026-07-01", taskId: "repeat-1" });
      assert.equal(deletedId, "");
    },
  },
  {
    name: "renders month and week calendar task chips without innerHTML",
    fn() {
      const { calendar } = loadDomModules();
      const task = { categoryId: "work", id: "task-1", priority: "high", title: "Design review" };
      let attachedDragCount = 0;
      const els = {
        monthGrid: document.createElement("div"),
        monthLabel: document.createElement("span"),
        weekBoardGrid: document.createElement("div"),
        weekBoardLabel: document.createElement("span"),
      };
      const view = calendar.createCalendarView({
        attachTaskChipDrag: () => {
          attachedDragCount += 1;
        },
        attachTaskDropZone() {},
        els,
        formatLongDate: (dateKey) => dateKey,
        formatMonthLabel: () => "July 2026",
        formatShortDate: (dateKey) => dateKey.slice(5),
        formatWeekday: () => "Пн",
        getActiveDate: () => "2026-07-02",
        getCategory: () => ({ color: "#34d399", name: "Work" }),
        getMonthCalendarDates: () => ["2026-07-02"],
        getOrderedTasksForDate: () => [task, { ...task, id: "task-2" }, { ...task, id: "task-3" }, { ...task, id: "task-4" }],
        habitsForDate: () => [],
        isTaskDone: () => false,
        openDateTasks() {},
        parseDate: (dateKey) => {
          const [year, month, day] = dateKey.split("-").map(Number);
          return new Date(year, month - 1, day);
        },
        priorityLabels: { high: "High" },
        toDateKey: () => "2026-07-02",
      });

      view.renderMonthCalendar();
      view.renderWeekBoard(["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"]);

      assert.equal(els.monthGrid.querySelector(".month-task-chip").textContent, "Design review");
      assert.equal(els.monthGrid.querySelector(".month-day-more").textContent, "+1");
      assert.equal(els.weekBoardGrid.querySelector(".week-task-chip").textContent.includes("Design review"), true);
      assert.ok(attachedDragCount >= 2);
    },
  },
];
