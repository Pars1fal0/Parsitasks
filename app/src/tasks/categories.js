(function (global) {
  function createCategories(ctx) {
    const inlinePanel = ctx.els.taskInlineCategory;
    const inlineName = ctx.els.taskInlineCategoryName;
    const inlineColor = ctx.els.taskInlineCategoryColor;
    ctx.els.taskInlineCategorySave?.addEventListener("click", saveInlineCategory);
    inlineName?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      saveInlineCategory();
    });
    inlineName?.addEventListener("input", () => inlineName.setCustomValidity(""));
    inlinePanel?.addEventListener("toggle", () => {
      if (!inlinePanel.open) inlineName.setCustomValidity("");
    });

    function saveInlineCategory() {
      const name = ctx.cleanText(inlineName.value);
      if (!name) {
        inlineName.setCustomValidity("Напиши название категории");
        inlineName.reportValidity();
        return;
      }
      let category = ctx.getState().categories.find((item) => item.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"));
      if (!category) {
        const now = new Date().toISOString();
        category = { id: ctx.createId(), name, color: inlineColor.value, createdAt: now, updatedAt: now };
        ctx.getState().categories.push(category);
        ctx.saveState();
      }
      renderCategories();
      ctx.els.taskCategoryId.value = category.id;
      inlineName.value = "";
      inlineName.setCustomValidity("");
      inlinePanel.open = false;
      ctx.els.taskCategoryId.focus();
      ctx.showToast(`Выбрана категория: ${category.name}`);
    }

    function renderCategories() {
      const selectedCategoryId = ctx.els.taskCategoryId.value;
      ctx.els.taskCategoryId.replaceChildren();
      ctx.els.taskCategoryFilter.replaceChildren();
      ctx.els.archiveCategoryFilter.replaceChildren();

      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Без категории";
      ctx.els.taskCategoryId.appendChild(emptyOption);

      const allOption = document.createElement("option");
      allOption.value = "all";
      allOption.textContent = "Все категории";
      ctx.els.taskCategoryFilter.appendChild(allOption);

      const archiveAllOption = allOption.cloneNode(true);
      ctx.els.archiveCategoryFilter.appendChild(archiveAllOption);

      const uncategorizedOption = document.createElement("option");
      uncategorizedOption.value = "none";
      uncategorizedOption.textContent = "Без категории";
      ctx.els.taskCategoryFilter.appendChild(uncategorizedOption);

      const archiveUncategorizedOption = uncategorizedOption.cloneNode(true);
      ctx.els.archiveCategoryFilter.appendChild(archiveUncategorizedOption);

      const categories = [...ctx.getState().categories].sort((a, b) => a.name.localeCompare(b.name, "ru"));

      categories.forEach((category) => {
        const option = document.createElement("option");
        option.value = category.id;
        option.textContent = category.name;
        ctx.els.taskCategoryId.appendChild(option);

        const filterOption = document.createElement("option");
        filterOption.value = category.id;
        filterOption.textContent = category.name;
        ctx.els.taskCategoryFilter.appendChild(filterOption);

        const archiveFilterOption = filterOption.cloneNode(true);
        ctx.els.archiveCategoryFilter.appendChild(archiveFilterOption);
      });

      ctx.els.taskCategoryId.value = categories.some((category) => category.id === selectedCategoryId)
        ? selectedCategoryId : "";
      const taskCategoryFilter = ctx.getTaskCategoryFilter();
      const archiveCategoryFilter = ctx.getArchiveCategoryFilter();
      const filterExists =
        taskCategoryFilter === "all" || taskCategoryFilter === "none" || categories.some((category) => category.id === taskCategoryFilter);
      if (!filterExists) {
        ctx.setTaskCategoryFilter("all");
        ctx.saveUiState();
      }
      const archiveFilterExists =
        archiveCategoryFilter === "all" ||
        archiveCategoryFilter === "none" ||
        categories.some((category) => category.id === archiveCategoryFilter);
      if (!archiveFilterExists) {
        ctx.setArchiveCategoryFilter("all");
        ctx.saveUiState();
      }
      ctx.els.taskCategoryFilter.value = ctx.getTaskCategoryFilter();
      ctx.els.archiveCategoryFilter.value = ctx.getArchiveCategoryFilter();

      ctx.els.categoryList.replaceChildren();
      categories.forEach((category) => {
        const item = document.createElement("div");
        const dot = document.createElement("span");
        const name = document.createElement("span");
        const editButton = document.createElement("button");
        const button = document.createElement("button");
        const editIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const editUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");

        item.className = "category-item";
        dot.className = "category-dot";
        dot.style.setProperty("--category-color", category.color);
        name.textContent = category.name;
        editButton.className = "icon-button subtle";
        editButton.type = "button";
        editButton.setAttribute("aria-label", `Изменить категорию ${category.name}`);
        editIcon.classList.add("ui-icon");
        editUse.setAttribute("href", "#icon-edit");
        editIcon.appendChild(editUse);
        editButton.appendChild(editIcon);
        editButton.addEventListener("click", () => fillCategoryForm(category));
        button.className = "icon-button subtle";
        button.type = "button";
        button.setAttribute("aria-label", "Удалить категорию");
        icon.classList.add("ui-icon");
        use.setAttribute("href", "#icon-trash");
        icon.appendChild(use);
        button.appendChild(icon);
        button.addEventListener("click", () => deleteCategory(category.id));
        item.append(dot, name, editButton, button);
        ctx.els.categoryList.appendChild(item);
      });
    }

    function saveCategoryFromForm(event) {
      event.preventDefault();
      const name = ctx.cleanText(ctx.els.categoryName.value);
      if (!name) return;
      const editingId = ctx.els.categoryId?.value || "";
      const existing = ctx.getState().categories.find((category) => category.id !== editingId && category.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        ctx.showToast("Такая категория уже есть");
        return;
      }
      const undo = ctx.createUndoSnapshot();

      const now = new Date().toISOString();
      const editing = ctx.getState().categories.find((category) => category.id === editingId);
      if (editing) {
        editing.name = name;
        editing.color = ctx.els.categoryColor.value || editing.color;
        editing.updatedAt = now;
      } else {
        ctx.getState().categories.push({ id: ctx.createId(), name, color: ctx.els.categoryColor.value || "#00a78e", createdAt: now, updatedAt: now });
      }
      resetCategoryForm();
      ctx.saveState();
      renderCategories();
      ctx.showToast(editing ? "Категория обновлена" : "Категория создана", { undo });
    }

    function fillCategoryForm(category) {
      if (ctx.els.categoryId) ctx.els.categoryId.value = category.id;
      ctx.els.categoryName.value = category.name;
      ctx.els.categoryColor.value = category.color;
      ctx.els.categoryName.focus();
    }

    function resetCategoryForm() {
      ctx.els.categoryForm.reset();
      if (ctx.els.categoryId) ctx.els.categoryId.value = "";
      ctx.els.categoryColor.value = "#00a78e";
    }

    async function deleteCategory(categoryId) {
      const state = ctx.getState();
      const category = state.categories.find((item) => item.id === categoryId);
      const taskCount = state.tasks.filter((task) => task.categoryId === categoryId).length;
      const message = taskCount
        ? `Удалить категорию «${category?.name || "Без названия"}»? У ${taskCount} задач категория будет очищена.`
        : `Удалить категорию «${category?.name || "Без названия"}»?`;
      const confirmed = await ctx.confirmAction({
            confirmLabel: "Удалить",
            message,
            tone: "danger",
            title: "Удалить категорию?",
          });
      if (!confirmed) return;

      const undo = ctx.createUndoSnapshot();
      state.tombstones ||= {
        tasks: {}, habits: {}, goals: {}, categories: {}, journalEntries: {},
        nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {},
      };
      state.tombstones.categories ||= {};
      state.tombstones.categories[categoryId] = new Date().toISOString();
      const hasTasks = state.tasks.some((task) => task.categoryId === categoryId);
      state.categories = state.categories.filter((category) => category.id !== categoryId);
      if (hasTasks) {
        state.tasks.forEach((task) => {
          if (task.categoryId === categoryId) {
            task.categoryId = "";
            task.updatedAt = new Date().toISOString();
          }
        });
      }
      if (ctx.getTaskCategoryFilter() === categoryId) ctx.setTaskCategoryFilter("all");
      if (ctx.getArchiveCategoryFilter() === categoryId) ctx.setArchiveCategoryFilter("all");
      ctx.saveState();
      ctx.saveUiState();
      ctx.render();
      ctx.showToast("Категория удалена", { undo });
    }

    return {
      deleteCategory,
      renderCategories,
      saveCategoryFromForm,
    };
  }

  global.RhythmCategories = { createCategories };
})(window);
