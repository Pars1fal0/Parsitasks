(function (global) {
  const TYPE_LABELS = {
    breakfast: "Завтрак",
    snack: "Перекус",
    lunch: "Обед",
    dinner: "Ужин",
    other: "Другое",
  };

  function createNutritionView(ctx) {
    const local = global.RhythmWorkspaceLocal.createWorkspaceLocal({ getUserId: ctx.getUserId,
      onError: () => ctx.showToast("Не удалось сохранить изменения на этом устройстве") });
    const draftStatus = document.querySelector("#nutritionMealDraftStatus");
    const discardDraftButton = document.querySelector("#nutritionMealDiscardDraft");
    let owner = local.owner();
    const compactQuery = global.matchMedia("(max-width: 820px)");
    const period = () => local.read("nutrition-period", compactQuery.matches ? "day" : "week");
    const mealStatus = () => local.read("nutrition-status", "");
    const mealDraft = local.formDraft(ctx.els.nutritionMealForm,
      () => `meal-draft:${ctx.els.nutritionMealId.value || "new"}`, (saved) => {
        draftStatus.textContent = saved ? "Черновик сохранён на этом устройстве" : "Черновик не сохранён";
        discardDraftButton.hidden = !saved;
      });

    function bindEvents() {
      mealDraft.bind();
      discardDraftButton.addEventListener("click", async () => {
        closeMealForm();
        const confirmed = await ctx.confirmAction({ title: "Удалить черновик блюда?", confirmLabel: "Удалить", tone: "danger" });
        if (!confirmed || !mealDraft.clear()) {
          ctx.els.nutritionMealDialog.showModal();
          discardDraftButton.focus();
        }
      });
      ctx.els.nutritionMealDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeMealForm(); });
      ctx.els.nutritionMealDialog.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        closeMealForm();
      });
      compactQuery.addEventListener("change", render);
      document.querySelectorAll("[data-nutrition-period]").forEach((button) => button.addEventListener("click", () => {
        local.write("nutrition-period", button.dataset.nutritionPeriod);
        render();
      }));
      document.querySelectorAll("[data-nutrition-status]").forEach((button) => button.addEventListener("click", () => {
        local.write("nutrition-status", button.dataset.nutritionStatus);
        render();
      }));
      ctx.els.nutritionPrevWeek?.addEventListener("click", () => shiftWeek(period() === "day" ? -1 : -7));
      ctx.els.nutritionNextWeek?.addEventListener("click", () => shiftWeek(period() === "day" ? 1 : 7));
      ctx.els.nutritionCurrentWeek?.addEventListener("click", () => ctx.setActiveDate(ctx.today()));
      ctx.els.nutritionAddMeal?.addEventListener("click", () => openMealForm());
      ctx.els.nutritionEmptyAction?.addEventListener("click", () => openMealForm());
      ctx.els.nutritionMealClose?.addEventListener("click", closeMealForm);
      ctx.els.nutritionMealCancel?.addEventListener("click", closeMealForm);
      ctx.els.nutritionMealForm?.addEventListener("submit", saveMeal);
      ctx.els.nutritionMealIngredients.addEventListener("input", () => {
        ctx.els.nutritionMealIngredients.setCustomValidity("");
        document.querySelector("#nutritionIngredientsError").textContent = "";
      });
      ctx.els.nutritionFoodForm?.addEventListener("submit", saveFood);
      ctx.els.nutritionTargetsForm?.addEventListener("submit", saveTargets);
      ctx.els.nutritionMealDialog?.addEventListener("click", (event) => {
        if (event.target === ctx.els.nutritionMealDialog) closeMealForm();
      });
      document.addEventListener("click", (event) => {
        if (event.target.closest?.(".nutrition-meal-card")) return;
        document.querySelectorAll(".nutrition-meal-card.is-menu-open")
          .forEach((card) => card.classList.remove("is-menu-open"));
      });
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        document.querySelectorAll(".nutrition-meal-card.is-menu-open")
          .forEach((card) => card.classList.remove("is-menu-open"));
      });
    }

    function render() {
      if (owner !== local.owner()) {
        ctx.els.nutritionMealDialog.close();
        ctx.els.nutritionMealForm.reset();
        ctx.els.nutritionMealId.value = "";
        owner = local.owner();
      }
      const state = ctx.getState();
      const week = ctx.model.nutritionWeek(state.nutritionMeals, ctx.getActiveDate(), ctx.getFirstDayOfWeek());
      const dayMode = period() === "day";
      const dates = dayMode ? [ctx.getActiveDate()] : week.days;
      const status = mealStatus();
      document.querySelectorAll("[data-nutrition-period]").forEach((button) => {
        const active = button.dataset.nutritionPeriod === period();
        button.setAttribute("aria-pressed", String(active)); button.classList.toggle("is-active", active);
      });
      document.querySelectorAll("[data-nutrition-status]").forEach((button) => {
        const active = button.dataset.nutritionStatus === status;
        button.setAttribute("aria-pressed", String(active)); button.classList.toggle("is-active", active);
      });
      ctx.els.nutritionWeekLabel.textContent = dayMode ? ctx.formatDate(ctx.getActiveDate()) : `${ctx.formatDate(week.start)} — ${ctx.formatDate(week.end)}`;
      ctx.els.nutritionWeekLabel.hidden = dayMode;
      ctx.els.nutritionPrevWeek.setAttribute("aria-label", dayMode ? "Предыдущий день" : "Предыдущая неделя");
      ctx.els.nutritionNextWeek.setAttribute("aria-label", dayMode ? "Следующий день" : "Следующая неделя");
      ctx.els.nutritionCurrentWeek.textContent = dayMode ? "Сегодня" : "Эта неделя";
      ctx.els.nutritionCurrentWeek.closest(".segmented-control").hidden = dayMode;
      const weekMeals = week.days.flatMap((date) => week.byDate[date]);
      const meals = dates.flatMap((date) => week.byDate[date]).filter((meal) => !status || meal.status === status);
      const info = ctx.model.mealsNutritionInfo(meals, state.nutritionFoods);
      const summary = info.values;
      const targets = state.nutritionSettings?.targets || {};
      const multiplier = dates.length;
      setMetric("nutritionCaloriesMetric", summary.calories, Number(targets.calories) * multiplier, "ккал", info);
      setMetric("nutritionProteinMetric", summary.protein, Number(targets.protein) * multiplier, "г", info);
      setMetric("nutritionFatMetric", summary.fat, Number(targets.fat) * multiplier, "г", info);
      setMetric("nutritionCarbsMetric", summary.carbs, Number(targets.carbs) * multiplier, "г", info);
      const metrics = document.querySelector(".nutrition-metrics");
      metrics.setAttribute("aria-label", `${status ? "Съедено" : "План и съедено"} ${dayMode ? "за выбранный день" : "за выбранную неделю"}`);
      const note = document.querySelector("#nutritionCalculationNote");
      note.hidden = info.status === "complete" || !meals.some((meal) => meal.status !== "skipped");
      note.textContent = info.status === "unknown" ? "Нет данных для расчёта калорий и БЖУ."
        : `Неполный расчёт: блюд без полных данных ${info.incomplete}.`;
      ctx.els.nutritionEmpty.hidden = meals.length > 0;
      document.querySelector("#nutritionEmptyTitle").textContent = status ? "Съеденных блюд пока нет"
        : dayMode ? "На этот день пока нет блюд" : "На этой неделе пока нет блюд";
      ctx.els.nutritionWeekBoard.classList.toggle("is-empty", meals.length === 0);
      ctx.els.nutritionWeekBoard.classList.toggle("is-day", dayMode);
      renderWeek(week, state, dates, status);
      renderShopping(weekMeals, week.start);
      renderTargets(state.nutritionSettings);
      renderFoods(state.nutritionFoods);
    }

    function renderWeek(week, state, dates, status) {
      replaceChildren(ctx.els.nutritionWeekBoard, dates.map((date) => {
        const column = element("section", "nutrition-day-column");
        column.dataset.date = date;
        column.addEventListener("dragover", (event) => {
          event.preventDefault();
          column.classList.add("is-drop-target");
        });
        column.addEventListener("dragleave", () => column.classList.remove("is-drop-target"));
        column.addEventListener("drop", (event) => {
          event.preventDefault();
          column.classList.remove("is-drop-target");
          const mealId = event.dataTransfer?.getData("application/x-nutrition-meal");
          if (mealId) ctx.moveMeal(mealId, date);
        });
        const heading = element("header", "nutrition-day-heading");
        heading.append(text("span", ctx.formatWeekday(date)), text("strong", ctx.formatDay(date)));
        const addButton = iconButton("icon-plus", `Добавить блюдо на ${ctx.formatDate(date)}`);
        addButton.addEventListener("click", () => openMealForm(null, date));
        heading.append(addButton);
        column.append(heading);
        const grouped = new Map();
        const visibleMeals = (week.byDate[date] || []).filter((meal) => !status || meal.status === status);
        visibleMeals.forEach((meal) => {
          const list = grouped.get(meal.type) || [];
          list.push(meal);
          grouped.set(meal.type, list);
        });
        ctx.model.MEAL_TYPES.forEach((type) => {
          const meals = grouped.get(type);
          if (!meals?.length) return;
          const group = element("div", "nutrition-meal-group");
          group.append(text("span", TYPE_LABELS[type], "nutrition-meal-group-label"));
          meals.forEach((meal) => group.append(renderMeal(meal, state)));
          column.append(group);
        });
        if (!visibleMeals.length) column.append(text("p", status ? "Нет съеденных блюд" : "Нет блюд", "nutrition-day-empty"));
        return column;
      }));
    }

    function renderMeal(meal, state) {
      const card = element("article", `nutrition-meal-card is-${meal.status}`);
      card.draggable = true;
      card.dataset.mealId = meal.id;
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("application/x-nutrition-meal", meal.id);
        event.dataTransfer.effectAllowed = "move";
        card.classList.add("is-dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
      const top = element("div", "nutrition-meal-top");
      top.append(text("time", meal.time || TYPE_LABELS[meal.type]));
      const menu = iconButton("icon-more", `Действия: ${meal.title}`);
      menu.addEventListener("click", () => card.classList.toggle("is-menu-open"));
      top.append(menu);
      card.append(top, text("strong", meal.title));
      if (meal.status !== "planned") card.append(text("small", meal.status === "eaten" ? "Съедено" : "Пропущено", "nutrition-meal-status"));
      const info = ctx.model.mealNutritionInfo(meal, state.nutritionFoods);
      const values = info.values;
      card.append(text(
        "small",
        info.status === "unknown" ? "Калории и БЖУ не рассчитаны"
          : `${Math.round(values.calories)} ккал · Б ${round(values.protein)} · Ж ${round(values.fat)} · У ${round(values.carbs)}${info.status === "partial" ? ` · Неполный расчёт: без данных ${info.missing}` : ""}`,
      ));
      const actions = element("div", "nutrition-meal-actions");
      const eaten = actionButton(meal.status === "eaten" ? "Вернуть в план" : "Съедено");
      eaten.addEventListener("click", () => ctx.setMealStatus(meal.id, meal.status === "eaten" ? "planned" : "eaten"));
      const skipped = actionButton(meal.status === "skipped" ? "Вернуть в план" : "Пропустить");
      skipped.addEventListener("click", () => ctx.setMealStatus(meal.id, meal.status === "skipped" ? "planned" : "skipped"));
      const edit = actionButton("Изменить");
      edit.addEventListener("click", () => openMealForm(meal));
      const duplicate = actionButton("Дублировать");
      duplicate.addEventListener("click", () => ctx.duplicateMeal(meal.id));
      const remove = actionButton("Удалить", "is-danger");
      remove.addEventListener("click", () => ctx.deleteMeal(meal.id));
      actions.append(eaten, skipped, edit, duplicate, remove);
      card.append(actions);
      return card;
    }

    function renderShopping(meals, weekStart) {
      const items = ctx.model.buildShoppingList(meals);
      const purchases = local.read(`shopping:${weekStart}`, {});
      ctx.els.nutritionShoppingCount.textContent = String(items.length);
      if (!items.length) {
        replaceChildren(ctx.els.nutritionShoppingList, [text("p", "Список пуст", "muted")]);
        return;
      }
      replaceChildren(ctx.els.nutritionShoppingList, items.map((item) => {
        const label = element("label", "nutrition-shopping-item");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        const key = JSON.stringify([item.foodId || item.name.toLocaleLowerCase("ru-RU"), item.unit]);
        checkbox.checked = Number(purchases[key]) >= item.quantity && Object.hasOwn(purchases, key);
        checkbox.addEventListener("change", () => {
          const latest = local.read(`shopping:${weekStart}`, {});
          if (checkbox.checked) latest[key] = item.quantity;
          else delete latest[key];
          if (!local.write(`shopping:${weekStart}`, latest)) checkbox.checked = !checkbox.checked;
        });
        label.append(checkbox, text("span", item.name), text("strong", `${round(item.quantity)} ${item.unit}`));
        return label;
      }));
    }

    function renderTargets(settings) {
      const targets = settings?.targets || {};
      ctx.els.nutritionTargetCalories.value = targets.calories || "";
      ctx.els.nutritionTargetProtein.value = targets.protein || "";
      ctx.els.nutritionTargetFat.value = targets.fat || "";
      ctx.els.nutritionTargetCarbs.value = targets.carbs || "";
      ctx.els.nutritionPaused.checked = settings?.paused === true;
      ctx.els.nutritionView?.classList.toggle("is-paused", settings?.paused === true);
    }

    function renderFoods(foods) {
      ctx.els.nutritionFoodCount.textContent = String(foods.length);
      if (!foods.length) {
        replaceChildren(ctx.els.nutritionFoodList, [text("p", "Личных продуктов пока нет", "muted")]);
        return;
      }
      replaceChildren(ctx.els.nutritionFoodList, foods
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name, "ru-RU"))
        .map((food) => {
          const row = element("div", "nutrition-food-item");
          const body = element("span");
          body.append(text("strong", food.name), text("small", food.nutritionKnown === false ? "Нет данных о калориях"
            : `${food.calories} ккал · Б ${food.protein} · Ж ${food.fat} · У ${food.carbs}`));
          const edit = iconButton("icon-edit", `Изменить ${food.name}`);
          edit.addEventListener("click", () => fillFoodForm(food));
          const remove = iconButton("icon-trash", `Удалить ${food.name}`);
          remove.addEventListener("click", () => ctx.deleteFood(food.id));
          row.append(body, edit, remove);
          return row;
        }));
    }

    function openMealForm(meal = null, date = "") {
      const target = meal || {};
      ctx.els.nutritionMealHeading.textContent = meal ? "Изменить блюдо" : "Новое блюдо";
      ctx.els.nutritionMealId.value = target.id || "";
      ctx.els.nutritionMealTitle.value = target.title || "";
      ctx.els.nutritionMealDate.value = target.date || date || ctx.getActiveDate();
      ctx.els.nutritionMealType.value = target.type || "breakfast";
      ctx.els.nutritionMealTime.value = target.time || "";
      ctx.els.nutritionMealServings.value = target.servings || 1;
      ctx.els.nutritionMealIngredients.value = ctx.model.formatIngredientsText(target.ingredients);
      ctx.els.nutritionMealIngredients.setCustomValidity("");
      document.querySelector("#nutritionIngredientsError").textContent = "";
      ctx.els.nutritionMealCalories.value = target.manualCaloriesKnown === false ? ""
        : target.manualNutrition ? target.nutrition?.calories ?? "" : target.nutrition?.calories || "";
      ctx.els.nutritionMealProtein.value = target.manualNutrition ? target.nutrition?.protein ?? "" : target.nutrition?.protein || "";
      ctx.els.nutritionMealFat.value = target.manualNutrition ? target.nutrition?.fat ?? "" : target.nutrition?.fat || "";
      ctx.els.nutritionMealCarbs.value = target.manualNutrition ? target.nutrition?.carbs ?? "" : target.nutrition?.carbs || "";
      ctx.els.nutritionMealNotes.value = target.notes || "";
      const restored = mealDraft.restore();
      draftStatus.textContent = restored ? "Восстановлен черновик на этом устройстве" : "";
      discardDraftButton.hidden = !restored;
      ctx.els.nutritionMealDialog.showModal();
      global.setTimeout(() => ctx.els.nutritionMealTitle.focus(), 0);
    }

    function closeMealForm() {
      ctx.els.nutritionMealDialog.close();
    }

    function saveMeal(event) {
      event.preventDefault();
      const state = ctx.getState();
      const parsed = ctx.model.parseIngredientsInput(ctx.els.nutritionMealIngredients.value, { foods: state.nutritionFoods, createId: ctx.createId });
      if (parsed.errors.length) {
        document.querySelector("#nutritionIngredientsError").textContent = parsed.errors.join(" ");
        ctx.els.nutritionMealIngredients.setCustomValidity(parsed.errors[0]);
        ctx.els.nutritionMealIngredients.reportValidity();
        ctx.els.nutritionMealIngredients.focus();
        return;
      }
      const existing = state.nutritionMeals.find((meal) => meal.id === ctx.els.nutritionMealId.value);
      const result = ctx.saveMeal({
        id: ctx.els.nutritionMealId.value,
        title: ctx.els.nutritionMealTitle.value,
        date: ctx.els.nutritionMealDate.value,
        type: ctx.els.nutritionMealType.value,
        time: ctx.els.nutritionMealTime.value,
        servings: ctx.els.nutritionMealServings.value,
        ingredients: parsed.ingredients,
        nutrition: {
          calories: ctx.els.nutritionMealCalories.value,
          protein: ctx.els.nutritionMealProtein.value,
          fat: ctx.els.nutritionMealFat.value,
          carbs: ctx.els.nutritionMealCarbs.value,
        },
        manualNutrition: [ctx.els.nutritionMealCalories, ctx.els.nutritionMealProtein, ctx.els.nutritionMealFat, ctx.els.nutritionMealCarbs]
          .some((field) => field.value !== ""),
        manualCaloriesKnown: ctx.els.nutritionMealCalories.value !== "",
        notes: ctx.els.nutritionMealNotes.value,
        status: existing?.status || "planned",
        createdAt: existing?.createdAt,
      });
      if (result !== false) {
        mealDraft.clear();
        draftStatus.textContent = "";
        discardDraftButton.hidden = true;
        closeMealForm();
      }
    }

    function saveFood(event) {
      event.preventDefault();
      ctx.saveFood({
        id: ctx.els.nutritionFoodId.value,
        name: ctx.els.nutritionFoodName.value,
        unit: ctx.els.nutritionFoodUnit.value,
        calories: ctx.els.nutritionFoodCalories.value,
        protein: ctx.els.nutritionFoodProtein.value,
        fat: ctx.els.nutritionFoodFat.value,
        carbs: ctx.els.nutritionFoodCarbs.value,
      });
      event.target.reset();
      ctx.els.nutritionFoodId.value = "";
      ctx.els.nutritionFoodUnit.value = "г";
    }

    function fillFoodForm(food) {
      ctx.els.nutritionFoodId.value = food.id;
      ctx.els.nutritionFoodName.value = food.name;
      ctx.els.nutritionFoodUnit.value = food.unit;
      ctx.els.nutritionFoodCalories.value = food.nutritionKnown === false ? "" : food.calories;
      ctx.els.nutritionFoodProtein.value = food.protein;
      ctx.els.nutritionFoodFat.value = food.fat;
      ctx.els.nutritionFoodCarbs.value = food.carbs;
      ctx.els.nutritionFoodName.focus();
    }

    function saveTargets(event) {
      event.preventDefault();
      ctx.saveSettings({
        targets: {
          calories: ctx.els.nutritionTargetCalories.value,
          protein: ctx.els.nutritionTargetProtein.value,
          fat: ctx.els.nutritionTargetFat.value,
          carbs: ctx.els.nutritionTargetCarbs.value,
        },
        paused: ctx.els.nutritionPaused.checked,
      });
    }

    function shiftWeek(days) {
      ctx.setActiveDate(ctx.model.addDays(ctx.getActiveDate(), days));
    }

    function setMetric(id, value, target, unit, info) {
      const current = Number(value) || 0;
      const metric = ctx.els[id];
      metric.textContent = info.status === "unknown" ? "—" : `${round(current)}${info.status === "partial" ? "+" : ""}`;
      const detail = metric.parentElement?.querySelector("small");
      if (!detail) return;
      if (info.status !== "complete") {
        detail.textContent = unit;
        metric.parentElement.removeAttribute("data-progress");
        return;
      }
      if (!(target > 0)) {
        detail.textContent = unit;
        metric.parentElement.removeAttribute("data-progress");
        return;
      }
      const delta = Math.round(Math.abs(target - current));
      const status = current <= target ? `осталось ${formatNumber(delta)}` : `превышение ${formatNumber(delta)}`;
      detail.textContent = `из ${formatNumber(target)} ${unit} · ${status}`;
      metric.parentElement.dataset.progress = current > target ? "over" : "within";
    }

    return { bindEvents, openMealForm, render };
  }

  function actionButton(label, className = "") {
    const button = text("button", label, `nutrition-action ${className}`.trim());
    button.type = "button";
    return button;
  }

  function formatNumber(value) {
    return Math.round(Number(value) || 0).toLocaleString("ru-RU");
  }

  function iconButton(icon, label) {
    const button = element("button", "icon-button compact-icon-button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ui-icon");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${icon}`);
    svg.append(use);
    button.append(svg);
    return button;
  }

  function element(tagName, className = "") {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    return node;
  }

  function text(tagName, value, className = "") {
    const node = element(tagName, className);
    node.textContent = value;
    return node;
  }

  function replaceChildren(elementNode, children) {
    elementNode.replaceChildren(...children);
  }

  function round(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  }

  const api = { TYPE_LABELS, createNutritionView };
  global.RhythmNutritionView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
