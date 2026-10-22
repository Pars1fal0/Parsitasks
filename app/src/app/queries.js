// Read-only task and habit queries plus formatting helpers.

import * as documentState from "../core/document-state.js";
import * as habitConfigHistory from "../habits/habit-config-history.js";
import * as recurrence from "../tasks/recurrence.js";
import * as habitSchedule from "../habits/habit-schedule.js";
import * as habitFreeze from "../habits/habit-freeze.js";
import { todayKey } from "./state.js";
import { app } from "./store.js";
import { parseQuickTaskPreview } from "./forms.js";
import { priorityLabels } from "./services.js";
import { cleanText, cleanTimeValue, createId, formatLongDate, formatShortDate, formatTime, normalizeDateKey, overdueController, parseDate, randomCategoryColor, timeToMinutes } from "./state.js";

export function tasksForDate(dateKey) {
  return app.state.tasks.filter((task) => taskOccursOn(task, dateKey));
}

export function getOrderedTasksForDate(dateKey) {
  const tasks = tasksForDate(dateKey);
  const taskIds = new Set(tasks.map((task) => task.id));
  const order = Array.isArray(app.state.taskOrder[dateKey])
    ? app.state.taskOrder[dateKey].filter((id) => taskIds.has(id))
    : [];
  const orderMap = new Map(order.map((id, index) => [id, index]));

  return tasks.sort((a, b) => {
    return sortTasks(a, b, orderMap);
  });
}

