import documentState from "../app/src/core/document-state.js";
import syncMetadata from "../app/src/sync/sync-metadata.js";
import notesModel from "../app/src/notes/notes-model.js";
import boardModel from "../app/src/board/board-model.js";
import checklist from "../app/src/tasks/task-checklist.js";
import goalActivity from "../app/src/goals/goal-activity.js";
import habitSchedule from "../app/src/habits/habit-schedule.js";
import journalModel from "../app/src/journal/journal-model.js";
import { recordMcpActivity } from "./activity-service.mjs";
import { createTaskCommand, taskScheduledOn, tasksForDate } from "./task-service.mjs";
import { updateTaskCommand } from "./write-service.mjs";

export function dateKey(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Укажите существующую дату YYYY-MM-DD");
  }
  return value;
}

export function timeValue(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""))) throw new Error("Укажите время HH:mm");
  return value;
}

export function entity(state, type, id) {
  const item = (state[type] || []).find((entry) => entry.id === id);
  if (!item) throw new Error(`Объект ${type} не найден в вашем пространстве`);
  return item;
}

export function requireConfirmation(input) {
  if (input.confirm !== true) throw new Error("Сначала получите явное подтверждение пользователя (confirm: true)");
}

export function command(state, input, type, operation, options = {}) {
  if (Number(state.schemaVersion) > documentState.SCHEMA_VERSION) throw new Error("Данные созданы более новой версией приложения. Сначала обновите MCP.");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId || "")) throw new Error("requestId: 8–100 латинских букв, цифр, _ или -");
  const previous = state.mcpActivity?.find((item) => item.requestId === input.requestId);
  if (previous) {
    if (previous.type !== type) throw new Error("Этот requestId уже использован для другого действия");
    return { changed: false, state, activity: previous, summary: previous.status === "undone" ? "Запрос уже обработан; действие было отменено и не применено повторно" : "Этот запрос уже был обработан",
      replayed: true, status: previous.status };
  }
  const next = structuredClone(state);
  documentState.ensureDocumentShape(next);
  const now = options.now || new Date().toISOString();
  const result = operation(next, now, `mcp-${input.requestId}`) || {};
  // Canonicalize changed entities only, so a browser reload does not make immediate undo look stale.
  const canonical = documentState.normalizeState(next);
  const collections = ["tasks", "habits", "goals", "notes", "boardItems", "studySubjects", "studyLessons", "studyFiles", "journalEntries"];
  for (const collection of collections) {
    const previousById = new Map((state[collection] || []).map((item) => [item.id, item]));
    const canonicalById = new Map(canonical[collection].map((item) => [item.id, item]));
    next[collection] = next[collection].map((item) => JSON.stringify(previousById.get(item.id)) === JSON.stringify(item) ? item : canonicalById.get(item.id) || item);
  }
  const outputs = { task: "tasks", habit: "habits", goal: "goals", note: "notes", item: "boardItems", subject: "studySubjects", lesson: "studyLessons", file: "studyFiles" };
  for (const [key, collection] of Object.entries(outputs)) if (result[key]?.id) result[key] = next[collection].find((item) => item.id === result[key].id) || result[key];
  syncMetadata.createSyncMetadataTracker({ now: () => now }).trackChanges(state, next);
  const summary = result.summary || type;
  const activity = recordMcpActivity(state, next, { requestId: input.requestId, type, title: type, summary, guard: true }, now);
  return { changed: true, state: next, ...result, summary, activity };
}

export function removeEntity(state, type, id, now) {
  entity(state, type, id);
  state[type] = state[type].filter((item) => item.id !== id);
  ((state.tombstones ||= {})[type] ||= {})[id] = now;
}

export function page(items, input = {}) {
  const offset = input.offset || 0;
  return { items: items.slice(offset, offset + (input.limit || 30)), total: items.length, offset };
}

