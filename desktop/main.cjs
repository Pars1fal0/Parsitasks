const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, session, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { createUpdateManager } = require("./update-manager.cjs");

const appRoot = path.join(__dirname, "..", "app");
const isSmokeTest = process.argv.includes("--smoke-test");
const isE2eTest = process.argv.includes("--e2e-test");
const isAutomationTest = isSmokeTest || isE2eTest;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let backgroundNoticeShown = false;
let reminderSnapshot = [];
let lastFileBackupAt = 0;
let updateManager = null;
const sentReminders = new Set();
const FILE_BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_FILE_BACKUPS = 20;
const MAX_FILE_BACKUP_BYTES = 25 * 1024 * 1024;
const MAX_REMINDERS = 5000;

if (isAutomationTest) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("in-process-gpu");
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rhythm-day-smoke-"));
  const smokeDocuments = path.join(smokeRoot, "documents");
  fs.mkdirSync(smokeDocuments, { recursive: true });
  app.setPath("userData", path.join(smokeRoot, "userData"));
  app.setPath("documents", smokeDocuments);
}

app.setAppUserModelId("local.rhythm-day.tracker");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: isAutomationTest ? 320 : 900,
    minHeight: isAutomationTest ? 600 : 640,
    show: !isSmokeTest,
    title: "Parsitasks",
    backgroundColor: "#090d10",
    icon: path.join(appRoot, "assets", "icons", "icon.svg"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!isSmokeTest) {
      mainWindow.show();
    }
  });

  if (!isAutomationTest) {
    mainWindow.on("close", (event) => {
      if (isQuitting) return;
      event.preventDefault();
      mainWindow.hide();
      showBackgroundNotice();
    });
  }

  if (isSmokeTest) {
    mainWindow.webContents.on("console-message", (event) => {
      const { level, lineNumber: line, message, sourceId } = event;
      if (!message || message.includes("Electron Security Warning")) return;
      console.error(`RENDERER_${level} ${message} ${sourceId}:${line}`);
    });
  }

  mainWindow.webContents.once("did-finish-load", async () => {
    if (!isSmokeTest) return;

    try {
      const result = await Promise.race([
        mainWindow.webContents.executeJavaScript(
      `(async () => {
        const submit = (form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        const click = (selector) => document.querySelector(selector)?.click();
        const categoryName = "Smoke Category";
        const taskTitle = "Smoke Task";
        const startsWithoutDemoData = state.tasks.length === 0 && state.habits.length === 0 && state.goals.length === 0;
        const formsStartCollapsed = ["#taskFormPanel", "#habitFormPanel", "#goalFormPanel"].every((selector) =>
          document.querySelector(selector)?.classList.contains("is-collapsed"),
        );
        state.tasks.push({
          id: "smoke-overdue-toggle",
          title: "Smoke hidden overdue",
          date: addDays(toDateKey(new Date()), -1),
          time: "",
          priority: "medium",
          repeat: "none",
          completed: {}, excludedDates: {}, notified: {},
        });
        state.tasks.push({
          id: "smoke-acknowledge-overdue",
          title: "Smoke acknowledge overdue",
          date: addDays(toDateKey(new Date()), -1),
          time: "",
          priority: "low",
          repeat: "none",
          completed: {}, acknowledgedOverdue: {}, excludedDates: {}, notified: {},
        });
        saveState({ skipBackup: true, skipRemote: true });
        render();
        const acknowledgeItem = [...document.querySelectorAll(".overdue-item")].find((item) => item.querySelector("h3")?.textContent === "Smoke acknowledge overdue");
        acknowledgeItem?.querySelector(".overdue-more-trigger")?.click();
        acknowledgeItem?.querySelector(".overdue-acknowledge")?.click();
        const acknowledgedTask = state.tasks.find((task) => task.id === "smoke-acknowledge-overdue");
        const overdueAcknowledgeWorks =
          acknowledgedTask?.acknowledgedOverdue?.[addDays(toDateKey(new Date()), -1)] === true &&
          acknowledgedTask?.completed?.[addDays(toDateKey(new Date()), -1)] !== true &&
          ![...document.querySelectorAll(".overdue-item h3")].some((item) => item.textContent === "Smoke acknowledge overdue");
        const overdueVisibleOnNextDay = [...document.querySelectorAll(".overdue-item h3")].some((item) => item.textContent === "Smoke hidden overdue");
        activeDate = addDays(activeDate, 1);
        render();
        const overdueGoneAfterNextDay = ![...document.querySelectorAll(".overdue-item h3")].some((item) => item.textContent === "Smoke hidden overdue");
        activeDate = addDays(activeDate, -1);
        render();
        activeDate = addDays(activeDate, -1);
        render();
        document.querySelector('.task-item[data-task-id="smoke-acknowledge-overdue"] .restore-overdue-task')?.click();
        const overdueRestoreWorks = acknowledgedTask?.acknowledgedOverdue?.[addDays(toDateKey(new Date()), -1)] !== true;
        activeDate = addDays(activeDate, 1);
        render();
        document.querySelector("#overdueToggle")?.click();
        const overdueHideWorks = document.querySelector("#overduePanel")?.hidden === true && overdueHidden === true;
        document.querySelector("#overdueToggle")?.click();
        document.querySelector("#overdueAcknowledgeAll")?.click();
        const overdueBulkAcknowledgeWorks = ["smoke-overdue-toggle", "smoke-acknowledge-overdue"].every((id) => {
          const task = state.tasks.find((item) => item.id === id);
          const yesterday = addDays(toDateKey(new Date()), -1);
          return task?.acknowledgedOverdue?.[yesterday] === true && task?.completed?.[yesterday] !== true;
        }) && document.querySelector("#overduePanel")?.classList.contains("is-visible") === false;
        state.tasks = state.tasks.filter((task) => !["smoke-overdue-toggle", "smoke-acknowledge-overdue"].includes(task.id));
        const viewBeforeMore = activeView;
        document.querySelector(".nav-more-summary")?.click();
        const moreMenuKeepsView = activeView === viewBeforeMore && document.querySelector("#tasksView")?.classList.contains("is-active");
        document.querySelector(".nav-more")?.removeAttribute("open");
        document.querySelector("#taskScheduleDeadline").checked = true;
        document.querySelector("#taskScheduleDeadline").dispatchEvent(new Event("change", { bubbles: true }));
        const deadlineFieldsExclusive =
          !document.querySelector("#taskDeadlineTimeField")?.hidden &&
          document.querySelector("#taskBlockTimeFields")?.hidden &&
          getComputedStyle(document.querySelector("#taskBlockTimeFields")).display === "none";

        document.querySelector("#categoryName").value = categoryName;
        document.querySelector("#categoryColor").value = "#5967d8";
        submit(document.querySelector("#categoryForm"));

        const categoryOption = [...document.querySelectorAll("#taskCategoryId option")].find((option) => option.textContent === categoryName);
        document.querySelector("#taskTitle").value = taskTitle;
        document.querySelector("#taskDate").value = document.querySelector("#activeDate").value;
        document.querySelector("#taskTime").value = "18:45";
        document.querySelector("#taskCategoryId").value = categoryOption?.value || "";
        document.querySelector("#taskPriority").value = "high";
        document.querySelector("#taskReminder").value = "30";
        document.querySelector("#taskRepeat").value = "every2days";
        submit(document.querySelector("#taskForm"));

        document.querySelector("#taskTitle").value = "Smoke Task Later";
        document.querySelector("#taskDate").value = document.querySelector("#activeDate").value;
        document.querySelector("#taskTime").value = "19:30";
        document.querySelector("#taskCategoryId").value = categoryOption?.value || "";
        document.querySelector("#taskPriority").value = "low";
        document.querySelector("#taskReminder").value = "30";
        document.querySelector("#taskRepeat").value = "none";
        submit(document.querySelector("#taskForm"));

        document.querySelector("#taskTitle").value = "Smoke Time Block";
        document.querySelector("#taskDate").value = document.querySelector("#activeDate").value;
        document.querySelector("#taskScheduleBlock").checked = true;
        document.querySelector("#taskScheduleBlock").dispatchEvent(new Event("change", { bubbles: true }));
        const blockFieldsExclusive =
          document.querySelector("#taskDeadlineTimeField")?.hidden &&
          getComputedStyle(document.querySelector("#taskDeadlineTimeField")).display === "none" &&
          !document.querySelector("#taskBlockTimeFields")?.hidden;
        document.querySelector("#taskStartTime").value = "14:00";
        document.querySelector("#taskEndTime").value = "15:30";
        document.querySelector("#taskCategoryId").value = categoryOption?.value || "";
        document.querySelector("#taskPriority").value = "medium";
        document.querySelector("#taskReminder").value = "15";
        document.querySelector("#taskRepeat").value = "none";
        submit(document.querySelector("#taskForm"));
        const timeBlockCreated = state.tasks.some(
          (task) =>
            task.title === "Smoke Time Block" &&
            task.scheduleMode === "block" &&
            task.startTime === "14:00" &&
            task.endTime === "15:30" &&
            task.time === "15:30",
        );
        const formBlockSource = state.tasks.find((task) => task.title === "Smoke Time Block");
        state.tasks.push({ ...structuredClone(formBlockSource), id: "smoke-form-block-to-none", title: "Smoke Form Block To None" });
        fillTaskForm(state.tasks.find((task) => task.id === "smoke-form-block-to-none"));
        document.querySelector("#taskScheduleNone").checked = true;
        document.querySelector("#taskScheduleNone").dispatchEvent(new Event("change", { bubbles: true }));
        const noTimeFieldsExclusive =
          document.querySelector("#taskDeadlineTimeField")?.hidden &&
          document.querySelector("#taskBlockTimeFields")?.hidden &&
          document.querySelector("#taskReminderField")?.hidden;
        submit(document.querySelector("#taskForm"));
        const formBlockToNoTimeWorks = state.tasks.some(
          (task) =>
            task.id === "smoke-form-block-to-none" &&
            task.scheduleMode === "none" &&
            task.time === "" &&
            task.startTime === "" &&
            task.endTime === "" &&
            task.reminderOffset === "none",
        );
        const repeatEditDate = document.querySelector("#activeDate").value;
        state.tasks.push({
          id: "smoke-repeat-form-edit",
          title: "Smoke recurring before edit",
          date: repeatEditDate,
          time: "09:00",
          scheduleMode: "deadline",
          categoryId: categoryOption?.value || "",
          priority: "medium",
          repeat: "daily",
          repeatUntil: "",
          customRepeat: {},
          reminderOffset: "15",
          completed: {}, acknowledgedOverdue: {}, excludedDates: {}, notified: {},
        });
        render();
        fillTaskForm(state.tasks.find((task) => task.id === "smoke-repeat-form-edit"));
        const repeatEditScopeVisible =
          document.querySelector("#taskRepeatEditScope")?.hidden === false &&
          document.querySelector("#taskDate")?.disabled === true;
        document.querySelector("#taskTitle").value = "Smoke recurring one day";
        document.querySelector('#taskRepeatEditScope input[value="occurrence"]').checked = true;
        submit(document.querySelector("#taskForm"));
        const recurringFormScopeWorks =
          repeatEditScopeVisible &&
          state.tasks.find((task) => task.id === "smoke-repeat-form-edit")?.title === "Smoke recurring before edit" &&
          state.tasks.find((task) => task.id === "smoke-repeat-form-edit")?.excludedDates?.[repeatEditDate] === true &&
          state.tasks.some((task) => task.sourceTaskId === "smoke-repeat-form-edit" && task.title === "Smoke recurring one day" && task.repeat === "none");

        const beforeOrder = [...document.querySelectorAll(".task-item")].map((item) => ({
          id: item.dataset.taskId,
          title: item.querySelector("h3")?.textContent,
        }));
        const firstTask = beforeOrder.find((item) => item.title === taskTitle);
        const secondTask = beforeOrder.find((item) => item.title === "Smoke Task Later");
        if (firstTask && secondTask) {
          reorderTask(document.querySelector("#activeDate").value, secondTask.id, firstTask.id);
          renderTasks();
        }
        const afterOrder = [...document.querySelectorAll(".task-item h3")].map((item) => item.textContent);
        const dndOrderChanged = afterOrder.indexOf("Smoke Task Later") < afterOrder.indexOf(taskTitle);

        const taskCard = [...document.querySelectorAll(".task-item")].find((item) => item.querySelector("h3")?.textContent === taskTitle);
        taskCard?.querySelector(".check-button")?.click();
        click('[data-view="archive"]');
        const archived = [...document.querySelectorAll(".archive-item h3")].some((item) => item.textContent === taskTitle);

        click('[data-view="tasks"]');
        document.querySelector("#quickTaskInput").value = "Smoke Quick завтра 10:00 #SmokeQuick !high";
        document.querySelector("#quickTaskInput").dispatchEvent(new Event("input", { bubbles: true }));
        const quickPreviewVisible =
          !document.querySelector("#quickTaskPreview")?.hidden &&
          document.querySelector("#quickTaskPreview")?.textContent.includes("Smoke Quick") &&
          document.querySelector("#quickTaskPreview")?.textContent.includes("10:00");
        submit(document.querySelector("#quickTaskForm"));
        const quickTaskCard = [...document.querySelectorAll(".task-item")].find((item) => item.querySelector("h3")?.textContent === "Smoke Quick");
        const quickTaskCreated =
          Boolean(quickTaskCard) &&
          quickTaskCard?.querySelector(".task-meta")?.textContent.includes("10:00") &&
          quickTaskCard?.querySelector(".priority-pill")?.textContent === "Высокий";
        document.querySelector("#quickTaskInput").value = "Smoke Quick Block завтра 14:00-15:30 #SmokeQuick !high";
        document.querySelector("#quickTaskInput").dispatchEvent(new Event("input", { bubbles: true }));
        const quickBlockPreviewVisible =
          !document.querySelector("#quickTaskPreview")?.hidden &&
          document.querySelector("#quickTaskPreview")?.textContent.includes("14:00-15:30");
        submit(document.querySelector("#quickTaskForm"));
        const quickBlockCreated = state.tasks.some(
          (task) => task.title === "Smoke Quick Block" && task.scheduleMode === "block" && task.startTime === "14:00" && task.endTime === "15:30",
        );
        const quickTaskId = quickTaskCard?.dataset.taskId;
        const quickSourceDate = document.querySelector("#activeDate").value;
        const quickTargetDate = addDays(quickSourceDate, 1);
        if (quickTaskId) moveTaskToDate(quickTaskId, quickSourceDate, quickTargetDate);
        const calendarDragMove =
          Boolean(quickTaskId) &&
          document.querySelector("#activeDate").value === quickTargetDate &&
          state.tasks.some((task) => task.id === quickTaskId && task.date === quickTargetDate);
        click('[data-view="overview"]');
        const hasWeekBoard =
          document.querySelectorAll(".week-board-day").length === 7 &&
          [...document.querySelectorAll(".week-task-chip span")].some((item) => item.textContent === "Smoke Quick");
        const calendarKeyboardDateBefore = state.tasks.find((task) => task.id === quickTaskId)?.date;
        document.querySelector('.month-task-chip[data-task-id="' + quickTaskId + '"]')?.dispatchEvent(
          new KeyboardEvent("keydown", { altKey: true, bubbles: true, cancelable: true, key: "ArrowRight" }),
        );
        const calendarKeyboardMove =
          Boolean(calendarKeyboardDateBefore) &&
          state.tasks.find((task) => task.id === quickTaskId)?.date === addDays(calendarKeyboardDateBefore, 1);
        const relativeQuick = parseQuickTaskInput("Smoke Relative через 2 часа #SmokeQuick !low");
        const phraseQuick = parseQuickTaskInput("Smoke Next в следующий понедельник вечером #SmokeQuick !high");
        const customRepeatTask = {
          title: "Smoke Custom Repeat",
          date: "2026-06-22",
          repeat: "custom",
          customRepeat: { type: "weekdays", weekdays: [1, 3, 5] },
        };
        const customRepeatWorks =
          taskScheduledOn(customRepeatTask, "2026-06-24") &&
          taskScheduledOn(customRepeatTask, "2026-06-26") &&
          !taskScheduledOn(customRepeatTask, "2026-06-27") &&
          window.RhythmRecurrence.repeatLabel(customRepeatTask).includes("ПН");
        const customHabit = {
          title: "Smoke Custom Habit",
          type: "check",
          repeat: "custom",
          startDate: "2026-06-22",
          customRepeat: { type: "weekdays", weekdays: [1, 3, 5] },
          logs: {},
        };
        state.habits.push(customHabit);
        const customHabitRepeatWorks =
          habitOccursOn(customHabit, "2026-06-24") &&
          habitOccursOn(customHabit, "2026-06-26") &&
          !habitOccursOn(customHabit, "2026-06-27") &&
          formatHabitRepeat(customHabit).includes("ПН");

        click('[data-view="goals"]');
        document.querySelector("#goalTitle").value = "Smoke Goal";
        document.querySelector("#goalDueDate").value = "2026-07-20";
        document.querySelector("#goalCheckpointInput").value = "Smoke checkpoint one";
        document.querySelector("#addGoalCheckpoint").click();
        document.querySelector("#goalCheckpointInput").value = "Smoke checkpoint two";
        document.querySelector("#addGoalCheckpoint").click();
        document.querySelector(".goal-checkpoint-grip")?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" }),
        );
        const goalCheckpointEditorWorks =
          [...document.querySelectorAll(".goal-checkpoint-row input")].map((input) => input.value).join("|") ===
          "Smoke checkpoint two|Smoke checkpoint one";
        submit(document.querySelector("#goalForm"));
        const smokeGoalItem = [...document.querySelectorAll(".goal-item")].find((item) => item.textContent.includes("Smoke Goal"));
        const goalCreated =
          document.body.dataset.view === "goals" &&
          state.goals.some((goal) => goal.title === "Smoke Goal" && goal.dueDate === "2026-07-20" && !("taskIds" in goal) && goal.steps?.length === 2) &&
          smokeGoalItem?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "0";
        document.querySelector(".goal-step input")?.click();
        const updatedSmokeGoalItem = [...document.querySelectorAll(".goal-item")].find((item) => item.textContent.includes("Smoke Goal"));
        const goalStepProgressWorks =
          state.goals.find((goal) => goal.title === "Smoke Goal")?.steps?.[0]?.done === true &&
          updatedSmokeGoalItem?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "50";
        document.querySelectorAll(".goal-step input")[1]?.click();
        const goalCompleteWorks =
          state.goals.some((goal) => goal.title === "Smoke Goal" && goal.status === "done") &&
          [...document.querySelectorAll(".goal-item.is-done")].some((item) => item.textContent.includes("Smoke Goal"));
        const goalCompletionAnimationWorks = document.querySelector(".goal-item.is-done.is-celebrating .goal-celebration")?.children.length === 12;

        click('[data-view="tasks"]');
        document.querySelector("#quickTaskInput").value = "Smoke Undo 2026-07-12 #SmokeQuick";
        submit(document.querySelector("#quickTaskForm"));
        const hasUndoButton = document.querySelector("#appToast button")?.textContent === "Отменить";
        const undoTaskCreated = state.tasks.some((task) => task.title === "Smoke Undo");
        document.querySelector("#appToast button")?.click();
        const undoRestored = !state.tasks.some((task) => task.title === "Smoke Undo");
        const backupBeforeImport = localStorage.getItem("rhythm-day-backup-v1");
        const importUndo = createUndoSnapshot();
        createImportSafetyBackup(importUndo);
        state.tasks.push({
          id: "smoke-import-task",
          title: "Smoke Imported",
          date: "2026-07-13",
          time: "",
          categoryId: "",
          priority: "medium",
          repeat: "none",
          reminderOffset: "none",
          completed: {},
          excludedDates: {},
          notified: {},
          createdAt: new Date().toISOString(),
        });
        saveState({ skipBackup: true });
        const safetyBackup = JSON.parse(localStorage.getItem("rhythm-day-import-safety-backup-v1") || "null");
        const importSafetyBackupCreated = Boolean(safetyBackup?.state?.tasks);
        const importBackupPreserved = localStorage.getItem("rhythm-day-backup-v1") === backupBeforeImport;
        replaceState(JSON.parse(importUndo.state));
        saveState({ skipBackup: true });
        render();
        const fileBackupResult = await window.rhythmDesktop.writeFileBackup({
          schemaVersion: 7,
          state,
        });
        const fileBackupWorks = fileBackupResult.ok || fileBackupResult.reason === "throttled";
        const fileBackupInfo = await window.rhythmDesktop.getFileBackupInfo();
        const openBackupFolderResult = await window.rhythmDesktop.openBackupFolder();
        const fileBackupUiVisible =
          Boolean(document.querySelector("#openBackupFolderButton")) &&
          !document.querySelector("#fileBackupStatus")?.hidden &&
          document.querySelector("#fileBackupStatus")?.textContent.includes("Файловый бэкап");
        const openBackupFolderWorks = openBackupFolderResult?.ok && Boolean(openBackupFolderResult.path);

        click('[data-view="timeline"]');
        const timelineVisible =
          document.body.dataset.view === "timeline" &&
          document.querySelectorAll(".timeline-hour-row").length >= 8 &&
          [...document.querySelectorAll(".timeline-task")].some((item) => item.textContent.includes("Smoke Quick"));
        const timelineSummaryWorks = document.querySelector("#timelineSummary")?.textContent.includes("по времени");
        const timelineDateBeforeBlockCheck = document.querySelector("#activeDate")?.value || activeDate;
        const blockTaskForTimeline = state.tasks.find((task) => task.title === "Smoke Time Block");
        activeDate = blockTaskForTimeline?.date || timelineDateBeforeBlockCheck;
        render();
        click('[data-view="timeline"]');
        const timelineBlockVisible =
          [...document.querySelectorAll(".timeline-task.is-time-block")].some((item) => item.textContent.includes("Smoke Time Block")) &&
          document.querySelectorAll(".timeline-task.is-time-block .timeline-resize-handle").length >= 2;
        const draggableBlockCard = [...document.querySelectorAll(".timeline-task.is-time-block")].find((item) => item.textContent.includes("Smoke Time Block"));
        const draggableBlockRect = draggableBlockCard?.getBoundingClientRect();
        if (draggableBlockCard) {
          draggableBlockCard.setPointerCapture = () => {};
          draggableBlockCard.releasePointerCapture = () => {};
        }
        draggableBlockCard?.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: draggableBlockRect?.left + 20,
          clientY: draggableBlockRect?.top + 20,
          pointerType: "mouse",
          pointerId: 41,
        }));
        window.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          clientX: draggableBlockRect?.left + 28,
          clientY: draggableBlockRect?.top + 28,
          pointerType: "mouse",
          pointerId: 41,
        }));
        const unscheduleTargetRect = document.querySelector(".timeline-unschedule-target")?.getBoundingClientRect();
        window.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          clientX: unscheduleTargetRect?.left + unscheduleTargetRect?.width / 2,
          clientY: unscheduleTargetRect?.top + unscheduleTargetRect?.height / 2,
          pointerType: "mouse",
          pointerId: 41,
        }));
        window.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true,
          clientX: unscheduleTargetRect?.left + unscheduleTargetRect?.width / 2,
          clientY: unscheduleTargetRect?.top + unscheduleTargetRect?.height / 2,
          pointerType: "mouse",
          pointerId: 41,
        }));
        const timelineDragToUnscheduledWorks =
          blockTaskForTimeline?.scheduleMode === "none" &&
          blockTaskForTimeline?.time === "" &&
          [...document.querySelectorAll('.timeline-task.is-unscheduled')].some((item) => item.textContent.includes("Smoke Time Block"));
        activeDate = timelineDateBeforeBlockCheck;
        render();
        click('[data-view="timeline"]');
        const timelineAccessibilityWorks =
          document.querySelector("#timelineSummary")?.getAttribute("aria-live") === "polite" &&
          document.querySelectorAll(".timeline-hour-slot[role='group']").length >= 8 &&
          document.querySelectorAll(".timeline-task.is-scheduled").length >= 1 &&
          document.querySelector("#timelineUnscheduledList")?.getAttribute("role") === "list" &&
          !document.querySelector(".timeline-task.is-scheduled[role='listitem']");

        document.querySelector('[data-view="overview"]').click();
        document.querySelector('[data-overview-mode="year"]').click();
        const heatmapGrid = document.querySelector("#heatmapGrid");
        const firstHeatmapCell = document.querySelector(".heatmap-cell");
        firstHeatmapCell.dispatchEvent(new Event("pointerenter"));
        const heatmapTooltip = document.querySelector(".heatmap-tooltip.is-visible");
        const heatmapHasLabels =
          document.querySelectorAll(".heatmap-months span").length >= 12 &&
          document.querySelectorAll(".heatmap-weekdays span").length === 7;
        const heatmapFits = heatmapGrid.scrollWidth <= heatmapGrid.clientWidth + 1;
        const heatmapTooltipSingle = document.querySelectorAll(".heatmap-tooltip.is-visible").length === 1;
        const heatmapTooltipHasDate = /\\d{4}-\\d{2}-\\d{2}/.test(heatmapTooltip?.textContent || "");
        const nativeHeatmapTitleAbsent = !firstHeatmapCell.hasAttribute("title");
        document.querySelector('[data-overview-mode="month"]').click();
        const hasMonthCalendar = document.querySelectorAll(".month-day").length === 42;

        document.querySelector('[data-view="settings"]').click();
        const themeSelect = document.querySelector("#themePreference");
        themeSelect.value = "light";
        themeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        const switchedLight = document.documentElement.dataset.theme === "light";
        themeSelect.value = "dark";
        themeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        const switchedDark = document.documentElement.dataset.theme === "dark";
        const themeSwitchWorks = switchedLight && switchedDark;
        const blueAccent = document.querySelector('input[name="accentPreference"][value="blue"]');
        blueAccent.checked = true;
        blueAccent.dispatchEvent(new Event("change", { bubbles: true }));
        const accentSwitchWorks =
          document.documentElement.dataset.accent === "blue" &&
          getComputedStyle(document.documentElement).getPropertyValue("--teal").trim() === "#5aa7ff";
        const firstDaySelect = document.querySelector("#firstDayOfWeek");
        firstDaySelect.value = "sunday";
        firstDaySelect.dispatchEvent(new Event("change", { bubbles: true }));
        const firstDaySettingWorks =
          document.querySelector(".month-weekdays span")?.textContent === "Вс" &&
          document.querySelector("#weekBoardLabel")?.textContent;
        const densitySelect = document.querySelector("#densityPreference");
        densitySelect.value = "compact";
        densitySelect.dispatchEvent(new Event("change", { bubbles: true }));
        const densitySettingWorks = document.documentElement.dataset.density === "compact";
        const timeFormatSelect = document.querySelector("#timeFormat");
        timeFormatSelect.value = "12";
        timeFormatSelect.dispatchEvent(new Event("change", { bubbles: true }));
        click('[data-view="timeline"]');
        const recurrenceStart = addDays(activeDate, -5);
        state.tasks.push({
          id: "smoke-recurring-time-one",
          title: "Smoke recurring one",
          date: recurrenceStart,
          time: "",
          priority: "high",
          repeat: "daily",
          completed: {}, acknowledgedOverdue: {}, excludedDates: {}, notified: {},
        });
        const oneOccurrencePromise = timelineController.setTaskTime("smoke-recurring-time-one", "10:00");
        document.querySelector("#confirmSecondary")?.click();
        await oneOccurrencePromise;
        const recurringTimelineOneOccurrenceWorks =
          state.tasks.find((task) => task.id === "smoke-recurring-time-one")?.excludedDates?.[activeDate] === true &&
          state.tasks.some((task) => task.sourceTaskId === "smoke-recurring-time-one" && task.date === activeDate && task.startTime === "10:00" && task.priority === "high");

        state.tasks.push({
          id: "smoke-recurring-time-following",
          title: "Smoke recurring following",
          date: recurrenceStart,
          time: "",
          priority: "high",
          repeat: "daily",
          completed: {}, acknowledgedOverdue: {}, excludedDates: {}, notified: {},
        });
        const followingOccurrencesPromise = timelineController.setTaskTime("smoke-recurring-time-following", "14:00");
        document.querySelector("#confirmAccept")?.click();
        await followingOccurrencesPromise;
        const recurringTimelineFollowingWorks =
          state.tasks.find((task) => task.id === "smoke-recurring-time-following")?.repeatUntil === addDays(activeDate, -1) &&
          state.tasks.some((task) => task.id !== "smoke-recurring-time-following" && task.title === "Smoke recurring following" && task.date === activeDate && task.repeat === "daily" && task.startTime === "14:00" && task.priority === "high");

        const timeFormatWorks = [...document.querySelectorAll(".timeline-task strong")].some((item) =>
          /AM|PM|дп|пп/i.test(item.textContent),
        );
        const smokeQuickTask = state.tasks.find((task) => task.title === "Smoke Quick");
        const smokeQuickTimeBefore = smokeQuickTask?.time;
        const timelineQuickActionsRemoved = document.querySelectorAll(".timeline-time-action").length === 0;
        document.querySelector('.timeline-task[data-task-id="' + smokeQuickTask?.id + '"] .timeline-task-main')?.dispatchEvent(
          new KeyboardEvent("keydown", { altKey: true, bubbles: true, cancelable: true, key: "ArrowRight" }),
        );
        const timelineKeyboardMoveWorks =
          smokeQuickTimeBefore && state.tasks.find((task) => task.id === smokeQuickTask?.id)?.time !== smokeQuickTimeBefore;
        const createSlot = document.querySelector('.timeline-hour-slot[data-hour="10"]');
        createSlot?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: createSlot.getBoundingClientRect().top + 24 }));
        const timelineSlotCreateWorks =
          document.querySelector("#taskScheduleBlock")?.checked &&
          document.querySelector("#taskStartTime")?.value === "10:15" &&
          document.querySelector("#taskEndTime")?.value === "11:15";
        const unscheduledTimelineTask = {
          id: "smoke-unscheduled-timeline",
          title: "Smoke Unscheduled Timeline",
          date: activeDate,
          time: "",
          categoryId: categoryOption?.value || "",
          priority: "medium",
          repeat: "none",
          reminderOffset: "none",
          completed: {},
          excludedDates: {},
          notified: {},
          createdAt: new Date().toISOString(),
        };
        state.tasks.push(unscheduledTimelineTask);
        saveState({ skipBackup: true });
        render();
        click('[data-view="timeline"]');
        const unscheduledTimelineCard = document.querySelector('.timeline-task.is-unscheduled[data-task-id="smoke-unscheduled-timeline"]');
        const timelineUnscheduledDragEnabled =
          unscheduledTimelineCard?.draggable === true &&
          unscheduledTimelineCard?.getAttribute("aria-grabbed") === "false";
        const dropSlot = document.querySelector('.timeline-hour-slot[data-hour="9"]');
        const transfer = new DataTransfer();
        unscheduledTimelineCard?.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        dropSlot?.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        dropSlot?.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            clientY: dropSlot.getBoundingClientRect().top + 24,
            dataTransfer: transfer,
          }),
        );
        unscheduledTimelineCard?.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        const movedUnscheduledTask = state.tasks.find((task) => task.id === "smoke-unscheduled-timeline");
        const timelineUnscheduledDropWorks =
          movedUnscheduledTask?.scheduleMode === "block" && movedUnscheduledTask.startTime === "09:15" && movedUnscheduledTask.endTime === "10:15";
        const openTimelineTaskMenu = (taskId) => {
          const card = document.querySelector('.timeline-task[data-task-id="' + taskId + '"]');
          card?.querySelector(".timeline-menu-button")?.click();
          return card;
        };
        let movedTimelineCard = openTimelineTaskMenu("smoke-unscheduled-timeline");
        const timelineMenuButtonVisible =
          Boolean(movedTimelineCard?.querySelector(".timeline-menu-button")) &&
          movedTimelineCard?.querySelector(".timeline-menu-button")?.getAttribute("aria-expanded") === "true" &&
          !movedTimelineCard?.querySelector(".timeline-task-menu")?.hidden;
        const timelineMenuUnscheduleVisible = Boolean(movedTimelineCard?.querySelector('.timeline-menu-item[data-action="unschedule"]'));
        movedTimelineCard?.querySelector('.timeline-menu-item[data-action="complete"]')?.click();
        const timelineMenuCompleteWorks =
          state.tasks.find((task) => task.id === "smoke-unscheduled-timeline")?.completed?.[activeDate] === true;
        movedTimelineCard = openTimelineTaskMenu("smoke-unscheduled-timeline");
        movedTimelineCard?.querySelector('.timeline-menu-item[data-action="duplicate"]')?.click();
        const timelineMenuDuplicateWorks = state.tasks.some(
          (task) => task.title === "Smoke Unscheduled Timeline копия" && task.id !== "smoke-unscheduled-timeline",
        );
        movedTimelineCard = openTimelineTaskMenu("smoke-unscheduled-timeline");
        movedTimelineCard?.querySelector('.timeline-menu-item[data-action="details"]')?.click();
        const timelineMenuDetailsWorks =
          document.querySelector("#taskId")?.value === "smoke-unscheduled-timeline" &&
          document.querySelector("#taskTitle")?.value === "Smoke Unscheduled Timeline";
        document.querySelector("#closeTaskForm")?.click();
        movedTimelineCard = openTimelineTaskMenu("smoke-unscheduled-timeline");
        movedTimelineCard?.querySelector('.timeline-menu-item[data-action="unschedule"]')?.click();
        const timelineMenuUnscheduleWorks =
          state.tasks.find((task) => task.id === "smoke-unscheduled-timeline")?.time === "" &&
          Boolean(document.querySelector('.timeline-task.is-unscheduled[data-task-id="smoke-unscheduled-timeline"]'));
        movedTimelineCard = openTimelineTaskMenu("smoke-unscheduled-timeline");
        movedTimelineCard?.querySelector('.timeline-menu-item[data-action="delete"]')?.click();
        const timelineDeleteWorks = !state.tasks.some((task) => task.id === "smoke-unscheduled-timeline");
        const timelineDropZonesWork = document.querySelectorAll(".timeline-hour-slot[data-hour]").length >= 8;
        const backupScheduleSelect = document.querySelector("#backupSchedule");
        document.querySelector('[data-view="settings"]').click();
        backupScheduleSelect.value = "15";
        backupScheduleSelect.dispatchEvent(new Event("change", { bubbles: true }));
        const backupSettingWorks = backupScheduleSelect.value === "15";
        const settingsBackupStatusWorks = document.querySelector("#settingsBackupStatus")?.textContent.includes("следующий");
        const notificationSelect = document.querySelector("#notificationSetting");
        notificationSelect.value = "off";
        notificationSelect.dispatchEvent(new Event("change", { bubbles: true }));
        const notificationSettingWorks =
          notificationSelect.value === "off" && document.querySelector("#notifyButton")?.textContent.includes("паузе");
        document.querySelector("#settingsResetButton").click();
        const confirmInitialFocusWorks = document.activeElement?.id === "confirmAccept";
        document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" }));
        const confirmTabWrapWorks = document.activeElement?.id === "confirmCancel";
        document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab", shiftKey: true }));
        const confirmShiftTabWrapWorks = document.activeElement?.id === "confirmAccept";
        const confirmModalWorks =
          !document.querySelector("#confirmModal")?.hidden && document.querySelector("#confirmTitle")?.textContent.includes("Сбросить");
        document.querySelector("#confirmAccept").click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const interfaceResetWorks =
          document.documentElement.dataset.theme === "dark" &&
          document.documentElement.dataset.density === "comfortable" &&
          document.querySelector("#timeFormat")?.value === "24" &&
          document.querySelector("#firstDayOfWeek")?.value === "monday";
        const settingsPayload = {
          settings: {
            backupSchedule: "0",
            densityPreference: "compact",
            firstDayOfWeek: "sunday",
            notificationSetting: "on",
            themePreference: "dark",
            timeFormat: "12",
          },
        };
        const settingsTransfer = new DataTransfer();
        settingsTransfer.items.add(new File([JSON.stringify(settingsPayload)], "settings.json", { type: "application/json" }));
        const settingsImportFile = document.querySelector("#settingsImportFile");
        settingsImportFile.files = settingsTransfer.files;
        settingsImportFile.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        const settingsImportWorks =
          document.querySelector("#backupSchedule")?.value === "0" &&
          document.querySelector("#densityPreference")?.value === "compact" &&
          document.querySelector("#notificationSetting")?.value === "on";

        document.querySelector('[data-view="habits"]').click();
        document.querySelector("#openHabitForm").click();
        const habitFormRect = document.querySelector("#habitFormPanel").getBoundingClientRect();
        const habitFormControlsFit = [...document.querySelectorAll("#habitFormPanel select, #habitFormPanel input")]
          .filter((control) => control.type !== "hidden" && control.offsetParent !== null)
          .every((control) => {
            const rect = control.getBoundingClientRect();
            return rect.left >= habitFormRect.left - 1 && rect.right <= habitFormRect.right + 1 && rect.right <= window.innerWidth;
          });
        const habitFormFits = habitFormRect.left >= 0 && habitFormRect.right <= window.innerWidth && habitFormControlsFit;

        document.querySelector("#closeHabitForm")?.click();
        click('[data-view="board"]');
        await new Promise((resolve) => setTimeout(resolve, 30));
        document.querySelector("#boardAddText")?.click();
        await new Promise((resolve) => setTimeout(resolve, 30));
        const boardCreatedId = state.boardItems.at(-1)?.id;
        const boardText = document.querySelector(".board-text-content");
        if (boardText) {
          boardText.focus();
          boardText.textContent = "Smoke board note";
          boardText.dispatchEvent(new Event("input", { bubbles: true }));
          window.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true
          }));
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
        const boardTextWorks =
          Boolean(boardCreatedId) &&
          state.boardItems.some((item) => item.id === boardCreatedId && item.type === "text") &&
          Boolean(document.querySelector('.board-item[data-id="' + boardCreatedId + '"]'));
        const boardCreatedNode = document.querySelector('.board-item[data-id="' + boardCreatedId + '"]');
        boardCreatedNode?.blur();
        boardCreatedNode?.focus();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
        const boardDeleteWorks = state.boardItems.every((item) => item.id !== boardCreatedId);
        document.querySelector("#boardUndo")?.click();
        const boardUndoWorks = state.boardItems.some((item) => item.id === boardCreatedId);

        window.resizeTo(390, 844);
        await new Promise((resolve) => setTimeout(resolve, 80));
        click('[data-view="tasks"]');
        const mobileTaskPanel = document.querySelector("#tasksView .main-panel")?.getBoundingClientRect();
        const mobileTaskRailNode = document.querySelector("#tasksView .right-rail");
        const mobileTaskRail = mobileTaskRailNode?.getBoundingClientRect();
        const mobileTaskListComesFirst =
          window.innerWidth <= 400 &&
          (getComputedStyle(mobileTaskRailNode).display === "none" || mobileTaskPanel?.top < mobileTaskRail?.top) &&
          getComputedStyle(document.querySelector(".focus-board")).display === "none";
        const mobileNavColumns = getComputedStyle(document.querySelector(".nav-tabs")).gridTemplateColumns.split(" ").filter(Boolean).length;
        const mobileNavigationFits = mobileNavColumns === 5;
        click('[data-view="overview"]');
        await new Promise((resolve) => setTimeout(resolve, 30));
        click('[data-overview-mode="year"]');
        await new Promise((resolve) => setTimeout(resolve, 30));
        const mobileHeatmapGrid = document.querySelector("#heatmapGrid");
        const mobileHeatmapCell = document.querySelector(".heatmap-cell");
        const mobileHeatmapSplit =
          mobileHeatmapGrid?.classList.contains("is-split") &&
          document.querySelectorAll(".heatmap-half").length === 2 &&
          mobileHeatmapCell?.getBoundingClientRect().width >= 7 &&
          mobileHeatmapGrid.scrollWidth <= mobileHeatmapGrid.clientWidth + 1;

        return {
          accentSwitchWorks,
          title: document.title,
          hasTaskForm: Boolean(document.querySelector("#taskForm")),
          hasHabitList: Boolean(document.querySelector("#habitList")),
          hasGoals: Boolean(document.querySelector("#goalsView")) && Boolean(document.querySelector("#goalForm")),
          hasJournal: Boolean(document.querySelector("#journalView")) && Boolean(document.querySelector("#journalText")),
          hasNutrition: Boolean(document.querySelector("#nutritionView")) && Boolean(document.querySelector("#nutritionWeekBoard")),
          hasBoard:
            Boolean(document.querySelector("#boardView")) &&
            Boolean(document.querySelector("#boardViewport")) &&
            Boolean(document.querySelector("#boardAddText")) &&
            Boolean(document.querySelector("#boardAddImage")),
          boardTextWorks,
          boardDeleteWorks,
          boardUndoWorks,
          hasGlobalSearch: Boolean(document.querySelector("#globalSearchDialog")),
          hasArchive: Boolean(document.querySelector("#archiveView")),
          hasHeatmap:
            document.querySelectorAll(".heatmap-cell").length === 365 &&
            Boolean(document.querySelector(".heatmap-cell[data-tooltip]")),
          hasSettings: Boolean(document.querySelector("#settingsView")) && Boolean(document.querySelector("#themePreference")),
          hasRemoteSyncSettings:
            Boolean(document.querySelector("#remoteSyncEnabled")) &&
            Boolean(document.querySelector("#remoteSyncUrl")) &&
            Boolean(document.querySelector("#remoteSyncPushButton")) &&
            Boolean(document.querySelector("#remoteSyncPullButton")),
          hasMonthCalendar,
          hasWeekBoard,
          hasTodayButton: Boolean(document.querySelector("#todayButton")),
          hasOverdueToggle: Boolean(document.querySelector("#overdueToggle")),
          hasQuickInput: Boolean(document.querySelector("#quickTaskInput")),
          hasCategories: document.querySelectorAll(".category-item").length >= 1,
          hasJsonActions: Boolean(document.querySelector("#exportButton")) && Boolean(document.querySelector("#importFile")),
          modulesLoaded: Boolean(
            window.RhythmQuickInput &&
              window.RhythmAppEvents &&
              window.RhythmArchiveView &&
              window.RhythmBoardAssets &&
              window.RhythmBoardModel &&
              window.RhythmBoardView &&
              window.RhythmCalendarDragController &&
              window.RhythmCalendarView &&
              window.RhythmCategories &&
              window.RhythmConfirmDialog &&
              window.RhythmDeviceSyncController &&
              window.RhythmFormDialog &&
              window.RhythmGlobalSearch &&
              window.RhythmGoalCheckpointEditor &&
              window.RhythmGoalsView &&
              window.RhythmHabitForm &&
              window.RhythmHabitsView &&
              window.RhythmHeatmapView &&
              window.RhythmImportExport &&
              window.RhythmJournalModel &&
               window.RhythmJournalView &&
               window.RhythmNutritionModel &&
               window.RhythmNutritionController &&
               window.RhythmNutritionView &&
              window.RhythmNotifications &&
              window.RhythmRecurrence &&
              window.RhythmRemoteSync &&
              window.RhythmRemoteSyncController &&
              window.RhythmStateNormalizer &&
              window.RhythmStateMerge &&
              window.RhythmStorage &&
              window.RhythmTaskState &&
              window.RhythmTaskSchedule &&
              window.RhythmTaskForm &&
              window.RhythmTasksView &&
              window.RhythmTaskMoves &&
              window.RhythmOverdueController &&
              window.RhythmTimelineController &&
              window.RhythmTimelineView &&
              window.RhythmSettingsController &&
              window.RhythmViewRenderer &&
              window.RhythmDateRollover &&
              window.RhythmToast,
          ),
          desktopBridge: Boolean(
            window.rhythmDesktop?.syncReminders
              && window.rhythmDesktop?.writeFileBackup
              && window.rhythmDesktop?.getUpdateStatus
              && window.rhythmDesktop?.checkForUpdates
          ),
          desktopUpdatesWork:
            Boolean(window.RhythmDesktopUpdateController)
            && Boolean(document.querySelector("#desktopUpdatePanel"))
            && !document.querySelector("#desktopUpdatePanel").hidden,
          startsWithoutDemoData,
          formsStartCollapsed,
          overdueHideWorks,
          overdueAcknowledgeWorks,
          overdueBulkAcknowledgeWorks,
          overdueRestoreWorks,
          overdueVisibleOnlyNextDay: overdueVisibleOnNextDay && overdueGoneAfterNextDay,
          moreMenuKeepsView,
          scheduleFieldsExclusive: deadlineFieldsExclusive && blockFieldsExclusive && noTimeFieldsExclusive,
          formBlockToNoTimeWorks,
          taskCreated: Boolean(taskCard),
          timeBlockCreated,
          quickTaskCreated,
          quickBlockCreated,
          quickBlockPreviewVisible,
          quickPreviewVisible,
          smartQuickRelative: relativeQuick.title === "Smoke Relative" && Boolean(relativeQuick.time) && relativeQuick.priority === "low",
          smartQuickPhrase: phraseQuick.title === "Smoke Next" && phraseQuick.time === "18:00" && phraseQuick.priority === "high",
          customRepeatWorks,
          customHabitRepeatWorks,
          goalCreated,
          goalCheckpointEditorWorks,
          goalStepProgressWorks,
          goalCompleteWorks,
          goalCompletionAnimationWorks,
          hasUndoButton,
          undoTaskCreated,
          undoRestored,
          importSafetyBackupCreated,
          importBackupPreserved,
          fileBackupWorks,
          fileBackupInfoWorks: Boolean(fileBackupInfo?.path),
          fileBackupUiVisible,
          openBackupFolderWorks,
          backupSettingWorks,
          calendarKeyboardMove,
          confirmFocusTrapWorks: confirmInitialFocusWorks && confirmTabWrapWorks && confirmShiftTabWrapWorks,
          confirmModalWorks,
          densitySettingWorks,
          firstDaySettingWorks: Boolean(firstDaySettingWorks),
          heatmapFits,
          heatmapHasLabels,
          heatmapTooltipHasDate,
          heatmapTooltipSingle,
          habitFormFits,
          mobileTaskListComesFirst: Boolean(mobileTaskListComesFirst),
          mobileNavigationFits,
          mobileHeatmapSplit: Boolean(mobileHeatmapSplit),
          nativeHeatmapTitleAbsent,
          notificationSettingWorks,
          interfaceResetWorks,
          settingsBackupStatusWorks,
          settingsImportWorks,
          themeSwitchWorks,
          timeFormatWorks,
          timelineDropZonesWork,
          timelineAccessibilityWorks,
          timelineKeyboardMoveWorks,
          recurringTimelineOneOccurrenceWorks,
          recurringTimelineFollowingWorks,
          recurringFormScopeWorks,
          timelineQuickActionsRemoved,
          timelineMenuButtonVisible,
          timelineMenuUnscheduleVisible,
          timelineMenuUnscheduleWorks,
          timelineMenuCompleteWorks,
          timelineMenuDuplicateWorks,
          timelineMenuDetailsWorks,
          timelineDeleteWorks,
          timelineSlotCreateWorks,
          timelineUnscheduledDragEnabled,
          timelineUnscheduledDropWorks,
          timelineSummaryWorks,
          timelineVisible,
          timelineBlockVisible,
          timelineDragToUnscheduledWorks,
          calendarDragMove,
          dndOrderChanged,
          archived,
        };
        })()`,
        ),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Smoke script timed out")), 45000);
        }),
      ]);
      const failedChecks = Object.entries(result).filter(([key, value]) => key !== "title" && value !== true);
      if (failedChecks.length) {
        console.error(`SMOKE_FAIL ${JSON.stringify(failedChecks)}`);
        app.exit(1);
        return;
      }
      console.log(`SMOKE_OK ${JSON.stringify(result)}`);
      app.quit();
    } catch (error) {
      console.error(`SMOKE_FAIL ${error?.stack || error}`);
      app.exit(1);
    }
  });

  mainWindow.webContents.once("did-fail-load", (_event, code, description) => {
    if (!isSmokeTest) return;

    console.error(`SMOKE_FAIL ${code} ${description}`);
    app.exit(1);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === mainWindow.webContents.getURL() || isInternalAppNavigation(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) shell.openExternal(url).catch(() => {});
  });

  mainWindow.loadFile(
    path.join(appRoot, "index.html"),
    isAutomationTest ? { query: { automation: "1" } } : undefined,
  );
}