export function reorderTask(dateKey, sourceId, targetId) {
  const order = getOrderedTasksForDate(dateKey).map((task) => task.id);
  const from = order.indexOf(sourceId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return;
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  app.state.taskOrder[dateKey] = order;
}

export function taskOccursOn(task, dateKey) {
  return taskScheduledOn(task, dateKey) && !isTaskExcluded(task, dateKey);
}

export function taskScheduledOn(task, dateKey) {
  return recurrence.taskScheduledOn(task, dateKey);
}

export function isTaskExcluded(task, dateKey) {
  return task.excludedDates?.[dateKey] === true;
}

export function excludedTasksForDate(dateKey) {
  const replacementSourceIds = new Set(
    app.state.tasks
      .filter((task) => task.repeat === "none" && task.date === dateKey && task.sourceTaskId)
      .map((task) => task.sourceTaskId),
  );
  return app.state.tasks
    .filter(
      (task) =>
        task.repeat !== "none" &&
        taskScheduledOn(task, dateKey) &&
        isTaskExcluded(task, dateKey) &&
        !replacementSourceIds.has(task.id),
    )
    .sort(sortTasks);
}

export function overdueTaskEntries(referenceDateKey = app.activeDate) {
  const referenceDate = parseDate(normalizeDateKey(referenceDateKey, app.activeDate));
  referenceDate.setHours(12, 0, 0, 0);
  return overdueController.list(referenceDate);
}

export function habitsForDate(dateKey) {
  return app.state.habits.filter((habit) => {
    const hiddenByArchive = habitConfigHistory.habitIsArchivedOnDate(habit, dateKey);
    return !hiddenByArchive && habitOccursOn(habit, dateKey);
  });
}

export function habitOccursOn(habit, dateKey) {
  return habitSchedule.occursOn(habit, dateKey);
}

export function isTaskDone(task, dateKey) {
  return task.completed?.[dateKey] === true;
}

export function isHabitComplete(habit, dateKey) {
  const effective = habitConfigOnDate(habit, dateKey);
  return habitFreeze.isComplete(habit, dateKey, effective);
}

export function habitStatusOnDate(habit, dateKey) {
  return habitSchedule.statusOnDate(habit, dateKey);
}

export function habitConfigOnDate(habit, dateKey) {
  return habitConfigHistory.habitConfigOnDate(habit, dateKey, {
    normalizeCustomRepeat: recurrence.normalizeCustomRepeat,
    normalizeRepeat: normalizeHabitRepeat,
  });
}

export function habitStreak(habit, dateKey = todayKey()) {
  return habitSchedule.streak(habit, dateKey, todayKey());
}

export function sortTasks(a, b, orderMap = new Map()) {
  const manualRankA = orderMap.get(a.id);
  const manualRankB = orderMap.get(b.id);
  const hasManualOrder = manualRankA !== undefined || manualRankB !== undefined;
  const priorityWeight = { high: 0, medium: 1, low: 2 };
  const priorityDiff = (priorityWeight[a.priority] ?? 1) - (priorityWeight[b.priority] ?? 1);
  const timeDiff = timeValue(taskSortTime(a)).localeCompare(timeValue(taskSortTime(b)));
  const categoryDiff = categoryLabel(a).localeCompare(categoryLabel(b), "ru");

  if (hasManualOrder) {
    const manualDiff = (manualRankA ?? Number.MAX_SAFE_INTEGER) - (manualRankB ?? Number.MAX_SAFE_INTEGER);
    if (manualDiff !== 0) return manualDiff;
  }
  if (priorityDiff !== 0) return priorityDiff;
  if (timeDiff !== 0) return timeDiff;
  return categoryDiff;
}

export function taskDetails(task) {
  const details = [];
  const category = getCategory(task.categoryId);
  const subject = app.state.studySubjects.find((item) => item.id === task.studySubjectId);
  if (taskHasSchedule(task)) details.push(formatTaskScheduleLabel(task));
  if (subject) details.push(subject.name);
  if (category) details.push(category.name);
  if (task.repeat !== "none") details.push(formatTaskRepeat(task));
  if (taskHasSchedule(task) && task.reminderOffset !== "none") details.push(reminderLabel(task.reminderOffset));
  return details;
}

export function matchesCategoryFilter(task, filter) {
  return filter === "all" ? true : (task.categoryId || "none") === filter;
}

export function taskMatchesSearch(task, query, dateKey = "") {
  const search = cleanSearchQuery(query);
  if (!search) return true;

  const category = getCategory(task.categoryId);
  const subject = app.state.studySubjects.find((item) => item.id === task.studySubjectId);
  const haystack = [
    task.title,
    category?.name,
    subject?.name,
    task.studyDetails,
    ...(task.checklist || []).map((item) => item.title),
    priorityLabels[task.priority],
    formatTaskRepeat(task),
    task.time,
    task.startTime,
    task.endTime,
    formatTime(task.time),
    formatTaskScheduleLabel(task),
    dateKey,
    dateKey ? formatLongDate(dateKey) : "",
    task.reminderOffset !== "none" ? reminderLabel(task.reminderOffset) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return search.split(" ").every((token) => haystack.includes(token));
}

export function archiveEntryMatchesSearch(entry, query) {
  const search = cleanSearchQuery(query);
  if (!search) return true;

  return taskMatchesSearch(entry.task, search, entry.dateKey);
}

export function taskMetaItems(task) {
  const category = getCategory(task.categoryId);
  const subject = app.state.studySubjects.find((item) => item.id === task.studySubjectId);
  const items = [];

  if (subject) items.push({ categoryColor: subject.color, label: subject.name, type: "study" });

  if (category) {
    items.push({
      categoryColor: category.color,
      label: category.name,
      type: "category",
    });
  }

  if (taskHasSchedule(task)) items.push({ label: formatTaskScheduleLabel(task), type: "schedule" });
  if (task.dueDate) items.push({ label: `Сдать ${formatShortDate(task.dueDate)}${task.dueTime ? `, ${formatTime(task.dueTime)}` : ""}`, type: "due" });
  if (task.repeat !== "none") items.push({ label: formatTaskRepeat(task), type: "repeat" });
  if (taskHasSchedule(task) && task.reminderOffset !== "none") {
    items.push({ label: reminderLabel(task.reminderOffset), type: "reminder" });
  }

  return items.length ? items : [{ label: "Без категории", type: "empty" }];
}

export function categoryLabel(task) {
  return getCategory(task.categoryId)?.name || "\uffff";
}

export function timeValue(value) {
  return cleanTimeValue(value) || "99:99";
}

export function formatTaskRepeat(task) {
  const label = recurrence.repeatLabel(task);
  return task.repeatUntil ? `${label} · до ${formatShortDate(task.repeatUntil)}` : label;
}

export function normalizeHabitRepeat(value) {
  return documentState.normalizeHabitRepeat(value);
}

export function formatHabitRepeat(habit) {
  if (habit.repeat === "weeklyGoal") {
    const count = habit.weeklyTarget || 3;
    return `${count} ${count === 1 ? "раз" : count < 5 ? "раза" : "раз"} в неделю`;
  }
  return recurrence.repeatLabel({
    repeat: normalizeHabitRepeat(habit.repeat),
    customRepeat: habit.customRepeat,
  });
}

export function reminderLabel(value) {
  const labels = {
    0: "напомнить в срок",
    5: "за 5 минут",
    15: "за 15 минут",
    30: "за 30 минут",
    60: "за 1 час",
    1440: "за день",
  };
  return labels[value] || "без напоминания";
}

export function statsForDate(dateKey) {
  const tasks = tasksForDate(dateKey);
  const habits = habitsForDate(dateKey);
  const taskDone = tasks.filter((task) => isTaskDone(task, dateKey)).length;
  const habitDone = habits.filter((habit) => habitStatusOnDate(habit, dateKey) === "complete").length;
  const habitFrozen = habits.filter((habit) => habitStatusOnDate(habit, dateKey) === "frozen").length;
  const taskTotal = tasks.length;
  const habitTotal = habits.filter((habit) => ["complete", "missed"].includes(habitStatusOnDate(habit, dateKey))).length;
  const habitFlexibleDone = habits.filter((habit) => habitConfigOnDate(habit, dateKey).repeat === "weeklyGoal" && isHabitComplete(habit, dateKey)).length;
  return {
    habitDone,
    habitFrozen,
    habitPercent: habitTotal ? Math.round((habitDone / habitTotal) * 100) : 0,
    habitTotal,
    habitFlexibleDone,
    taskDone,
    taskPercent: taskTotal ? Math.round((taskDone / taskTotal) * 100) : 0,
    taskTotal,
  };
}

export function archiveEntries() {
  return app.state.tasks
    .flatMap((task) =>
      Object.entries(task.completed || {})
        .filter(([, done]) => done === true)
        .map(([dateKey]) => ({ dateKey, task })),
    )
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.task.createdAt.localeCompare(a.task.createdAt));
}

export function getCategory(categoryId) {
  return app.state.categories.find((category) => category.id === categoryId);
}

export function cleanSearchQuery(value) {
  return cleanText(value).toLowerCase();
}

export function formatTaskTime(value) {
  const formatted = formatTime(value);
  return formatted ? `до ${formatted}` : "";
}

export function isTimeBlock(task) {
  return task?.scheduleMode === "block" && isValidTimeBlock(task.startTime, task.endTime);
}

export function isValidTimeBlock(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export function taskHasSchedule(task) {
  return isTimeBlock(task) || Boolean(cleanTimeValue(task?.time));
}

export function taskSortTime(task) {
  return isTimeBlock(task) ? task.startTime : task?.time || "";
}

export function formatTaskWindow(task) {
  if (!isValidTimeBlock(task?.startTime, task?.endTime)) return "";
  return `${formatTime(task.startTime)}-${formatTime(task.endTime)}`;
}

export function formatTaskScheduleLabel(task) {
  return isTimeBlock(task) ? formatTaskWindow(task) : formatTaskTime(task.time);
}

export function parseQuickTaskInput(value) {
  const parsed = parseQuickTaskPreview(value);
  if (parsed.title && !parsed.categoryId && parsed.categoryName) {
    parsed.categoryId = getOrCreateCategory(parsed.categoryName);
  }
  return parsed;
}

export function getOrCreateCategory(value) {
  const name = normalizeQuickCategoryName(value);
  if (!name) return "";
  const existing = app.state.categories.find((category) => category.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;

  const category = {
    id: createId(),
    name,
    color: randomCategoryColor(),
    createdAt: new Date().toISOString(),
  };
  app.state.categories.push(category);
  return category.id;
}

export function normalizeQuickCategoryName(value) {
  const name = cleanText(String(value || "").replaceAll("_", " "));
  if (!name) return "";
  return name.charAt(0).toLocaleUpperCase("ru-RU") + name.slice(1);
}