export function listWorkspaceEntities(state, input) {
  const types = { task: "tasks", habit: "habits", goal: "goals", note: "notes", board: "boardItems", subject: "studySubjects", lesson: "studyLessons", material: "studyFiles", category: "categories" };
  let items = state[types[input.type]] || [];
  const query = String(input.query || "").trim().toLocaleLowerCase("ru");
  if (query) items = items.filter((item) => [item.title, item.name, item.body, item.text, item.teacher, item.studyDetails].some((value) => String(value || "").toLocaleLowerCase("ru").includes(query)));
  if (input.subjectId) items = items.filter((item) => (item.studySubjectId || item.subjectId) === input.subjectId);
  if (input.boardId !== undefined) items = items.filter((item) => item.boardId === input.boardId);
  if (input.archived !== undefined) items = items.filter((item) => Boolean(item.archived) === input.archived);
  if (input.taskView === "later") items = items.filter((item) => item.date === null);
  if (input.taskView === "day") items = items.filter((item) => taskScheduledOn(item, dateKey(input.date)));
  if (input.taskView === "history") {
    items = items.filter((item) => Object.values(item.completed || {}).some((done) => done === true));
  }
  return page(items, input);
}

export function upsertNoteCommand(state, input, options) {
  return command(state, input, "upsert_note", (next, now, id) => {
    const current = input.noteId ? entity(next, "notes", input.noteId) : null;
    if (current && input.expectedUpdatedAt !== current.updatedAt) throw new Error("Сначала прочитайте заметку и передайте её актуальный expectedUpdatedAt");
    if (input.taskId) entity(next, "tasks", input.taskId);
    if (input.subjectId) entity(next, "studySubjects", input.subjectId);
    const note = notesModel.normalizeNote({ ...current, ...input, id: current?.id || id, createdAt: current?.createdAt || now,
      updatedAt: now, bodyBaseUpdatedAt: current?.updatedAt || "" }, { now });
    if (!note) throw new Error("Заметка не может быть пустой");
    next.notes = [...next.notes.filter((item) => item.id !== note.id), note];
    return { note, summary: `Заметка «${note.title}» сохранена` };
  }, options);
}

export function deleteNoteCommand(state, input, options) {
  requireConfirmation(input);
  return command(state, input, "delete_note", (next, now) => {
    removeEntity(next, "notes", input.noteId, now);
    next.tasks.forEach((task) => { if (task.sourceNoteId === input.noteId) { task.sourceNoteId = ""; task.updatedAt = now; } });
    return { summary: "Заметка удалена; связанные задачи сохранены" };
  }, options);
}

export function taskFromNoteCommand(state, input, options) {
  return command(state, input, "create_task_from_note", (next, now) => {
    const note = entity(next, "notes", input.noteId);
    const mutation = createTaskCommand(next, { ...input, date: input.date || options.today }, { now, today: options.today });
    Object.assign(next, mutation.state);
    mutation.task.sourceNoteId = note.id;
    return { task: mutation.task, summary: "Задача создана и связана с заметкой" };
  }, options);
}

export function upsertBoardItemCommand(state, input, options) {
  return command(state, input, "upsert_board_item", (next, now, id) => {
    const current = input.itemId ? entity(next, "boardItems", input.itemId) : null;
    if (current && input.expectedUpdatedAt !== current.updatedAt) throw new Error("Передайте актуальный expectedUpdatedAt карточки");
    if (current && input.type && input.type !== current.type) throw new Error("Тип карточки нельзя менять; создайте новую");
    const value = { ...current, ...input, id: current?.id || id, createdAt: current?.createdAt || now, updatedAt: now };
    if (value.boardId && entity(next, "boardItems", value.boardId).type !== "board") throw new Error("boardId должен указывать на именованную доску");
    if (value.type === "board" && value.boardId) throw new Error("Доски нельзя вкладывать друг в друга");
    if (value.type === "link") {
      const sourceTypes = { task: "tasks", goal: "goals", note: "notes", subject: "studySubjects", material: "studyFiles" };
      if (!sourceTypes[value.sourceType]) throw new Error("Неизвестный тип ссылки");
      entity(next, sourceTypes[value.sourceType], value.sourceId);
    }
    if (value.type === "image") {
      const source = next.boardItems.find((item) => item.type === "image" && item.assetId === value.assetId);
      if (!source) throw new Error("Изображение сначала нужно загрузить через интерфейс доски");
      Object.assign(value, { remotePath: source.remotePath, mime: source.mime, name: source.name });
    }
    const item = boardModel.normalizeItem(value, { now });
    if (!item) throw new Error("Некорректная карточка доски");
    next.boardItems = [...next.boardItems.filter((entry) => entry.id !== item.id), item];
    return { item, summary: "Карточка доски сохранена" };
  }, options);
}

