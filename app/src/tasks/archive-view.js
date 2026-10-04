(function (global) {
  function createArchiveView(ctx) {
    const PAGE_SIZE = 100;
    const selectedKeys = new Set();
    let visibleEntries = [];
    let filteredEntries = [];
    let visibleLimit = PAGE_SIZE;
    let filterSignature = "";
    let period = ["all", "week", "month", "quarter"].includes(ctx.initialPeriod)
      ? ctx.initialPeriod
      : "all";
    if (ctx.els?.archivePeriodFilter) ctx.els.archivePeriodFilter.value = period;

    function saveChange(undo) {
      if (ctx.saveState() !== false) return true;
      ctx.restoreState(undo);
      ctx.render();
      return false;
    }

    ctx.els?.archiveSelectAll?.addEventListener("change", () => {
      selectedKeys.clear();
      if (ctx.els.archiveSelectAll.checked) visibleEntries.forEach((entry) => selectedKeys.add(entryKey(entry)));
      renderArchive();
    });
    ctx.els?.archiveBulkRestore?.addEventListener("click", restoreSelected);
    ctx.els?.archiveBulkDelete?.addEventListener("click", deleteSelected);
    ctx.els?.archivePeriodFilter?.addEventListener("change", () => {
      period = ctx.els.archivePeriodFilter.value || "all";
      selectedKeys.clear();
      visibleLimit = PAGE_SIZE;
      ctx.onPeriodChange?.(period);
      renderArchive();
    });

    function renderArchive() {
      const allEntries = ctx.archiveEntries();
      const nextFilterSignature = JSON.stringify([
        period,
        ctx.getArchiveCategoryFilter(),
        ctx.getArchiveSearchQuery(),
      ]);
      if (filterSignature && filterSignature !== nextFilterSignature) {
        selectedKeys.clear();
        visibleLimit = PAGE_SIZE;
      }
      filterSignature = nextFilterSignature;
      filteredEntries = allEntries.filter((entry) => {
        return (
          ctx.matchesCategoryFilter(entry.task, ctx.getArchiveCategoryFilter()) &&
          ctx.archiveEntryMatchesSearch(entry, ctx.getArchiveSearchQuery()) &&
          global.RhythmPlanningHistory.archiveEntryInPeriod(entry.dateKey, period, ctx.toDateKey(new Date()), ctx.addDays)
        );
      });
      visibleEntries = filteredEntries.slice(0, visibleLimit);
      const validKeys = new Set(filteredEntries.map(entryKey));
      [...selectedKeys].forEach((key) => {
        if (!validKeys.has(key)) selectedKeys.delete(key);
      });
      ctx.els.archiveList.replaceChildren();
      let currentDateKey = "";
      visibleEntries.forEach((entry) => {
        if (entry.dateKey !== currentDateKey) {
          currentDateKey = entry.dateKey;
          ctx.els.archiveList.appendChild(createArchiveDateHeader(entry.dateKey));
        }
        ctx.els.archiveList.appendChild(createArchiveNode(entry));
      });
      if (filteredEntries.length > visibleEntries.length) {
        ctx.els.archiveList.appendChild(createLoadMoreButton(filteredEntries.length - visibleEntries.length));
      }
      ctx.els.archiveEmpty.textContent = allEntries.length
        ? "По текущим фильтрам записей нет."
        : "Завершенных задач пока нет.";
      ctx.els.archiveEmpty.classList.toggle("is-visible", filteredEntries.length === 0);
      renderBulkBar();
    }

    function createArchiveDateHeader(dateKey) {
      const header = document.createElement("div");
      header.className = "archive-date-header";
      header.textContent = ctx.formatLongDate(dateKey);
      return header;
    }

    function createLoadMoreButton(remaining) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost-button archive-load-more";
      button.textContent = `Показать ещё (${Math.min(PAGE_SIZE, remaining)})`;
      button.addEventListener("click", () => {
        visibleLimit += PAGE_SIZE;
        renderArchive();
      });
      return button;
    }

    function createArchiveNode(entry) {
      const node = document.createElement("article");
      const content = document.createElement("div");
      const title = document.createElement("h3");
      const meta = document.createElement("p");
      const restoreButton = document.createElement("button");
      const deleteButton = document.createElement("button");
      const actions = document.createElement("div");
      const select = document.createElement("input");
      const selectArea = document.createElement("label");
      const category = ctx.getCategory(entry.task.categoryId);

      node.className = "archive-item";
      node.classList.toggle("is-selected", selectedKeys.has(entryKey(entry)));
      content.className = "archive-item-content";
      selectArea.className = "archive-select-hit-area";
      select.type = "checkbox";
      select.className = "archive-item-select";
      select.checked = selectedKeys.has(entryKey(entry));
      select.setAttribute("aria-label", `Выбрать ${entry.task.title}`);
      select.addEventListener("change", () => {
        if (select.checked) selectedKeys.add(entryKey(entry));
        else selectedKeys.delete(entryKey(entry));
        node.classList.toggle("is-selected", select.checked);
        renderBulkBar();
      });
      selectArea.appendChild(select);
      title.textContent = entry.task.title;
      if (category) {
        const categoryLabel = document.createElement("span");
        categoryLabel.className = "archive-category-label";
        const dot = document.createElement("span");
        dot.className = "category-dot";
        dot.style.setProperty("--category-color", category.color);
        categoryLabel.append(dot, document.createTextNode(category.name));
        appendArchiveMeta(meta, categoryLabel);
      }
      if (entry.task.priority && entry.task.priority !== "medium" && ctx.priorityLabels[entry.task.priority]) {
        appendArchiveMeta(meta, ctx.priorityLabels[entry.task.priority]);
      }
      restoreButton.className = "icon-button subtle restore-task";
      restoreButton.type = "button";
      restoreButton.title = "Вернуть в задачи";
      restoreButton.setAttribute("aria-label", `Вернуть в задачи: ${entry.task.title}`);
      restoreButton.appendChild(createIcon("undo"));
      restoreButton.addEventListener("click", async () => {
        const state = ctx.getState();
        const choice = await ctx.confirmAction({
          title: "Куда вернуть задачу?",
          message: `«${entry.task.title}» была завершена ${ctx.formatLongDate(entry.dateKey)}. Можно вернуть ее на исходный день или перенести в сегодняшний план.`,
          confirmLabel: "На сегодня",
          secondaryLabel: "На исходную дату",
        });
        if (!choice || ctx.getState() !== state) return;
        const undo = ctx.createUndoSnapshot();
        entry.task.completed[entry.dateKey] = false;
        entry.task.updatedAt = new Date().toISOString();
        if (choice !== "secondary") {
          ctx.postponeTask(entry.task, entry.dateKey, ctx.toDateKey(new Date()), { undo });
          return;
        }
        if (!saveChange(undo)) return;
        ctx.render();
        ctx.showToast("Задача возвращена в план", { undo });
      });
      deleteButton.className = "icon-button subtle archive-delete-entry";
      deleteButton.type = "button";
      deleteButton.setAttribute("aria-label", `Удалить запись ${entry.task.title}`);
      deleteButton.title = "Удалить запись";
      deleteButton.appendChild(createIcon("trash"));
      deleteButton.addEventListener("click", () => deleteEntry(entry));
      actions.className = "archive-item-actions";
      actions.append(restoreButton, deleteButton);
      content.append(title, meta);
      node.append(selectArea, content, actions);

      return node;
    }

    function renderBulkBar() {
      const count = selectedKeys.size;
      ctx.els.archiveBulkBar.hidden = visibleEntries.length === 0;
      ctx.els.archiveBulkBar.classList.toggle("has-selection", count > 0);
      ctx.els.archiveBulkCount.textContent = `Выбрано: ${count}`;
      ctx.els.archiveBulkRestore.disabled = count === 0;
      ctx.els.archiveBulkDelete.disabled = count === 0;
      const visibleKeys = visibleEntries.map(entryKey);
      ctx.els.archiveSelectAll.checked = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));
      ctx.els.archiveSelectAll.indeterminate = !ctx.els.archiveSelectAll.checked && visibleKeys.some((key) => selectedKeys.has(key));
    }

    function selectedEntries() {
      return filteredEntries.filter((entry) => selectedKeys.has(entryKey(entry)));
    }

    async function restoreSelected() {
      const entries = selectedEntries();
      if (!entries.length) return;
      const state = ctx.getState();
      const confirmed = await ctx.confirmAction({
        title: "Вернуть задачи в план?",
        message: `Задачи будут снова открыты на исходных датах. Выбрано: ${entries.length}.`,
        confirmLabel: "Вернуть",
      });
      if (!confirmed || ctx.getState() !== state) return;
      const undo = ctx.createUndoSnapshot();
      entries.forEach((entry) => {
        entry.task.completed[entry.dateKey] = false;
        entry.task.updatedAt = new Date().toISOString();
      });
      if (!saveChange(undo)) return;
      selectedKeys.clear();
      ctx.render();
      ctx.showToast(`Возвращено задач: ${entries.length}`, { undo });
    }

    async function deleteSelected() {
      const entries = selectedEntries();
      if (!entries.length) return;
      const state = ctx.getState();
      const confirmed = await ctx.confirmAction({
        title: "Удалить записи из архива?",
        message: `Будет удалено записей: ${entries.length}. Повторяющиеся серии сохранятся.`,
        confirmLabel: "Удалить",
        tone: "danger",
      });
      if (!confirmed || ctx.getState() !== state) return;
      const undo = ctx.createUndoSnapshot();
      const deletedTaskIds = removeArchiveEntries(entries);
      deletedTaskIds.forEach(ctx.deleteTask);
      if (!saveChange(undo)) return;
      selectedKeys.clear();
      ctx.render();
      ctx.showToast(`Удалено записей: ${entries.length}`, { undo });
    }

    async function deleteEntry(entry) {
      const state = ctx.getState();
      const confirmed = await ctx.confirmAction({
        title: "Удалить запись из архива?",
        message: entry.task.repeat === "none"
          ? `Задача «${entry.task.title}» будет удалена.`
          : `Из серии «${entry.task.title}» будет удалено только повторение за ${ctx.formatLongDate(entry.dateKey)}.`,
        confirmLabel: "Удалить",
        tone: "danger",
      });
      if (!confirmed || ctx.getState() !== state) return;
      const undo = ctx.createUndoSnapshot();
      removeArchiveEntries([entry]).forEach(ctx.deleteTask);
      if (!saveChange(undo)) return;
      selectedKeys.delete(entryKey(entry));
      ctx.render();
      ctx.showToast("Запись удалена из архива", { undo });
    }

    function entryKey(entry) {
      return `${entry.task.id}:${entry.dateKey}`;
    }

    function appendArchiveMeta(meta, value) {
      if (meta.childNodes.length) meta.append(document.createTextNode(" · "));
      if (value instanceof Node) {
        meta.appendChild(value);
      } else {
        meta.append(document.createTextNode(value));
      }
    }

    function createIcon(name) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      svg.classList.add("ui-icon");
      svg.setAttribute("aria-hidden", "true");
      use.setAttribute("href", `#icon-${name}`);
      svg.appendChild(use);
      return svg;
    }
    function setPeriod(value) {
      period = ["all", "week", "month", "quarter"].includes(value) ? value : "all";
      selectedKeys.clear();
      visibleLimit = PAGE_SIZE;
      if (ctx.els.archivePeriodFilter) ctx.els.archivePeriodFilter.value = period;
      ctx.onPeriodChange?.(period);
      renderArchive();
    }
    return { createArchiveNode, renderArchive, setPeriod };
  }

  function removeArchiveEntries(entries) {
    const deletedTaskIds = new Set();
    entries.forEach((entry) => {
      if (entry.task.repeat === "none") {
        deletedTaskIds.add(entry.task.id);
        return;
      }
      if (!entry.task.completed) entry.task.completed = {};
      if (!entry.task.excludedDates) entry.task.excludedDates = {};
      delete entry.task.completed[entry.dateKey];
      entry.task.excludedDates[entry.dateKey] = true;
      entry.task.updatedAt = new Date().toISOString();
    });
    return deletedTaskIds;
  }

  const api = { createArchiveView, removeArchiveEntries };
  global.RhythmArchiveView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
