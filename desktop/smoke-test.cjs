// Desktop smoke check (npm run desktop:smoke): drives the real window through the main
// user flows and exits with SMOKE_OK or SMOKE_FAIL.
function attachSmokeTest(app, mainWindow) {
  mainWindow.webContents.on("console-message", (event) => {
    const { level, lineNumber: line, message, sourceId } = event;
    if (!message || message.includes("Electron Security Warning")) return;
    console.error(`RENDERER_${level} ${message} ${sourceId}:${line}`);
  });

  mainWindow.webContents.once("did-finish-load", async () => {
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
        tasksView.setPane("backlog");
        const acknowledgeItem = [...document.querySelectorAll(".historical-task-item")].find((item) => item.querySelector("strong")?.textContent === "Smoke acknowledge overdue");
        [...(acknowledgeItem?.querySelectorAll("button") || [])].find((button) => button.textContent === "Не выполнять")?.click();
        const acknowledgedTask = state.tasks.find((task) => task.id === "smoke-acknowledge-overdue");
        const overdueAcknowledgeWorks =
          acknowledgedTask?.acknowledgedOverdue?.[addDays(toDateKey(new Date()), -1)] === true &&
          acknowledgedTask?.completed?.[addDays(toDateKey(new Date()), -1)] !== true &&
          ![...document.querySelectorAll(".historical-task-item strong")].some((item) => item.textContent === "Smoke acknowledge overdue");
        const overdueVisibleOnNextDay = [...document.querySelectorAll(".historical-task-item strong")].some((item) => item.textContent === "Smoke hidden overdue");
        activeDate = addDays(activeDate, 1);
        render();
        const backlogStaysAfterNextDay = [...document.querySelectorAll(".historical-task-item strong")].some((item) => item.textContent === "Smoke hidden overdue");
        activeDate = addDays(activeDate, -1);
        tasksView.setPane("day");
        render();
        activeDate = addDays(activeDate, -1);
        render();
        document.querySelector('.task-item[data-task-id="smoke-acknowledge-overdue"] .restore-overdue-task')?.click();
        const overdueRestoreWorks = acknowledgedTask?.acknowledgedOverdue?.[addDays(toDateKey(new Date()), -1)] !== true;
        activeDate = addDays(activeDate, 1);
        render();
        const overdueHideWorks = document.querySelector("#historicalTaskPanel")?.hidden === true;
        tasksView.setPane("backlog");
        click("#taskSelectMode"); click("#taskSelectAll"); click("#taskBulkDismiss"); click("#confirmAccept");
        await new Promise((resolve) => setTimeout(resolve, 0));
        const overdueBulkAcknowledgeWorks = ["smoke-overdue-toggle", "smoke-acknowledge-overdue"].every((id) => {
          const task = state.tasks.find((item) => item.id === id);
          const yesterday = addDays(toDateKey(new Date()), -1);
          return task?.acknowledgedOverdue?.[yesterday] === true && task?.completed?.[yesterday] !== true;
        }) && document.querySelector("#historicalTaskPanel")?.hidden === true;
        tasksView.setPane("day");
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
        await fillTaskForm(state.tasks.find((task) => task.id === "smoke-form-block-to-none"));
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
        await fillTaskForm(state.tasks.find((task) => task.id === "smoke-repeat-form-edit"));
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
        const quickViewedDate = activeDate;
        await saveQuickTask(new Event("submit", { cancelable: true }));
        const quickDatePreserved = activeDate === quickViewedDate;
        const createdQuickTask = state.tasks.find((task) => task.title === "Smoke Quick");
        activeDate = createdQuickTask?.date || quickViewedDate;
        render();
        const quickTaskCard = [...document.querySelectorAll(".task-item")].find((item) => item.querySelector("h3")?.textContent === "Smoke Quick");
        const quickTaskCreated =
          quickDatePreserved &&
          Boolean(quickTaskCard) &&
          quickTaskCard?.querySelector(".task-meta")?.textContent.includes("10:00") &&
          quickTaskCard?.querySelector(".priority-pill")?.textContent === "Высокий";
        document.querySelector("#quickTaskInput").value = "Smoke Quick Block завтра 14:00-15:30 #SmokeQuick !high";
        document.querySelector("#quickTaskInput").dispatchEvent(new Event("input", { bubbles: true }));
        const quickBlockPreviewVisible =
          !document.querySelector("#quickTaskPreview")?.hidden &&
          document.querySelector("#quickTaskPreview")?.textContent.includes("14:00-15:30");
        await saveQuickTask(new Event("submit", { cancelable: true }));
        const quickBlockCreated = state.tasks.some(
          (task) => task.title === "Smoke Quick Block" && task.scheduleMode === "block" && task.startTime === "14:00" && task.endTime === "15:30",
        );
        const quickTaskId = quickTaskCard?.dataset.taskId;
        const quickSourceDate = document.querySelector("#activeDate").value;
        const quickTargetDate = addDays(quickSourceDate, 1);
        if (quickTaskId) await moveTaskToDate(quickTaskId, quickSourceDate, quickTargetDate);
        const calendarDragMove =
          Boolean(quickTaskId) &&
          document.querySelector("#activeDate").value === quickSourceDate &&
          state.tasks.some((task) => task.id === quickTaskId && task.date === quickTargetDate);
        // The moved task can now belong to the next week or month.
        activeDate = quickTargetDate;
        click('[data-view="overview"]');
        const hasWeekBoard =
          document.querySelectorAll(".week-board-day").length === 7 &&
          [...document.querySelectorAll(".week-task-chip span")].some((item) => item.textContent === "Smoke Quick");
        const calendarKeyboardDateBefore = state.tasks.find((task) => task.id === quickTaskId)?.date;
        document.querySelector('.month-task-chip[data-task-id="' + quickTaskId + '"]')?.dispatchEvent(
          new KeyboardEvent("keydown", { altKey: true, bubbles: true, cancelable: true, key: "ArrowRight" }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
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
        const completedHiddenFromActive = ![...document.querySelectorAll(".goal-item")].some((item) => item.textContent.includes("Smoke Goal"));
        document.querySelector("#goalFilter").value = "done";
        document.querySelector("#goalFilter").dispatchEvent(new Event("change", { bubbles: true }));
        const goalCompleteWorks =
          completedHiddenFromActive &&
          state.goals.some((goal) => goal.title === "Smoke Goal" && goal.status === "done") &&
          [...document.querySelectorAll(".goal-item.is-done")].some((item) => item.textContent.includes("Smoke Goal"));
        const goalCompletionAnimationWorks = document.querySelector(".goal-item.is-done.is-celebrating .goal-celebration")?.children.length === 12;

        click('[data-view="tasks"]');
        document.querySelector("#quickTaskInput").value = "Smoke Undo 2026-07-12 #SmokeQuick";
        await saveQuickTask(new Event("submit", { cancelable: true }));
        const undoButton = [...document.querySelectorAll("#appToast button")].find((button) => button.textContent === "Отменить");
        const hasUndoButton = Boolean(undoButton);
        const undoTaskCreated = state.tasks.some((task) => task.title === "Smoke Undo");
        undoButton?.click();
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
          document.querySelector("#fileBackupStatus")?.textContent.includes("Файловая копия");
        const openBackupFolderWorks = openBackupFolderResult?.ok && Boolean(openBackupFolderResult.path);

        activeDate = state.tasks.find((task) => task.id === quickTaskId)?.date || activeDate;
        render();
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
        click('[data-heatmap-range="year"]');
        const heatmapGrid = document.querySelector("#heatmapGrid");
        const firstHeatmapCell = document.querySelector(".heatmap-cell");
        firstHeatmapCell.dispatchEvent(new Event("pointerenter"));
        const heatmapTooltip = document.querySelector(".heatmap-tooltip.is-visible");
        const heatmapHasLabels =
          document.querySelectorAll(".heatmap-months span").length >= 10 &&
          [...document.querySelectorAll(".heatmap-months span")].every((node) => node.textContent.length === 3) &&
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
        activeDate = smokeQuickTask.date;
        render();
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
        resetTaskForm({ open: false });
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
        await Promise.resolve();
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
        const settingsBackupStatusWorks = document.querySelector("#settingsBackupStatus")?.textContent.includes("следующая");
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
        const settingsImportDeadline = performance.now() + 5000;
        while (settingsImportFile.files.length && performance.now() < settingsImportDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
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
        window.smokeMobileLayout = { width: innerWidth, panel: mobileTaskPanel?.toJSON(), rail: mobileTaskRail?.toJSON(), railDisplay: getComputedStyle(mobileTaskRailNode).display, formCollapsed: els.taskFormPanel.classList.contains("is-collapsed") };
        const mobileNavColumns = getComputedStyle(document.querySelector(".nav-tabs")).gridTemplateColumns.split(" ").filter(Boolean).length;
        const expectedNavColumns = navigationPreferences.mobile.filter((view) => view !== "timeline").length + (document.querySelector(".nav-more").hidden ? 0 : 1);
        const mobileNavigationFits = mobileNavColumns === expectedNavColumns && document.documentElement.scrollWidth <= innerWidth + 1;
        click('[data-view="overview"]');
        await new Promise((resolve) => setTimeout(resolve, 30));
        click('[data-overview-mode="year"]');
        await new Promise((resolve) => setTimeout(resolve, 30));
        click('[data-heatmap-range="year"]');
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
          modulesLoaded: typeof window.render === "function" && Boolean(window.RhythmRecurrence && window.RhythmStateMerge),
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
          backlogIndependentOfBrowsedDate: overdueVisibleOnNextDay && backlogStaysAfterNextDay,
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
        const context = await mainWindow.webContents.executeJavaScript(`({
          activeView, activeDate,
          mobileLayout: window.smokeMobileLayout,
          taskTitles: state.tasks.map((task) => ({ title: task.title, date: task.date, scheduleMode: task.scheduleMode })),
          visibleView: document.querySelector(".view.is-active")?.id,
          quickInput: document.querySelector("#quickTaskInput")?.value,
          modalOpen: [...document.querySelectorAll("dialog[open]")].map((dialog) => dialog.id),
        })`);
        console.error(`SMOKE_CONTEXT ${JSON.stringify(context)}`);
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
    console.error(`SMOKE_FAIL ${code} ${description}`);
    app.exit(1);
  });
}

module.exports = { attachSmokeTest };