export function deleteBoardItemCommand(state, input, options) {
  requireConfirmation(input);
  return command(state, input, "delete_board_item", (next, now) => {
    const item = entity(next, "boardItems", input.itemId);
    const children = next.boardItems.filter((entry) => entry.boardId === item.id);
    if (children.length && input.deleteContents !== true) throw new Error("Доска не пуста. Явно подтвердите deleteContents: true");
    [item, ...children].forEach((entry) => removeEntity(next, "boardItems", entry.id, now));
    return { summary: "Карточка или доска удалена; исходные задачи и заметки сохранены" };
  }, options);
}

export function changeSubtaskCommand(state, input, options) {
  if (input.operation === "delete") requireConfirmation(input);
  return command(state, input, "change_subtask", (next, now, id) => {
    const task = entity(next, "tasks", input.taskId.replace(/^task:/, ""));
    const date = dateKey(input.date || task.date || options.today);
    if (task.date !== null && !taskScheduledOn(task, date)) throw new Error("Задача не запланирована на этот день");
    if (input.operation === "complete") {
      if (!checklist.setDone(task, date, input.itemId, input.completed !== false, now)) throw new Error("Подзадача не найдена");
      return { task, summary: "Выполнение подзадачи обновлено; статус основной задачи не менялся" };
    }
    let items = structuredClone(task.checklist || []);
    if (input.operation === "reorder") {
      if (!input.itemIds || new Set(input.itemIds).size !== items.length || input.itemIds.length !== items.length
        || input.itemIds.some((id) => !items.some((item) => item.id === id))) throw new Error("Передайте все подзадачи по одному разу");
      items = input.itemIds.map((id) => items.find((item) => item.id === id));
    } else if (input.operation === "create") {
      if (items.length >= 50) throw new Error("Не больше 50 подзадач");
      items.push({ id: `mcp-sub-${crypto.randomUUID()}`, title: input.title });
    } else {
      const index = items.findIndex((item) => item.id === input.itemId);
      if (index < 0) throw new Error("Подзадача не найдена");
      if (input.operation === "delete") items.splice(index, 1);
      else if (input.operation === "update") items[index].title = input.title;
      else throw new Error("Неизвестная операция");
    }
    if (["create", "update"].includes(input.operation) && !String(input.title || "").trim()) throw new Error("Укажите название подзадачи");
    const mutation = updateTaskCommand(next, { requestId: input.requestId, taskId: task.id, occurrenceDate: date,
      scope: input.scope, checklist: items }, { now, today: options.today });
    Object.assign(next, mutation.state);
    // The outer command owns the single undo entry for a split recurring task.
    next.mcpActivity = structuredClone(state.mcpActivity || []);
    return { task: mutation.task, summary: "Подзадачи обновлены" };
  }, options);
}

export function configureGoalCommand(state, input, options) {
  return command(state, input, "configure_goal", (next, now) => {
    const goal = entity(next, "goals", input.goalId);
    if (input.taskTargets) input.taskTargets.forEach((target) => { entity(next, "tasks", target.taskId); dateKey(target.startDate); });
    if (input.habitTargets) input.habitTargets.forEach((target) => { entity(next, "habits", target.habitId); dateKey(target.startDate); });
    for (const key of ["paused", "archived", "taskTargets", "habitTargets"]) if (input[key] !== undefined) goal[key] = input[key];
    if (input.linkedTaskIds) { input.linkedTaskIds.forEach((id) => entity(next, "tasks", id)); goal.linkedTaskIds = [...new Set(input.linkedTaskIds)]; }
    if (input.taskTargets) {
      goal.taskTargets = goalActivity.normalizeTaskTargets(input.taskTargets, options.today);
      if (input.linkedTaskIds && goal.taskTargets.some((target) => !input.linkedTaskIds.includes(target.taskId))) throw new Error("Все taskTargets должны входить в linkedTaskIds");
      if (!input.linkedTaskIds) goal.linkedTaskIds = goal.taskTargets.map((target) => target.taskId);
    }
    if (input.habitTargets) goal.habitTargets = goalActivity.normalizeHabitTargets(input.habitTargets, options.today);
    goal.updatedAt = now;
    if (input.checkpointIds) {
      if (new Set(input.checkpointIds).size !== input.checkpointIds.length || input.checkpointIds.length !== (goal.steps || []).length
        || input.checkpointIds.some((id) => !goal.steps.some((step) => step.id === id))) throw new Error("Передайте все чекпоинты по одному разу");
      goal.steps = input.checkpointIds.map((id) => goal.steps.find((step) => step.id === id));
    }
    goalActivity.reconcileGoalStatuses(next, { now, todayKey: options.today, habitStatusOnDate: habitSchedule.statusOnDate });
    return { goal, summary: "Связи и состояние цели обновлены" };
  }, options);
}

