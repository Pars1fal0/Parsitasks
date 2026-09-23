(function (global) {
  function createAppEvents(ctx) {
    function bind() {
      const { els } = ctx;
      const compactQuery = global.matchMedia?.("(max-width: 680px)");
      const syncCompactDisclosures = (event = compactQuery) => {
        document.querySelector(".task-filter-disclosure")?.removeAttribute("open");
        document.querySelector(".quick-task-disclosure")?.toggleAttribute("open", !event?.matches);
        document.querySelector(".timeline-unscheduled-panel")?.toggleAttribute("open", !event?.matches);
      };
      syncCompactDisclosures();
      compactQuery?.addEventListener?.("change", syncCompactDisclosures);
      els.activeDate.addEventListener("change", () => ctx.changeActiveDate(els.activeDate.value));
      els.prevDay.addEventListener("click", () => ctx.shiftDate(-1));
      els.nextDay.addEventListener("click", () => ctx.shiftDate(1));
      els.todayButton.addEventListener("click", ctx.goToday);
      els.prevMonth.addEventListener("click", () => ctx.shiftMonth(-1));
      els.nextMonth.addEventListener("click", () => ctx.shiftMonth(1));
      els.navTabs.forEach((button) => button.addEventListener("click", () => ctx.changeView(button.dataset.view)));
      document.querySelectorAll("[data-overview-mode]").forEach((button) => {
        button.addEventListener("click", () => ctx.changeOverviewMode(button.dataset.overviewMode, button));
      });

      els.taskCategoryFilter.addEventListener("change", () => ctx.changeTaskCategoryFilter(els.taskCategoryFilter.value));
      els.taskSearch.addEventListener("input", () => ctx.changeTaskSearch(els.taskSearch.value));
      els.clearTaskSearch.addEventListener("click", ctx.clearTaskSearch);
      document.querySelectorAll("[data-task-filter]").forEach((button) => {
        button.addEventListener("click", () => ctx.changeTaskFilter(button.dataset.taskFilter, button));
      });

      document.querySelector("#closeTaskForm").addEventListener("click", ctx.closeTaskForm);
      els.openTaskForm.addEventListener("click", ctx.openTaskForm);
      els.resetTaskForm.addEventListener("click", async () => {
        if (await ctx.confirmDiscardOpenForms()) ctx.resetTaskForm({ open: true });
      });
      els.taskForm.addEventListener("submit", ctx.saveTaskFromForm);
      els.quickTaskForm.addEventListener("submit", ctx.saveQuickTask);
      els.quickTaskInput.addEventListener("input", ctx.updateQuickTaskPreview);
      els.quickInputHints?.addEventListener("click", (event) => {
        const hint = event.target.closest("[data-quick-hint]")?.dataset.quickHint;
        if (!hint) return;
        els.quickTaskInput.value = `${els.quickTaskInput.value.trim()} ${hint}`.trim();
        ctx.updateQuickTaskPreview();
        els.quickTaskInput.focus();
      });
      els.taskRepeat.addEventListener("change", ctx.syncCustomRepeatPanel);
      els.taskDate.addEventListener("change", ctx.syncCustomRepeatPanel);
      [els.taskScheduleNone, els.taskScheduleDeadline, els.taskScheduleBlock].forEach((input) => input?.addEventListener("change", ctx.syncTaskScheduleMode));
      document.querySelectorAll("[data-repeat-mode]").forEach((button) => {
        button.addEventListener("click", () => ctx.setCustomRepeatMode(button.dataset.repeatMode));
      });
      bindWeekdayPicker("[data-weekday]", ctx.updateCustomRepeatSummary);
      [els.customRepeatMonthDay, els.customRepeatInterval].forEach((input) => input.addEventListener("input", ctx.updateCustomRepeatSummary));
      els.taskTime.addEventListener("input", ctx.syncTaskTimePresets);
      [els.taskStartTime, els.taskEndTime].forEach((input) => input?.addEventListener("input", ctx.syncTaskTimePresets));
      document.querySelectorAll("[data-time-preset]").forEach((button) => {
        button.addEventListener("click", () => ctx.applyTimePreset(button.dataset.timePreset || ""));
      });

      document.querySelector("#closeHabitForm").addEventListener("click", ctx.closeHabitForm);
      els.openHabitForm.addEventListener("click", ctx.openHabitForm);
      els.resetHabitForm.addEventListener("click", async () => {
        if (await ctx.confirmDiscardOpenForms()) ctx.resetHabitForm({ open: true });
      });
      els.habitForm.addEventListener("submit", ctx.saveHabitFromForm);
      els.habitType.addEventListener("change", ctx.syncHabitTypeFields);
      els.habitRepeat.addEventListener("change", ctx.syncHabitCustomRepeatPanel);
      document.querySelectorAll("[data-habit-repeat-mode]").forEach((button) => {
        button.addEventListener("click", () => ctx.setHabitCustomRepeatMode(button.dataset.habitRepeatMode));
      });
      bindWeekdayPicker("[data-habit-weekday]", ctx.updateHabitCustomRepeatSummary);
      [els.habitCustomRepeatMonthDay, els.habitCustomRepeatInterval].forEach((input) => input.addEventListener("input", ctx.updateHabitCustomRepeatSummary));

      els.closeGoalForm.addEventListener("click", ctx.closeGoalForm);
      els.openGoalForm.addEventListener("click", ctx.openGoalForm);
      els.resetGoalForm.addEventListener("click", async () => {
        if (await ctx.confirmDiscardOpenForms()) ctx.resetGoalForm({ open: true });
      });
      els.goalForm.addEventListener("submit", ctx.saveGoalFromForm);

      els.categoryForm.addEventListener("submit", ctx.saveCategoryFromForm);
      els.notifyButton.addEventListener("click", ctx.requestNotifications);
      els.exportButton.addEventListener("click", ctx.exportData);
      els.restoreBackupButton.addEventListener("click", ctx.restoreBackup);
      els.openBackupFolderButton.addEventListener("click", ctx.openBackupFolder);
      ctx.settingsController.bindEvents();
      els.importButton.addEventListener("click", () => els.importFile.click());
      els.importFile.addEventListener("change", ctx.importData);
      window.matchMedia?.("(prefers-color-scheme: light)")?.addEventListener("change", ctx.handleSystemThemeChange);
      window.addEventListener("offline", ctx.renderSaveStatus);
      window.addEventListener("popstate", ctx.handleNavigationChange);
      window.addEventListener("beforeunload", (event) => {
        if (!ctx.hasUnsavedForms()) return;
        event.preventDefault();
        event.returnValue = "";
      });

      els.archiveSearch.addEventListener("input", () => ctx.changeArchiveSearch(els.archiveSearch.value));
      els.archiveCategoryFilter.addEventListener("change", () => ctx.changeArchiveCategoryFilter(els.archiveCategoryFilter.value));
      els.clearArchiveFilter.addEventListener("click", ctx.clearArchiveFilter);
      ctx.calendarDragController.bindGlobalEvents();
    }

    function bindWeekdayPicker(selector, updateSummary) {
      document.querySelectorAll(selector).forEach((button) => {
        button.addEventListener("click", () => {
          const activeButtons = document.querySelectorAll(`${selector}.is-active`);
          if (button.classList.contains("is-active") && activeButtons.length <= 1) return;
          button.classList.toggle("is-active");
          updateSummary();
        });
      });
    }

    return { bind };
  }

  global.RhythmAppEvents = { createAppEvents };
  if (typeof module !== "undefined" && module.exports) module.exports = { createAppEvents };
})(typeof window !== "undefined" ? window : globalThis);