function isInternalAppNavigation(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") return false;
    const target = path.resolve(fileURLToPath(parsed));
    const relative = path.relative(appRoot, target).replaceAll("\\", "/");
    return ["auth.html", "index.html", "landing.html"].includes(relative);
  } catch {
    return false;
  }
}

function createTray() {
  if (isAutomationTest || tray) return;

  const image = nativeImage.createFromPath(path.join(appRoot, "assets", "icons", "icon.svg"));
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip("Parsitasks");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Открыть Parsitasks",
        click: showMainWindow,
      },
      {
        label: "Проверить напоминания",
        click: checkReminders,
      },
      { type: "separator" },
      {
        label: "Выйти",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showMainWindow);
}

function showMainWindow() {
  if (!mainWindow) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function showBackgroundNotice() {
  if (backgroundNoticeShown || !Notification.isSupported()) return;
  backgroundNoticeShown = true;
  new Notification({
    title: "Parsitasks работает в фоне",
    body: "Окно закрыто, но напоминания останутся активными через трей.",
    silent: true,
  }).show();
}

function createMenu() {
  const template = [
    {
      label: "Файл",
      submenu: [
        {
          label: "Скрыть в трей",
          click: () => mainWindow?.hide(),
        },
        {
          label: "Выйти",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: "Вид",
      submenu: [
        {
          label: "Обновить",
          role: "reload",
        },
        {
          label: "Масштаб +",
          role: "zoomIn",
        },
        {
          label: "Масштаб -",
          role: "zoomOut",
        },
        {
          label: "Сбросить масштаб",
          role: "resetZoom",
        },
      ],
    },
    {
      label: "Окно",
      submenu: [
        {
          label: "Свернуть",
          role: "minimize",
        },
        {
          label: "Показать",
          click: showMainWindow,
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.on("reminders:sync", (event, payload) => {
    if (!isTrustedIpcEvent(event)) return;
    reminderSnapshot = normalizeReminderSnapshot(payload);
    checkReminders();
  });

  ipcMain.handle("reminders:test", (event) => {
    if (!isTrustedIpcEvent(event)) return { ok: false, reason: "untrusted-sender" };
    showNotification({
      id: `test-${Date.now()}`,
      title: "Напоминания активны",
      body: "Parsitasks сможет напоминать о задачах, пока приложение работает в фоне.",
    });
    return true;
  });

  ipcMain.handle("backups:write-file", async (event, payload) => {
    if (!isTrustedIpcEvent(event)) return { ok: false, reason: "untrusted-sender" };
    return writeFileBackup(payload);
  });

  ipcMain.handle("backups:info", async (event) => {
    if (!isTrustedIpcEvent(event)) return { ok: false, reason: "untrusted-sender" };
    return getFileBackupInfo();
  });

  ipcMain.handle("backups:open-folder", async (event) => {
    if (!isTrustedIpcEvent(event)) return { ok: false, reason: "untrusted-sender" };
    const info = await getFileBackupInfo();
    const backupDir = info.latest?.path ? path.dirname(info.latest.path) : getFileBackupDir();
    await fs.promises.mkdir(backupDir, { recursive: true });
    if (isSmokeTest) return { ok: true, path: backupDir, smoke: true };
    const error = await shell.openPath(backupDir);
    if (!error) return { ok: true, path: backupDir };
    try {
      shell.showItemInFolder(backupDir);
      return { ok: true, path: backupDir, fallback: "showItemInFolder", error };
    } catch {
      return { ok: false, path: backupDir, error };
    }
  });
}

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["github.com", "parsitasks.ru", "www.parsitasks.ru"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isTrustedIpcEvent(event) {
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && event?.sender === mainWindow.webContents
    && event?.senderFrame === mainWindow.webContents.mainFrame
  );
}

function configureSessionSecurity() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

function normalizeReminderSnapshot(payload) {
  if (!Array.isArray(payload?.reminders)) return [];
  return payload.reminders.slice(0, MAX_REMINDERS).flatMap((reminder) => {
    const id = String(reminder?.id || "").slice(0, 240);
    const title = String(reminder?.title || "").slice(0, 240);
    const reminderAt = String(reminder?.reminderAt || "");
    const dueAt = String(reminder?.dueAt || "");
    if (!id || !title || !Number.isFinite(Date.parse(reminderAt)) || !Number.isFinite(Date.parse(dueAt))) return [];
    return [{
      id,
      title,
      category: String(reminder?.category || "").slice(0, 120),
      reminderAt,
      dueAt,
    }];
  });
}

async function writeFileBackup(payload) {
  const now = Date.now();
  if (now - lastFileBackupAt < FILE_BACKUP_INTERVAL_MS) {
    return { ok: false, reason: "throttled" };
  }

  if (!payload?.state || typeof payload.state !== "object") {
    return { ok: false, reason: "invalid-payload" };
  }

  const backup = {
    app: "Parsitasks",
    schemaVersion: payload.schemaVersion || 1,
    exportedAt: new Date(now).toISOString(),
    state: payload.state,
  };

  let serialized;
  try {
    serialized = JSON.stringify(backup, null, 2);
  } catch {
    return { ok: false, reason: "invalid-payload" };
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_FILE_BACKUP_BYTES) {
    return { ok: false, reason: "payload-too-large" };
  }

  const backupDir = getFileBackupDir();
  const fileName = `parsitasks-${new Date(now).toISOString().replace(/[:.]/g, "-")}.json`;
  const filePath = path.join(backupDir, fileName);

  await fs.promises.mkdir(backupDir, { recursive: true });
  await fs.promises.writeFile(filePath, serialized, "utf8");
  lastFileBackupAt = now;
  await pruneFileBackups(backupDir);

  return { ok: true, path: filePath };
}

function getFileBackupDir() {
  return path.join(app.getPath("documents"), "Parsitasks", "backups");
}

function getLegacyFileBackupDir() {
  return path.join(app.getPath("documents"), "Ритм дня", "backups");
}

async function getFileBackupInfo() {
  const backupDir = getFileBackupDir();
  const backupDirs = [...new Set([backupDir, getLegacyFileBackupDir()])];
  const backups = (await Promise.all(backupDirs.map(async (directory) => {
    try {
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      return Promise.all(
        entries
          .filter((entry) => entry.isFile() && /^(?:ritm-dnya|parsitasks)-.*\.json$/i.test(entry.name))
          .map(async (entry) => {
            const filePath = path.join(directory, entry.name);
            const stat = await fs.promises.stat(filePath);
            return { name: entry.name, path: filePath, mtimeMs: stat.mtimeMs };
          }),
      );
    } catch {
      return [];
    }
  }))).flat();
  const latest = backups.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
  return { ok: true, path: latest?.path ? path.dirname(latest.path) : backupDir, latest };
}

async function pruneFileBackups(backupDir) {
  const entries = await fs.promises.readdir(backupDir, { withFileTypes: true });
  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^(?:ritm-dnya|parsitasks)-.*\.json$/i.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(backupDir, entry.name);
        const stat = await fs.promises.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      }),
  );

  backups
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(MAX_FILE_BACKUPS)
    .forEach((backup) => {
      fs.promises.unlink(backup.filePath).catch(() => {});
    });
}

function checkReminders() {
  if (!Notification.isSupported()) return;

  const now = Date.now();
  reminderSnapshot.forEach((reminder) => {
    const reminderAt = Date.parse(reminder.reminderAt);
    const dueAt = Date.parse(reminder.dueAt);
    if (!Number.isFinite(reminderAt) || !Number.isFinite(dueAt)) return;
    if (reminderAt > now || dueAt < now - 86400000) return;
    if (sentReminders.has(reminder.id)) return;

    sentReminders.add(reminder.id);
    showNotification({
      id: reminder.id,
      title: reminder.title,
      body: reminderBody(reminder),
    });
  });
}

function reminderBody(reminder) {
  const due = new Date(reminder.dueAt);
  const time = due.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const parts = [`до ${time}`];
  if (reminder.category) parts.push(reminder.category);
  return parts.join(" · ");
}

function showNotification({ title, body }) {
  const notification = new Notification({ title, body });
  notification.on("click", showMainWindow);
  notification.show();
}

app.whenReady().then(() => {
  configureSessionSecurity();
  updateManager = createUpdateManager({
    app,
    ipcMain,
    shell,
    getMainWindow: () => mainWindow,
    isAutomationTest,
    validateSender: isTrustedIpcEvent,
  });
  updateManager.registerIpc();
  registerIpc();
  createMenu();
  createTray();
  createWindow();
  updateManager.start();
  setInterval(checkReminders, 15000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  updateManager?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  if (isQuitting || isAutomationTest) {
    app.quit();
  }
});
