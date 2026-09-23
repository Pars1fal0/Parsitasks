(function (global) {
  const TYPE_LABELS = {
    breakfast: "Завтрак",
    snack: "Перекус",
    lunch: "Обед",
    dinner: "Ужин",
    other: "Другое",
  };

  function createNutritionView(ctx) {
    function bindEvents() {
      ctx.els.nutritionPrevWeek?.addEventListener("click", () => shiftWeek(-7));
      ctx.els.nutritionNextWeek?.addEventListener("click", () => shiftWeek(7));
      ctx.els.nutritionCurrentWeek?.addEventListener("click", () => ctx.setActiveDate(ctx.today()));
      ctx.els.nutritionAddMeal?.addEventListener("click", () => openMealForm());
      ctx.els.nutritionEmptyAction?.addEventListener("click", () => openMealForm());
      ctx.els.nutritionMealClose?.addEventListener("click", closeMealForm);
      ctx.els.nutritionMealCancel?.addEventListener("click", closeMealForm);
      ctx.els.nutritionMealForm?.addEventListener("submit", saveMeal);
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
      const state = ctx.getState();
      const week = ctx.model.nutritionWeek(state.nutritionMeals, ctx.getActiveDate(), ctx.getFirstDayOfWeek());
      ctx.els.nutritionWeekLabel.textContent = `${ctx.formatDate(week.start)} — ${ctx.formatDate(week.end)}`;
      const meals = week.days.flatMap((date) => week.byDate[date]);
      const summary = ctx.model.summarizeMeals(meals, state.nutritionFoods);
      const targets = state.nutritionSettings?.targets || {};
      setMetric("nutritionCaloriesMetric", summary.calories, Number(targets.calories) * 7, "ккал");
      setMetric("nutritionProteinMetric", summary.protein, Number(targets.protein) * 7, "г");
      setMetric("nutritionFatMetric", summary.fat, Number(targets.fat) * 7, "г");
      setMetric("nutritionCarbsMetric", summary.carbs, Number(targets.carbs) * 7, "г");
      ctx.els.nutritionEmpty.hidden = meals.length > 0;
      ctx.els.nutritionWeekBoard.classList.toggle("is-empty", meals.length === 0);
      renderWeek(week, state);
      renderShopping(meals);
      renderTargets(state.nutritionSettings);
      renderFoods(state.nutritionFoods);
    }

    function renderWeek(week, state) {
      replaceChildren(ctx.els.nutritionWeekBoard, week.days.map((date) => {
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
        (week.byDate[date] || []).forEach((meal) => {
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
        if (!(week.byDate[date] || []).length) column.append(text("p", "Нет блюд", "nutrition-day-empty"));
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
      const values = ctx.model.calculateMealNutrition(meal, state.nutritionFoods);
      card.append(text(
        "small",
        `${Math.round(values.calories)} ккал · Б ${round(values.protein)} · Ж ${round(values.fat)} · У ${round(values.carbs)}`,
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

    function renderShopping(meals) {
      const items = ctx.model.buildShoppingList(meals);
      ctx.els.nutritionShoppingCount.textContent = String(items.length);
      if (!items.length) {
        replaceChildren(ctx.els.nutritionShoppingList, [text("p", "Список пуст", "muted")]);
        return;
      }
      replaceChildren(ctx.els.nutritionShoppingList, items.map((item) => {
        const label = element("label", "nutrition-shopping-item");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
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
          body.append(text("strong", food.name), text("small", `${food.calories} ккал · Б ${food.protein} · Ж ${food.fat} · У ${food.carbs}`));
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
      ctx.els.nutritionMealCalories.value = target.nutrition?.calories || "";
      ctx.els.nutritionMealProtein.value = target.nutrition?.protein || "";
      ctx.els.nutritionMealFat.value = target.nutrition?.fat || "";
      ctx.els.nutritionMealCarbs.value = target.nutrition?.carbs || "";
      ctx.els.nutritionMealNotes.value = target.notes || "";
      ctx.els.nutritionMealDialog.showModal();
      global.setTimeout(() => ctx.els.nutritionMealTitle.focus(), 0);
    }

    function closeMealForm() {
      ctx.els.nutritionMealDialog.close();
    }

    function saveMeal(event) {
      event.preventDefault();
      const state = ctx.getState();
      const existing = state.nutritionMeals.find((meal) => meal.id === ctx.els.nutritionMealId.value);
      const result = ctx.saveMeal({
        id: ctx.els.nutritionMealId.value,
        title: ctx.els.nutritionMealTitle.value,
        date: ctx.els.nutritionMealDate.value,
        type: ctx.els.nutritionMealType.value,
        time: ctx.els.nutritionMealTime.value,
        servings: ctx.els.nutritionMealServings.value,
        ingredients: ctx.model.parseIngredientsText(ctx.els.nutritionMealIngredients.value, {
          foods: state.nutritionFoods,
          createId: ctx.createId,
        }),
        nutrition: {
          calories: ctx.els.nutritionMealCalories.value,
          protein: ctx.els.nutritionMealProtein.value,
          fat: ctx.els.nutritionMealFat.value,
          carbs: ctx.els.nutritionMealCarbs.value,
        },
        notes: ctx.els.nutritionMealNotes.value,
        status: existing?.status || "planned",
        createdAt: existing?.createdAt,
      });
      if (result !== false) closeMealForm();
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
      ctx.els.nutritionFoodCalories.value = food.calories;
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

    function setMetric(id, value, target, unit) {
      const current = Number(value) || 0;
      const metric = ctx.els[id];
      metric.textContent = round(current);
      const detail = metric.parentElement?.querySelector("small");
      if (!detail) return;
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
