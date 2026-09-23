(function (global) {
  const TYPE_LABELS = {
    task: "Задача",
    habit: "Привычка",
    goal: "Цель",
    journal: "Дневник",
    nutrition: "Питание",
    archive: "Архив",
  };

  function searchWorkspace(state = {}, query = "", options = {}) {
    const search = normalizeQuery(query);
    if (!search) return [];
    const categoryById = new Map((state.categories || []).map((item) => [item.id, item.name]));
    const results = [];

    (state.tasks || []).forEach((task) => {
      const category = categoryById.get(task.categoryId) || "";
      if (!matches(`${task.title} ${category}`, search)) return;
      if (task.completed?.[task.date] !== true) {
        results.push({
          id: task.id,
          type: "task",
          title: task.title,
          detail: [task.date, category, task.repeat !== "none" ? "Повтор" : ""].filter(Boolean).join(" · "),
          date: task.date,
          view: "tasks",
        });
      }
      Object.entries(task.completed || {}).forEach(([date, completed]) => {
        if (completed !== true) return;
        results.push({
          id: `${task.id}:${date}`,
          type: "archive",
          title: task.title,
          detail: [date, category, "Выполнено"].filter(Boolean).join(" · "),
          date,
          view: "archive",
        });
      });
    });
    (state.habits || []).forEach((habit) => {
      if (!matches(`${habit.title} ${habit.unit || ""}`, search)) return;
      results.push({
        id: habit.id,
        type: "habit",
        title: habit.title,
        detail: habit.archived ? "Приостановлена" : "Активна",
        date: habit.startDate,
        view: "habits",
      });
    });
    (state.goals || []).forEach((goal) => {
      const steps = (goal.steps || []).map((step) => step.title).join(" ");
      if (!matches(`${goal.title} ${goal.why || ""} ${steps}`, search)) return;
      results.push({
        id: goal.id,
        type: "goal",
        title: goal.title,
        detail: [goal.dueDate, goal.status === "done" ? "Выполнена" : ""].filter(Boolean).join(" · "),
        date: goal.dueDate,
        view: "goals",
      });
    });
    (state.journalEntries || []).forEach((entry) => {
      if (!matches(entry.text, search)) return;
      results.push({
        id: entry.id,
        type: "journal",
        title: `Запись за ${options.formatDate?.(entry.date) || entry.date}`,
        detail: excerptAround(entry.text, search),
        date: entry.date,
        view: "journal",
      });
    });
    (state.nutritionMeals || []).forEach((meal) => {
      const ingredients = (meal.ingredients || []).map((item) => item.name).join(" ");
      if (!matches(`${meal.title} ${ingredients} ${meal.notes || ""}`, search)) return;
      results.push({
        id: meal.id,
        type: "nutrition",
        title: meal.title,
        detail: [meal.date, meal.time].filter(Boolean).join(" · "),
        date: meal.date,
        view: "nutrition",
      });
    });
    (state.nutritionFoods || []).forEach((food) => {
      if (!matches(food.name, search)) return;
      results.push({
        id: food.id,
        type: "nutrition",
        title: food.name,
        detail: `${food.calories || 0} ккал на 100 ${food.unit || "г"}`,
        view: "nutrition",
      });
    });
    return results.slice(0, options.limit || 40);
  }

  function createGlobalSearch(ctx) {
    let results = [];
    let activeIndex = -1;

    function bindEvents() {
      ctx.els.globalSearchButton?.addEventListener("click", open);
      ctx.els.globalSearchClose?.addEventListener("click", close);
      ctx.els.globalSearchInput?.addEventListener("input", () => {
        activeIndex = -1;
        render();
      });
      ctx.els.globalSearchInput?.addEventListener("keydown", handleInputKeydown);
      ctx.els.globalSearchDialog?.addEventListener("click", (event) => {
        if (event.target === ctx.els.globalSearchDialog) close();
      });
      global.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          open();
        }
      });
    }

    function open() {
      ctx.els.globalSearchDialog.showModal();
      ctx.els.globalSearchInput.value = "";
      results = [];
      activeIndex = -1;
      render();
      global.setTimeout(() => ctx.els.globalSearchInput.focus(), 0);
    }

    function close() {
      ctx.els.globalSearchDialog.close();
    }

    function render() {
      const query = ctx.els.globalSearchInput.value;
      results = ctx.search(ctx.getState(), query, {
        formatDate: ctx.formatDate,
        limit: 40,
      });
      activeIndex = results.length ? Math.min(Math.max(activeIndex, 0), results.length - 1) : -1;
      if (!query.trim()) {
        replaceChildren(ctx.els.globalSearchResults, [message("Начни вводить название или текст")]);
        return;
      }
      if (!results.length) {
        replaceChildren(ctx.els.globalSearchResults, [message("Ничего не найдено")]);
        return;
      }
      replaceChildren(ctx.els.globalSearchResults, results.map((result, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "global-search-result";
        button.classList.toggle("is-active", index === activeIndex);
        const type = document.createElement("span");
        type.className = `global-search-type is-${result.type}`;
        type.textContent = TYPE_LABELS[result.type] || result.type;
        const body = document.createElement("span");
        body.className = "global-search-result-body";
        body.append(textNode("strong", result.title));
        body.append(textNode("small", result.detail || "Без дополнительных данных"));
        button.append(type, body);
        button.addEventListener("click", () => {
          close();
          ctx.openResult(result);
        });
        return button;
      }));
    }

    function handleInputKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (!results.length || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Enter") {
        const result = results[activeIndex];
        if (!result) return;
        close();
        ctx.openResult(result);
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      activeIndex = (activeIndex + direction + results.length) % results.length;
      render();
      ctx.els.globalSearchResults.children[activeIndex]?.scrollIntoView?.({ block: "nearest" });
    }

    return { bindEvents, close, open, render };
  }

  function normalizeQuery(value) {
    return String(value || "").trim().toLocaleLowerCase("ru-RU");
  }

  function matches(value, query) {
    const haystack = String(value || "").toLocaleLowerCase("ru-RU");
    return query.split(/\s+/).every((token) => haystack.includes(token));
  }

  function excerpt(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > 100 ? `${text.slice(0, 97)}...` : text;
  }

  function excerptAround(value, query) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const firstToken = normalizeQuery(query).split(/\s+/).find(Boolean) || "";
    const index = text.toLocaleLowerCase("ru-RU").indexOf(firstToken);
    if (index < 0 || text.length <= 100) return excerpt(text);
    const start = Math.max(0, index - 35);
    const end = Math.min(text.length, start + 100);
    return `${start ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
  }

  function textNode(tagName, text) {
    const element = document.createElement(tagName);
    element.textContent = text;
    return element;
  }

  function message(text) {
    const element = textNode("p", text);
    element.className = "global-search-empty";
    return element;
  }

  function replaceChildren(element, children) {
    element.replaceChildren(...children);
  }

  const api = { createGlobalSearch, excerptAround, searchWorkspace };
  global.RhythmGlobalSearch = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