export function freezeHabitCommand(state, input, options) {
  return command(state, input, "set_habit_freeze", (next, now) => {
    const habit = entity(next, "habits", input.habitId.replace(/^habit:/, ""));
    const date = dateKey(input.date || options.today);
    (habit.freezeDays ||= {})[date] = { active: input.frozen, reason: input.reason || "", updatedAt: now };
    habit.updatedAt = now;
    return { habit, summary: "Заморозка привычки обновлена" };
  }, options);
}

export function reorderTasksCommand(state, input, options) {
  return command(state, input, "reorder_tasks", (next) => {
    const date = dateKey(input.date);
    const scheduled = tasksForDate(next, date).map((task) => task.id);
    if (new Set(input.taskIds).size !== input.taskIds.length || input.taskIds.some((id) => !scheduled.includes(id))) throw new Error("Порядок содержит дубли или задачи другого дня");
    next.taskOrder[date] = [...input.taskIds, ...scheduled.filter((id) => !input.taskIds.includes(id))];
    return { order: next.taskOrder[date], summary: "Порядок задач сохранён" };
  }, options);
}

export function reorderHabitsCommand(state, input, options) {
  return command(state, input, "reorder_habits", (next) => {
    if (new Set(input.habitIds).size !== input.habitIds.length || input.habitIds.length !== next.habits.length) throw new Error("Передайте все привычки по одному разу, включая архивные");
    next.habits = input.habitIds.map((id) => entity(next, "habits", id));
    return { order: input.habitIds, summary: "Порядок привычек сохранён" };
  }, options);
}

export function deleteHabitCommand(state, input, options) {
  requireConfirmation(input);
  return command(state, input, "delete_habit", (next, now) => {
    if (next.goals.some((goal) => goal.habitTargets?.some((target) => target.habitId === input.habitId))) throw new Error("Привычка связана с целью. Уберите связь или приостановите привычку вместо удаления.");
    removeEntity(next, "habits", input.habitId, now);
    return { summary: "Привычка и её история удалены после подтверждения" };
  }, options);
}

export function getJournalRevisions(state, input) {
  if (state.profile?.journalAccess?.read === false) throw new Error("Чтение дневника запрещено владельцем аккаунта");
  const entry = journalModel.journalEntryForDate(state.journalEntries, dateKey(input.date));
  return { entry: entry || null };
}

export function editJournalCommand(state, input, options) {
  if (state.profile?.journalAccess?.write === false) throw new Error("Запись дневника запрещена владельцем аккаунта");
  requireConfirmation(input);
  return command(state, input, "edit_journal_entry", (next, now, id) => {
    const date = dateKey(input.date);
    const current = journalModel.journalEntryForDate(next.journalEntries, date);
    if (current && input.expectedUpdatedAt !== current.updatedAt) throw new Error("Передайте актуальный expectedUpdatedAt дневника");
    if (input.operation === "delete") {
      if (!current) throw new Error("Запись не найдена");
      removeEntity(next, "journalEntries", current.id, now);
      return { summary: "Запись дневника удалена" };
    }
    let text = input.text;
    if (input.operation === "restoreRevision") {
      if (state.profile?.journalAccess?.read === false) throw new Error("Чтение истории дневника запрещено владельцем аккаунта");
      const revision = current?.revisions?.find((item) => item.savedAt === input.savedAt);
      if (!revision) throw new Error("Версия записи не найдена");
      text = revision.text;
    }
    if (typeof text !== "string" || !text.trim()) throw new Error("Укажите непустой текст записи");
    const updated = journalModel.upsertJournalEntry(next.journalEntries, { date, text }, { now, forceRevision: true, createId: () => id });
    next.journalEntries = updated.entries;
    // A write-only permission must not reveal the old text through revisions in the response.
    return { entry: { id: updated.entry.id, date, updatedAt: now }, summary: "Запись дневника обновлена с сохранением предыдущей версии" };
  }, options);
}
