(function (global) {
  function createStateNormalizer(config) {
    const pruneTombstones = config.pruneTombstones || ((value) => value);

    function normalizeState(raw) {
      const normalized = {
        schemaVersion: config.schemaVersion,
        defaultsSeeded: raw?.defaultsSeeded === true,
        profile: config.normalizeProfile?.(raw?.profile) || {},
        tasks: [],
        habits: [],
        goals: [],
        boardItems: [],
        journalEntries: [],
        nutritionFoods: [],
        nutritionMeals: [],
        nutritionTemplates: [],
        nutritionSettings: config.normalizeNutritionSettings?.(),
        googleCalendarLinks: normalizeGoogleCalendarLinks(raw?.googleCalendarLinks, config),
        categories: [],
        taskOrder: {},
        mcpActivity: config.normalizeMcpActivity?.(raw?.mcpActivity) || [],
        tombstones: pruneTombstones(normalizeTombstones(raw?.tombstones)),
        syncMeta: config.normalizeSyncMeta?.(raw?.syncMeta) || {},
      };

      if (!raw || typeof raw !== "object") return normalized;

      const categoryAliases = new Map();
      const categoryGroups = new Map();
      const rawCategories = Array.isArray(raw.categories) ? raw.categories : [];
      normalized.defaultsSeeded ||= rawCategories.length > 0 || Object.keys(normalized.tombstones.categories).length > 0;
      rawCategories.forEach((category) => {
        const normalizedCategory = {
          id: category.id || config.createId(),
          name: config.cleanText(category.name) || "Категория",
          color: config.sanitizeColor(category.color) || config.randomCategoryColor(),
          createdAt: category.createdAt || new Date().toISOString(),
          updatedAt: category.updatedAt || category.createdAt || new Date().toISOString(),
        };
        const key = normalizedCategory.name.toLocaleLowerCase("ru-RU");
        const group = categoryGroups.get(key) || [];
        group.push(normalizedCategory);
        categoryGroups.set(key, group);
      });

      categoryGroups.forEach((group) => {
        group.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const canonical = group[0];
        normalized.categories.push(canonical);
        group.forEach((category) => {
          categoryAliases.set(category.id, canonical.id);
          if (category.id !== canonical.id && !normalized.tombstones.categories[category.id]) {
            normalized.tombstones.categories[category.id] = new Date().toISOString();
          }
        });
      });

      const ensureCategory = (name) => {
        const categoryName = config.cleanText(name);
        if (!categoryName) return "";
        const existing = normalized.categories.find(
          (category) => category.name.toLowerCase() === categoryName.toLowerCase(),
        );
        if (existing) return existing.id;
        const category = {
          id: config.createId(),
          name: categoryName,
          color: config.randomCategoryColor(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        normalized.categories.push(category);
        return category.id;
      };

      normalized.tasks = Array.isArray(raw.tasks)
        ? raw.tasks.map((task) => {
            const time = config.cleanTimeValue(task.time);
            const startTime = config.cleanTimeValue(task.startTime);
            const endTime = config.cleanTimeValue(task.endTime);
            const hasBlock = isValidTimeBlock(startTime, endTime);
            const normalizedTime = hasBlock ? endTime : time;
            const aliasedCategoryId = categoryAliases.get(task.categoryId) || task.categoryId;
            const categoryId = normalized.categories.some((category) => category.id === aliasedCategoryId)
              ? aliasedCategoryId
              : ensureCategory(task.category);

            return {
              id: task.id || config.createId(),
              title: config.cleanText(task.title) || "Задача",
              date: config.normalizeDateKey(task.date),
              time: normalizedTime,
              scheduleMode: hasBlock ? "block" : normalizedTime ? "deadline" : "none",
              startTime: hasBlock ? startTime : "",
              endTime: hasBlock ? endTime : "",
              categoryId,
              priority: config.validPriorities.includes(task.priority) ? task.priority : "medium",
              repeat: config.recurrence.normalizeRepeat(task.repeat),
              repeatUntil: config.normalizeDateKey(task.repeatUntil, ""),
              sourceTaskId: config.cleanText(task.sourceTaskId),
              movedFromDate: config.normalizeDateKey(task.movedFromDate, ""),
              customRepeat: config.recurrence.normalizeCustomRepeat(task.customRepeat),
              reminderOffset: config.normalizeReminderOffset(task.reminderOffset, Boolean(normalizedTime)),
              completed: config.normalizeTaskFlags(task.completed),
              acknowledgedOverdue: config.normalizeTaskFlags(task.acknowledgedOverdue),
              excludedDates: config.normalizeTaskFlags(task.excludedDates),
              notified: pruneOldNotificationFlags(config.normalizeTaskFlags(task.notified)),
              createdAt: task.createdAt || new Date().toISOString(),
              updatedAt: task.updatedAt || task.createdAt || new Date().toISOString(),
            };
          })
        : [];

      normalized.habits = Array.isArray(raw.habits)
        ? raw.habits.map((habit) => {
            const type = habit.type === "number" ? "number" : "check";
            const createdAt = habit.createdAt || new Date().toISOString();
            const updatedAt = habit.updatedAt || createdAt;
            const startDate = config.normalizeDateKey(habit.startDate, config.toDateKey(new Date(createdAt)));
            const titleHistory = config.normalizeHabitTitleHistory(habit.titleHistory, {
              cleanText: config.cleanText,
              fallbackTitle: config.cleanText(habit.title) || "Привычка",
              startDate,
              updatedAt,
            });
            const configHistory = config.normalizeHabitConfigHistory(habit.configHistory, {
              fallback: {
                type,
                repeat: config.normalizeHabitRepeat(habit.repeat),
                customRepeat: habit.customRepeat,
                unit: habit.unit,
                goal: habit.goal,
              },
              normalizeCustomRepeat: config.recurrence.normalizeCustomRepeat,
              normalizeRepeat: config.normalizeHabitRepeat,
              startDate,
              updatedAt,
            });
            const latestConfig = configHistory.at(-1);
            const availabilityHistory = config.normalizeHabitAvailabilityHistory(habit.availabilityHistory, {
              archived: habit.archived,
              archivedAt: habit.archivedAt,
              archivedFromDate: habit.archivedFromDate,
              startDate,
              updatedAt,
            });
            const latestAvailability = availabilityHistory.at(-1);
            const archived = latestAvailability?.active === false;
            return {
              id: habit.id || config.createId(),
              title: titleHistory.at(-1)?.title || "Привычка",
              titleHistory,
              type: latestConfig.type,
              repeat: latestConfig.repeat,
              customRepeat: latestConfig.customRepeat,
              startDate,
              unit: latestConfig.unit,
              goal: latestConfig.goal,
              configHistory,
              availabilityHistory,
              archived,
              archivedAt: archived ? latestAvailability.updatedAt : "",
              archivedFromDate: archived ? latestAvailability.fromDate : "",
              logs: config.normalizeHabitLogs(habit.logs, type),
              createdAt,
              updatedAt,
            };
          })
        : [];

      normalized.goals = Array.isArray(raw.goals)
        ? raw.goals.map((goal) => {
            const createdAt = goal.createdAt || new Date().toISOString();
            const status = goal.status === "done" || goal.completed === true ? "done" : "active";
            const legacyTaskIds = normalizeGoalTaskIds(goal.taskIds);
            let steps = normalizeGoalSteps(goal.steps, config);
            if (!steps.length && legacyTaskIds.length) {
              steps = legacyTaskIds
                .map((taskId) => normalized.tasks.find((task) => task.id === taskId))
                .filter(Boolean)
                .map((task) => ({
                  id: config.createId(),
                  title: task.title,
                  done: status === "done" || task.completed?.[task.date] === true,
                }));
            }
            if (status === "done" && !steps.length) {
              steps = [{ id: config.createId(), title: "Цель достигнута", done: true }];
            } else if (status === "done") {
              steps.forEach((step) => {
                step.done = true;
              });
            }
            return {
              id: goal.id || config.createId(),
              title: config.cleanText(goal.title) || "Цель",
              description: config.cleanText(goal.description),
              measure: config.cleanText(goal.measure),
              reality: config.cleanText(goal.reality),
              why: config.cleanText(goal.why),
              dueDate: config.normalizeDateKey(goal.dueDate),
              steps,
              status,
              completedAt: status === "done" ? goal.completedAt || new Date().toISOString() : "",
              createdAt,
              updatedAt: goal.updatedAt || createdAt,
            };
          })
        : [];

      normalized.boardItems = config.normalizeBoardItems?.(raw.boardItems, {
        createId: config.createId,
      }) || [];
      normalized.journalEntries = config.normalizeJournalEntries?.(raw.journalEntries, {
        createId: config.createId,
      }) || [];
      const foodById = new Map();
      normalized.nutritionFoods = (Array.isArray(raw.nutritionFoods) ? raw.nutritionFoods : [])
        .map((food) => config.normalizeNutritionFood?.(food, { createId: config.createId }))
        .filter(Boolean)
        .filter((food) => {
          if (foodById.has(food.id)) return false;
          foodById.set(food.id, food);
          return true;
        });
      normalized.nutritionMeals = (Array.isArray(raw.nutritionMeals) ? raw.nutritionMeals : [])
        .map((meal) => config.normalizeNutritionMeal?.(meal, { createId: config.createId, foodById }))
        .filter(Boolean);
      normalized.nutritionTemplates = (Array.isArray(raw.nutritionTemplates) ? raw.nutritionTemplates : [])
        .map((template) => config.normalizeNutritionTemplate?.(template, { createId: config.createId, foodById }))
        .filter(Boolean);
      normalized.nutritionSettings = config.normalizeNutritionSettings?.(raw.nutritionSettings) || {};

      const taskIds = new Set(normalized.tasks.map((task) => task.id));
      normalized.taskOrder = Object.fromEntries(
        Object.entries(config.normalizeTaskOrder(raw.taskOrder))
          .map(([dateKey, ids]) => [dateKey, ids.filter((id) => taskIds.has(id))])
          .filter(([, ids]) => ids.length),
      );
      normalized.syncMeta = config.pruneSyncMeta?.(normalized.syncMeta, normalized) || normalized.syncMeta;
      return normalized;
    }

    return { normalizeState };
  }

  function isValidTimeBlock(startTime, endTime) {
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    return Number.isFinite(start) && Number.isFinite(end) && end > start;
  }

  function normalizeGoogleCalendarLinks(value, config) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    Object.entries(value).forEach(([taskId, link]) => {
      const eventId = config.cleanText(link?.eventId);
      if (!taskId || !eventId) return;
      const occurrenceDate = /^\d{4}-\d{2}-\d{2}$/.test(link?.occurrenceDate) ? link.occurrenceDate : "";
      const sourceTaskId = config.cleanText(link?.sourceTaskId);
      result[taskId] = {
        eventId,
        localUpdatedAt: validTimestamp(link?.localUpdatedAt),
        remoteUpdatedAt: validTimestamp(link?.remoteUpdatedAt),
        syncedAt: validTimestamp(link?.syncedAt),
        ...(occurrenceDate && sourceTaskId ? { occurrenceDate, sourceTaskId } : {}),
      };
    });
    return result;
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
  }

  function timeToMinutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function normalizeGoalSteps(value, config) {
    if (!Array.isArray(value)) return [];
    return value
      .map((step) => ({
        id: step?.id || config.createId(),
        title: config.cleanText(step?.title || step),
        done: step?.done === true,
      }))
      .filter((step) => step.title);
  }

  function normalizeGoalTaskIds(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((id) => String(id || "").trim()).filter(Boolean))];
  }

  function normalizeTombstones(value) {
    const result = {
      tasks: {}, habits: {}, goals: {}, boardItems: {}, journalEntries: {}, categories: {},
      nutritionFoods: {}, nutritionMeals: {}, nutritionTemplates: {},
    };
    Object.keys(result).forEach((type) => {
      Object.entries(value?.[type] || {}).forEach(([id, deletedAt]) => {
        if (id && isValidTimestamp(deletedAt)) result[type][id] = deletedAt;
      });
    });
    return result;
  }

  function isValidTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  }

  function pruneOldNotificationFlags(flags) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 120);
    const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    return Object.fromEntries(Object.entries(flags || {}).filter(([dateKey]) => dateKey >= cutoffKey));
  }

  const api = { createStateNormalizer };
  global.RhythmStateNormalizer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
