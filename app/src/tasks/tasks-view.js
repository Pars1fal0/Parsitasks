(function (global) {
  function createTasksView(ctx) {
    let draggedTaskId = null;
    let draggedTaskDate = "";
    let overdueVisibleCount = 20;
    let historicalVisibleCount = 60;
    const expandedChecklists = new Set();
    const selectedTasks = new Map();
    let selectionMode = false;
    let selectionDate = null;
    let selectableEntries = [];
    const selectionButton = document.querySelector("#taskSelectMode");
    const bulkForm = document.querySelector("#taskBulkForm");
    const bulkDate = document.querySelector("#taskBulkDate");
    const laterPanel = document.querySelector("#laterTaskPanel");
    const laterList = document.querySelector("#laterTaskList");
    const emptyReset = document.querySelector("#taskEmptyReset");
    const taskToolbarActions = document.querySelector("#tasksView > .toolbar .toolbar-actions");
    if (taskToolbarActions && selectionButton) taskToolbarActions.prepend(selectionButton);
    selectionButton?.addEventListener("click", () => {
      selectionMode = !selectionMode;
      selectedTasks.clear();
      renderTasks();
    });
    document.querySelector("#taskBulkCancel")?.addEventListener("click", () => {
      selectionMode = false;
      selectedTasks.clear();
      renderTasks();
    });
    document.querySelector("#taskSelectAll")?.addEventListener("click", () => {
      selectableEntries.forEach((entry) => selectedTasks.set(entry.taskId, entry));
      renderTasks();
    });
    bulkForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (ctx.moveTasks([...selectedTasks.values()], bulkDate.value)) {
        selectedTasks.clear();
        selectionMode = false;
        renderTasks();
      }
    });
    document.querySelector("#addLaterTask")?.addEventListener("click", () => ctx.openLaterTaskForm());
    emptyReset?.addEventListener("click", () => ctx.els.clearTaskSearch.click());
    const activeFilters = ctx.els.activeTaskFilters;
    const activeFiltersLabel = ctx.els.activeTaskFiltersLabel;
    const filterSummary = ctx.els.taskFilterSummary;
    ctx.els.resetActiveTaskFilters?.addEventListener("click", () => ctx.els.clearTaskSearch.click());
    ctx.els.overdueToggle?.addEventListener("click", () => {
      ctx.setOverdueHidden(!ctx.getOverdueHidden());
      renderOverdueTasks();
    });
    ctx.els.overdueAcknowledgeAll?.addEventListener("click", () => {
      ctx.acknowledgeAllOverdueTasks(ctx.overdueTaskEntries());
    });

    function renderTasks() {
      const activeDate = ctx.getActiveDate();
      if (selectionDate !== activeDate) {
        selectedTasks.clear();
        selectionMode = false;
        selectionDate = activeDate;
      }
      const tasks = ctx.getOrderedTasksForDate(activeDate);
      const visibleTasks = tasks.filter((task) => {
        const done = ctx.isTaskDone(task, activeDate);
        const matchesCategory = ctx.matchesCategoryFilter(task, ctx.getTaskCategoryFilter());
        if (!matchesCategory) return false;
        if (!ctx.taskMatchesSearch(task, ctx.getTaskSearchQuery(), activeDate)) return false;
        if (ctx.getTaskFilter() === "open") return !done;
        if (ctx.getTaskFilter() === "done") return done;
        return true;
      });
      const hasActiveFilters = ctx.getTaskFilter() !== "all" || ctx.getTaskCategoryFilter() !== "all" || ctx.getTaskSearchQuery();
      const canReorder = !hasActiveFilters;
      const filterLabels = [];
      if (ctx.getTaskFilter() !== "all") filterLabels.push(ctx.getTaskFilter() === "open" ? "Активные" : "Готовые");
      const categoryFilter = ctx.getTaskCategoryFilter();
      if (categoryFilter !== "all") filterLabels.push(categoryFilter === "none" ? "Без категории" : ctx.getCategory(categoryFilter)?.name || "Категория");
      if (ctx.getTaskSearchQuery()) filterLabels.push(`Поиск: ${ctx.getTaskSearchQuery()}`);
      if (activeFilters) activeFilters.hidden = filterLabels.length === 0;
      if (activeFiltersLabel) activeFiltersLabel.textContent = filterLabels.join(" · ");
      if (filterSummary) filterSummary.textContent = filterLabels.length ? `Фильтры и поиск (${filterLabels.length})` : "Фильтры и поиск";

      renderOverdueTasks();
      const laterTasks = ctx.getState().tasks.filter((task) => task.date === null
        && ctx.matchesCategoryFilter(task, ctx.getTaskCategoryFilter())
        && ctx.taskMatchesSearch(task, ctx.getTaskSearchQuery(), activeDate)
        && ctx.getTaskFilter() !== "done");
      selectableEntries = [...visibleTasks.map((task) => ({ taskId: task.id, dateKey: activeDate })),
        ...laterTasks.map((task) => ({ taskId: task.id, dateKey: null }))];
      const visibleIds = new Set(selectableEntries.map((entry) => entry.taskId));
      for (const id of selectedTasks.keys()) if (!visibleIds.has(id)) selectedTasks.delete(id);
      ctx.els.taskList.replaceChildren();
      visibleTasks.forEach((task) => ctx.els.taskList.appendChild(createTaskNode(task, canReorder)));
      renderLaterTasks(laterTasks);
      updateSelection();

      const doneCount = tasks.filter((task) => ctx.isTaskDone(task, activeDate)).length;
      const percent = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
      const empty = taskEmptyState({ total: tasks.length, done: doneCount, visible: visibleTasks.length,
        filtered: Boolean(hasActiveFilters), filter: ctx.getTaskFilter(),
        statusOnly: ctx.getTaskCategoryFilter() === "all" && !ctx.getTaskSearchQuery() });
      ctx.els.taskEmpty.textContent = empty.message;
      ctx.els.taskEmpty.classList.toggle("is-visible", empty.visible);
      if (emptyReset) emptyReset.hidden = !empty.reset;
      ctx.els.taskCounter.textContent = hasActiveFilters
        ? `${visibleTasks.length} из ${tasks.length} найдено · ${doneCount} выполнено`
        : tasks.length ? `Выполнено ${doneCount} из ${tasks.length}` : "Пока нет задач";
      ctx.els.taskProgress.textContent = tasks.length ? `${percent}%` : "—";
      ctx.els.taskProgressRing.setAttribute("aria-label", tasks.length ? `Выполнение задач: ${percent}%` : "Задач на выбранный день нет");
      ctx.els.taskProgressRing.style.setProperty("--progress", `${percent * 3.6}deg`);
      renderExcludedTasks();
      renderHistoricalTasks();
    }

    function updateSelection() {
      if (selectionButton) {
        selectionButton.hidden = !selectableEntries.length;
        selectionButton.setAttribute("aria-pressed", String(selectionMode));
        selectionButton.title = selectionMode ? "Закончить выбор задач" : "Выбрать задачи для переноса";
        selectionButton.setAttribute("aria-label", selectionButton.title);
        selectionButton.querySelector("span").textContent = selectionMode ? "Закончить выбор" : "Выбрать задачи";
      }
      if (!bulkForm) return;
      bulkForm.hidden = selectedTasks.size === 0;
      document.querySelector("#taskBulkCount").textContent = `Выбрано: ${selectedTasks.size}`;
      if (!bulkDate.value) bulkDate.value = ctx.addDays(ctx.getActiveDate(), 1);
    }

    function createSelection(task, dateKey) {
      const label = document.createElement("label");
      label.className = "task-select-control";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selectedTasks.has(task.id);
      input.setAttribute("aria-label", `Выбрать задачу «${task.title}»`);
      input.addEventListener("change", () => {
        if (input.checked) selectedTasks.set(task.id, { taskId: task.id, dateKey });
        else selectedTasks.delete(task.id);
        updateSelection();
      });
      label.append(input);
      return label;
    }

    function renderLaterTasks(tasks) {
      if (!laterList) return;
      laterList.replaceChildren();
      document.querySelector("#laterTaskCount").textContent = String(tasks.length);
      tasks.forEach((task) => {
        const row = document.createElement("article");
        row.className = "later-task-row";
        row.dataset.taskId = task.id;
        if (selectionMode) row.append(createSelection(task, null));
        const title = document.createElement("strong");
        title.textContent = task.title;
        const actions = document.createElement("div");
        actions.className = "later-task-actions";
        const date = document.createElement("input");
        date.type = "date";
        date.className = "later-task-date";
        date.setAttribute("aria-label", `Дата задачи «${task.title}»`);
        const schedule = createButton("ghost-button compact-button", "Назначить дату");
        schedule.addEventListener("click", () => {
          date.hidden = false;
          if (date.showPicker) date.showPicker();
          else date.focus();
        });
        date.hidden = true;
        date.addEventListener("change", () => {
          if (date.value) ctx.moveTasks([{ taskId: task.id, dateKey: null }], date.value);
        });
        const menu = document.createElement("details");
        menu.className = "task-more later-task-menu";
        const summary = document.createElement("summary");
        summary.className = "icon-button";
        summary.setAttribute("aria-label", `Действия с задачей «${task.title}»`);
        summary.textContent = "...";
        const content = document.createElement("div");
        content.className = "task-more-menu";
        const edit = createButton("ghost-button compact-button", "Изменить");
        const remove = createButton("ghost-button compact-button danger-button", "Удалить");
        edit.addEventListener("click", () => { menu.open = false; ctx.fillTaskForm(task); });
        remove.addEventListener("click", () => { menu.open = false; deleteTaskWithScope(task, null); });
        content.append(edit, remove);
        menu.append(summary, content);
        actions.append(schedule, date, menu);
        row.append(title, actions);
        laterList.append(row);
      });
      if (selectionMode && tasks.length && laterPanel) laterPanel.open = true;
    }

    function renderHistoricalTasks() {
      if (!ctx.els.historicalTaskPanel) return;
      const entries = global.RhythmPlanningHistory.buildBacklogEntries({
        addDays: ctx.addDays,
        isTaskDone: ctx.isTaskDone,
        isTaskExcluded: ctx.isTaskExcluded,
        taskOccursOn: ctx.taskOccursOn,
        tasks: ctx.getState().tasks,
        todayKey: ctx.toDateKey(new Date()),
      });
      ctx.els.historicalTaskPanel.hidden = entries.length === 0;
      ctx.els.historicalTaskCount.textContent = String(entries.length);
      ctx.els.historicalTaskList.replaceChildren();
      entries.slice(0, historicalVisibleCount).forEach((entry) => {
        const { task, dateKey } = entry;
        const row = document.createElement("article");
        const content = document.createElement("div");
        const title = document.createElement("strong");
        const date = document.createElement("span");
        const actions = document.createElement("div");
        const open = createButton("ghost-button compact-button", "Открыть день");
        const acknowledge = createButton("ghost-button compact-button", "Скрыть из просроченных");
        const today = createButton("primary-button compact-button", "Перенести на сегодня");
        row.className = "historical-task-item";
        title.textContent = task.title;
        date.textContent = `${ctx.formatLongDate(dateKey)}${entry.recurring ? " · повтор" : ""}`;
        content.append(title, date);
        actions.append(open, acknowledge, today);
        row.append(content, actions);
        open.addEventListener("click", () => ctx.openDate(dateKey));
        acknowledge.addEventListener("click", () => ctx.acknowledgeOverdueTask(task, dateKey));
        today.addEventListener("click", () => ctx.postponeTask(task, dateKey, ctx.toDateKey(new Date()), { clearPastTimeToday: true }));
        ctx.els.historicalTaskList.appendChild(row);
      });
      if (entries.length > historicalVisibleCount) {
        const more = createButton("ghost-button compact-button", `Показать ещё (${entries.length - historicalVisibleCount})`);
        more.addEventListener("click", () => {
          historicalVisibleCount += 60;
          renderHistoricalTasks();
        });
        ctx.els.historicalTaskList.appendChild(more);
      }
    }

    function createTaskNode(task, canReorder = true) {
      const activeDate = ctx.getActiveDate();
      const node = ctx.els.taskTemplate.content.firstElementChild.cloneNode(true);
      const done = ctx.isTaskDone(task, activeDate);
      const category = ctx.getCategory(task.categoryId);
      const title = node.querySelector("h3");
      const check = node.querySelector(".check-button");
      const meta = node.querySelector(".task-meta");
      const postponeDateInput = node.querySelector(".postpone-date-input");
      const priority = node.querySelector(".priority-pill");
      const restoreOverdue = node.querySelector(".restore-overdue-task");
      const dragHandle = node.querySelector(".drag-handle");

      node.dataset.taskId = task.id;
      if (category) {
        node.classList.add("has-category");
        node.style.setProperty("--category-color", category.color);
      } else {
        node.classList.remove("has-category");
        node.style.removeProperty("--category-color");
      }
      node.classList.toggle("is-done", done);
      node.classList.add(`priority-${task.priority || "medium"}-task`);
      title.textContent = task.title;
      check.classList.toggle("is-checked", done);
      check.setAttribute("aria-label", done ? `Вернуть задачу «${task.title}» в работу` : `Отметить задачу «${task.title}» выполненной`);
      check.setAttribute("aria-pressed", String(done));
      priority.textContent = ctx.priorityLabels[task.priority] || "Средний";
      priority.classList.add(`priority-${task.priority || "medium"}`);
      renderTaskMeta(meta, task);
      priority.hidden = (task.priority || "medium") === "medium";
      meta.append(priority);
      if (task.checklist?.length) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        const list = document.createElement("div");
        details.className = "task-checklist";
        const expansionKey = `${task.id}:${activeDate}`;
        details.open = expandedChecklists.has(expansionKey);
        details.addEventListener("toggle", () => {
          if (!details.isConnected) return;
          if (details.open) expandedChecklists.add(expansionKey);
          else expandedChecklists.delete(expansionKey);
        });
        const update = () => { const progress = global.RhythmTaskChecklist.progress(task, activeDate); summary.textContent = `Шаги: ${progress.done} из ${progress.total}`; };
        update();
        task.checklist.forEach((item) => {
          const label = document.createElement("label");
          const checkbox = document.createElement("input");
          const text = document.createElement("span");
          checkbox.type = "checkbox";
          checkbox.checked = task.checklistLogs?.[activeDate]?.[item.id]?.done === true;
          text.textContent = item.title;
          checkbox.addEventListener("change", () => {
            const undo = ctx.createUndoSnapshot();
            const previous = global.RhythmTaskChecklist.normalizeLogs(task.checklistLogs);
            global.RhythmTaskChecklist.setDone(task, activeDate, item.id, checkbox.checked);
            if (ctx.saveState() === false) { task.checklistLogs = previous; checkbox.checked = !checkbox.checked; }
            else ctx.showToast(checkbox.checked ? "Пункт выполнен" : "Отметка пункта снята", { undo });
            update();
          });
          label.append(checkbox, text);
          list.append(label);
        });
        details.append(summary, list);
        node.querySelector(".task-content").append(details);
      }
      const linkedNotes = ctx.getNotesForTask?.(task.id) || [];
      if (linkedNotes.length) {
        const openNotes = document.createElement("button");
        openNotes.type = "button";
        openNotes.className = "task-note-link";
        openNotes.append(createIcon("journal"), document.createTextNode(` Заметки · ${linkedNotes.length}`));
        openNotes.setAttribute("aria-label", `Открыть заметки к задаче «${task.title}»`);
        openNotes.addEventListener("click", () => ctx.openNote?.(linkedNotes[0].id));
        meta.appendChild(openNotes);
      }
      if (restoreOverdue) {
        restoreOverdue.hidden = task.acknowledgedOverdue?.[activeDate] !== true;
        restoreOverdue.addEventListener("click", () => ctx.restoreOverdueTask(task, activeDate));
      }

      canReorder = canReorder && !selectionMode;
      node.draggable = canReorder;
      if (dragHandle) {
        dragHandle.disabled = !canReorder;
        dragHandle.title = canReorder ? "Изменить порядок задачи" : "Сбрось фильтры, чтобы изменить порядок";
      }
      node.addEventListener("dragstart", (event) => {
        if (!canReorder) {
          event.preventDefault();
          return;
        }
        if (!event.target.closest(".drag-handle") && event.target.closest("button, input, select, textarea")) {
          event.preventDefault();
          return;
        }
        draggedTaskId = task.id;
        draggedTaskDate = activeDate;
        ctx.setDraggedTask(task.id, activeDate);
        node.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        event.dataTransfer.setData("application/x-rhythm-task", JSON.stringify({ taskId: task.id, dateKey: activeDate }));
      });
      node.addEventListener("dragend", () => {
        ctx.clearTaskDragState();
        draggedTaskId = null;
        draggedTaskDate = "";
        node.classList.remove("is-dragging");
      });
      node.addEventListener("dragover", (event) => {
        if (!canReorder) return;
        event.preventDefault();
        if (draggedTaskId && draggedTaskId !== task.id) {
          node.classList.add("is-drop-target");
        }
      });
      node.addEventListener("dragleave", () => node.classList.remove("is-drop-target"));
      node.addEventListener("drop", (event) => {
        if (!canReorder) return;
        event.preventDefault();
        const sourceId = draggedTaskId || event.dataTransfer.getData("text/plain");
        if (sourceId && sourceId !== task.id) {
          const undo = ctx.createUndoSnapshot();
          ctx.reorderTask(activeDate, sourceId, task.id);
          ctx.saveState();
          ctx.render();
          ctx.showToast("Порядок задач изменен", { undo });
        }
      });
      dragHandle?.setAttribute("aria-label", `Переместить задачу ${task.title}. Стрелки вверх и вниз меняют порядок`);
      if (canReorder) attachTaskAccessibleMove(node, task, dragHandle);
      if (selectionMode && dragHandle) dragHandle.replaceWith(createSelection(task, activeDate));

      check.addEventListener("click", () => {
        const undo = ctx.createUndoSnapshot();
        task.completed[activeDate] = !done;
        ctx.saveState();
        ctx.render();
        ctx.showToast(done ? "Задача снова активна" : "Задача выполнена", { undo });
      });

      node.querySelector(".edit-task").addEventListener("click", () => ctx.fillTaskForm(task));
      node.querySelector(".duplicate-task").addEventListener("click", () => ctx.duplicateTask(task.id));
      const postponeTomorrow = () => {
        ctx.postponeTask(task, activeDate, ctx.addDays(activeDate, 1));
      };
      node.querySelector(".postpone-tomorrow").addEventListener("click", postponeTomorrow);
      node.querySelector(".postpone-tomorrow-menu").addEventListener("click", postponeTomorrow);
      node.querySelector(".postpone-week").addEventListener("click", () => {
        ctx.postponeTask(task, activeDate, ctx.addDays(activeDate, 7));
      });
      node.querySelector(".postpone-date").addEventListener("click", () => {
        postponeDateInput.value = ctx.addDays(activeDate, 1);
        postponeDateInput.classList.add("is-visible");
        if (postponeDateInput.showPicker) {
          postponeDateInput.showPicker();
        } else {
          postponeDateInput.focus();
        }
      });
      postponeDateInput.addEventListener("change", () => {
        if (!postponeDateInput.value) return;
        ctx.postponeTask(task, activeDate, postponeDateInput.value);
      });
      const excludeButton = node.querySelector(".exclude-task");
      excludeButton.hidden = task.repeat === "none";
      excludeButton.addEventListener("click", () => ctx.excludeTaskDate(task, activeDate));
      node.querySelector(".delete-task").addEventListener("click", () => {
        deleteTaskWithScope(task, activeDate);
      });

      return node;
    }

    function attachTaskAccessibleMove(node, task, handle) {
      if (!handle) return;
      handle.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        const items = [...ctx.els.taskList.querySelectorAll(".task-item")];
        const index = items.indexOf(node);
        const target = items[index + (event.key === "ArrowUp" ? -1 : 1)];
        if (!target?.dataset.taskId) return;
        event.preventDefault();
        commitTaskReorder(task.id, target.dataset.taskId, task.title);
      });

      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        const startY = event.clientY;
        let targetId = "";
        let moved = false;
        handle.setPointerCapture?.(event.pointerId);
        node.classList.add("is-dragging");

        const onMove = (moveEvent) => {
          moveEvent.preventDefault();
          moved = moved || Math.abs(moveEvent.clientY - startY) > 5;
          if (!moved || typeof document.elementFromPoint !== "function") return;
          const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest?.(".task-item");
          clearTaskDropTargets();
          if (!target || target === node) return void (targetId = "");
          targetId = target.dataset.taskId || "";
          target.classList.add("is-drop-target");
        };
        const cleanup = (finishEvent) => {
          handle.releasePointerCapture?.(finishEvent.pointerId);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", cancel);
          node.classList.remove("is-dragging");
          clearTaskDropTargets();
        };
        const finish = (finishEvent) => {
          cleanup(finishEvent);
          if (moved && targetId) commitTaskReorder(task.id, targetId, task.title);
        };
        const cancel = (cancelEvent) => {
          targetId = "";
          cleanup(cancelEvent);
        };
        window.addEventListener("pointermove", onMove, { passive: false });
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", cancel);
      });
    }

    function commitTaskReorder(sourceId, targetId, title) {
      if (!sourceId || !targetId || sourceId === targetId) return;
      const undo = ctx.createUndoSnapshot();
      ctx.reorderTask(ctx.getActiveDate(), sourceId, targetId);
      ctx.saveState();
      ctx.render();
      ctx.showToast(`${title}: порядок обновлен`, { undo });
    }

    function clearTaskDropTargets() {
      ctx.els.taskList.querySelectorAll(".task-item.is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
    }

    function renderTaskMeta(meta, task) {
      meta.replaceChildren();
      ctx.taskMetaItems(task).filter((item) => !["empty", "reminder"].includes(item.type)).forEach((item) => {
        const chip = document.createElement("span");
        chip.className = ["category", "study"].includes(item.type) ? "task-meta-chip task-category-chip" : "task-meta-chip";
        if (item.type === "empty") chip.classList.add("is-empty");
        if (item.categoryColor) {
          const dot = document.createElement("span");
          chip.style.setProperty("--category-color", item.categoryColor);
          dot.className = "task-meta-dot";
          chip.appendChild(dot);
        }
        chip.append(document.createTextNode(item.label));
        meta.appendChild(chip);
      });
    }

    function renderOverdueTasks() {
      const overdueEntries = ctx.overdueTaskEntries();
      const visibleEntries = overdueEntries.slice(0, overdueVisibleCount);
      const isHidden = ctx.getOverdueHidden?.() === true;
      ctx.els.overdueList.replaceChildren();
      ctx.els.overduePanel.hidden = isHidden || overdueEntries.length === 0;
      ctx.els.overduePanel.classList.toggle("is-visible", overdueEntries.length > 0 && !isHidden);
      if (ctx.els.overdueToggle) {
        ctx.els.overdueToggle.hidden = overdueEntries.length === 0;
        ctx.els.overdueToggle.textContent = isHidden ? "Показать просрочки" : "Скрыть просрочки";
        ctx.els.overdueToggle.setAttribute("aria-expanded", String(!isHidden));
      }
      ctx.els.overdueCounter.textContent = overdueEntries.length
        ? `${overdueEntries.length} невыполнено${visibleEntries.length < overdueEntries.length ? ` · показано ${visibleEntries.length}` : ""}`
        : "";
      if (ctx.els.overdueAcknowledgeAll) ctx.els.overdueAcknowledgeAll.hidden = overdueEntries.length === 0;

      visibleEntries.forEach((entry) => {
        const node = document.createElement("article");
        node.className = "overdue-item";
        const category = ctx.getCategory(entry.task.categoryId);
        const details = [
          ctx.formatLongDate(entry.dateKey),
          entry.task.time ? `до ${ctx.formatTime(entry.task.time)}` : "до конца дня",
          category?.name || "Без категории",
          ctx.priorityLabels[entry.task.priority] || "Средний",
        ];
        if (entry.task.repeat !== "none") details.push(ctx.formatTaskRepeat(entry.task));

        const content = document.createElement("div");
        const title = document.createElement("h3");
        const meta = document.createElement("p");
        const actions = document.createElement("div");
        const more = document.createElement("details");
        const moreSummary = document.createElement("summary");
        const moreMenu = document.createElement("div");
        const deleteButton = createButton(
          "ghost-button compact-button overdue-delete",
          entry.task.repeat === "none" ? "Удалить" : "Пропустить этот день",
        );
        const deleteFutureButton = entry.task.repeat === "none"
          ? null
          : createButton("ghost-button compact-button overdue-delete-future", "Прекратить повторение с этой даты");
        const goButton = createButton("ghost-button compact-button overdue-go", "К дню");
        const acknowledgeButton = createButton("ghost-button compact-button overdue-acknowledge", "Скрыть из просроченных");
        const todayButton = createButton("ghost-button compact-button overdue-today", "Перенести на сегодня");
        const chooseDateButton = createButton("ghost-button compact-button overdue-choose-date", "Выбрать дату");
        const dateInput = document.createElement("input");
        dateInput.type = "date";
        dateInput.hidden = true;
        dateInput.setAttribute("aria-label", `Перенести задачу «${entry.task.title}» на дату`);
        chooseDateButton.addEventListener("click", () => {
          more.open = false;
          dateInput.hidden = false;
          if (dateInput.showPicker) dateInput.showPicker();
          else dateInput.focus();
        });
        dateInput.addEventListener("change", () => {
          if (dateInput.value) ctx.postponeTask(entry.task, entry.dateKey, dateInput.value, { clearPastTimeToday: true });
        });
        const doneButton = createButton("primary-button compact-button overdue-done", "Готово");

        title.textContent = entry.task.title;
        appendDetails(meta, details);
        content.append(title, meta);
        actions.className = "overdue-actions";
        more.className = "overdue-more";
        moreSummary.className = "overdue-more-trigger";
        moreSummary.setAttribute("aria-label", "Еще действия");
        moreSummary.textContent = "...";
        moreMenu.className = "overdue-more-menu";
        moreMenu.append(chooseDateButton, goButton, acknowledgeButton, deleteButton);
        if (deleteFutureButton) moreMenu.appendChild(deleteFutureButton);
        more.append(moreSummary, moreMenu);
        actions.append(todayButton, doneButton, more, dateInput);
        node.append(content, actions);

        goButton.addEventListener("click", () => {
          more.open = false;
          ctx.openDate(entry.dateKey);
        });

        acknowledgeButton.addEventListener("click", () => {
          more.open = false;
          ctx.acknowledgeOverdueTask(entry.task, entry.dateKey);
        });

        todayButton.addEventListener("click", () => {
          ctx.postponeTask(entry.task, entry.dateKey, ctx.toDateKey(new Date()), { clearPastTimeToday: true });
        });

        doneButton.addEventListener("click", () => {
          const undo = ctx.createUndoSnapshot();
          entry.task.completed[entry.dateKey] = true;
          ctx.saveState();
          ctx.render();
          ctx.showToast("Просроченная задача закрыта", { undo });
        });

        deleteButton.addEventListener("click", () => {
          more.open = false;
          if (entry.task.repeat !== "none") {
            ctx.excludeTaskDate(entry.task, entry.dateKey);
            return;
          }
          deleteTaskWithScope(entry.task, entry.dateKey);
        });

        deleteFutureButton?.addEventListener("click", () => {
          more.open = false;
          ctx.stopTaskSeries(entry.task, entry.dateKey);
        });

        ctx.els.overdueList.appendChild(node);
      });

      if (visibleEntries.length < overdueEntries.length) {
        const loadMore = createButton("ghost-button compact-button overdue-load-more", `Показать еще (${overdueEntries.length - visibleEntries.length})`);
        loadMore.addEventListener("click", () => {
          overdueVisibleCount += 20;
          renderOverdueTasks();
        });
        ctx.els.overdueList.appendChild(loadMore);
      }
    }

    async function deleteTaskWithScope(task, dateKey) {
      if (task.sourceTaskId) {
        const choice = await ctx.confirmAction({
          title: "Удалить перенесенную задачу?",
          message: "Можно вернуть исходный повтор на этот день или оставить день исключенным из серии.",
          secondaryLabel: "Вернуть повтор",
          confirmLabel: "Оставить день пустым",
          tone: "danger",
        });
        if (!choice) return;
        const undo = ctx.createUndoSnapshot();
        ctx.deleteMovedReplacement(task.id, { restoreSourceOccurrence: choice === "secondary" });
        ctx.saveState();
        ctx.render();
        ctx.showToast(choice === "secondary" ? "Исходный повтор возвращен" : "Перенесенная задача удалена", { undo });
        return;
      }
      if (task.repeat === "none") {
        const undo = ctx.createUndoSnapshot();
        ctx.deleteTask(task.id);
        ctx.saveState();
        ctx.render();
        ctx.showToast("Задача удалена", { undo });
        return;
      }

      if (!ctx.confirmAction) {
        ctx.excludeTaskDate(task, dateKey);
        return;
      }

      const scope = await ctx.confirmAction({
        title: "Удалить повторяющуюся задачу?",
        message: `Выбери, убрать только ${ctx.formatLongDate(dateKey)} или завершить серию с этого дня. Прошлая история сохранится.`,
        secondaryLabel: "Пропустить этот день",
        confirmLabel: "Прекратить повторение с этой даты",
        tone: "danger",
      });
      if (scope === "secondary") {
        ctx.excludeTaskDate(task, dateKey);
      } else if (scope === true) {
        ctx.stopTaskSeries(task, dateKey);
      }
    }

    function renderExcludedTasks() {
      const activeDate = ctx.getActiveDate();
      const excludedTasks = ctx.excludedTasksForDate(activeDate);
      ctx.els.excludedList.replaceChildren();
      ctx.els.excludedPanel.classList.toggle("is-visible", excludedTasks.length > 0);

      excludedTasks.forEach((task) => {
        const node = document.createElement("article");
        node.className = "excluded-item";
        const details = ctx.taskDetails(task).filter((detail) => detail !== ctx.formatTaskRepeat(task));
        const content = document.createElement("div");
        const title = document.createElement("h3");
        const meta = document.createElement("p");
        const restoreButton = createButton("ghost-button compact-button restore-excluded", "Вернуть в день");

        title.textContent = task.title;
        appendDetails(meta, [ctx.formatTaskRepeat(task) || "Повтор", details.join(" · ") || "Без категории"]);
        content.append(title, meta);
        node.append(content, restoreButton);

        restoreButton.addEventListener("click", () => {
          ctx.restoreTaskDate(task, activeDate);
        });

        ctx.els.excludedList.appendChild(node);
      });
    }

    function createButton(className, label) {
      const button = document.createElement("button");
      button.className = className;
      button.type = "button";
      button.textContent = label;
      return button;
    }

    function createIcon(name) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      svg.classList.add("ui-icon");
      use.setAttribute("href", `#icon-${name}`);
      svg.appendChild(use);
      return svg;
    }

    function appendDetails(node, details) {
      details.forEach((detail, index) => {
        if (index > 0) node.append(document.createTextNode(" · "));
        const part = document.createElement("span");
        part.textContent = detail;
        node.appendChild(part);
      });
    }

    return {
      createTaskNode,
      renderExcludedTasks,
      renderOverdueTasks,
      renderTasks,
    };
  }

  function taskEmptyState({ total = 0, done = 0, visible = 0, filtered = false, filter = "all", statusOnly = false } = {}) {
    if (filtered && !visible) {
      if (filter === "open" && total > 0 && done === total && statusOnly) {
        return { message: "Все задачи выполнены", visible: true, reset: true };
      }
      return { message: "По этим фильтрам ничего не найдено", visible: true, reset: true };
    }
    if (!total) return { message: "На этот день задач нет", visible: true, reset: false };
    return { message: "Все задачи выполнены", visible: done === total && !filtered, reset: false };
  }

  const api = { createTasksView, taskEmptyState };
  global.RhythmTasksView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
