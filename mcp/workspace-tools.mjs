import { z } from "zod";
import { stateTimeZone, toDateKey } from "./task-service.mjs";
import * as workspace from "./workspace-service.mjs";
import * as study from "./study-service.mjs";
import { getAccountPreferences, updateAccountPreferencesCommand } from "./preferences-service.mjs";

const id = () => z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/).refine((value) => !["__proto__", "prototype", "constructor"].includes(value));
const date = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = () => z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const text = (max) => z.string().trim().min(1).max(max);
const color = () => z.string().regex(/^#[0-9a-fA-F]{6}$/);
const paging = { limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).max(100000).optional() };
const scope = z.enum(["occurrence", "following", "series"]).optional();
const targetDate = date().optional();
const updatedAt = z.string().datetime().optional();
const entityType = z.enum(["task", "habit", "goal", "note", "board", "subject", "lesson", "material", "category"]);

const definitions = [
  ["get_mcp_capabilities", "Возможности и ограничения MCP", "Покрытие разделов, правила доступа и ограничения файловых операций. Прочитай перед обещанием полного управления приложением.",
    {}, () => ({ version: "0.8.0", domains: ["tasks", "subtasks", "habits", "goals", "calendar", "study", "homework", "materials", "notes", "boards", "preferences", "journal", "nutrition", "history"],
      limits: { calendarDays: 93, statisticsDays: 366, boardImageBytes: 1048576, materialTextBytes: 262144, uploadChunkBytes: 262144, workspaceBytes: 4194304 },
      excluded: ["Interactive OAuth consent", "Account credentials and deletion", "Device notification permissions and local backup folders", "Destructive bulk workspace import", "Text extraction from PDF and Office documents", "Deleting original files from Google Drive"],
      safety: ["Authenticated account and RLS", "Explicit deletion confirmation", "Recurring task scope", "Idempotent write request IDs", "Undo journal with conflict checks for new operations", "Private journal read/write permissions"] }), "read"],
  ["list_workspace_entities", "Найти объекты пространства", "Списки с пагинацией: задачи (день, Позже, история), привычки, цели, заметки, карточки досок, предметы, пары, материалы и категории. Содержимое файлов не возвращается.",
    { type: entityType, query: z.string().max(200).optional(), subjectId: id().optional(), boardId: z.string().max(160).optional(), archived: z.boolean().optional(),
      taskView: z.enum(["all", "day", "later", "history"]).optional(), date: targetDate, ...paging }, workspace.listWorkspaceEntities, "read"],
  ["upsert_note", "Создать или изменить заметку", "Для изменения сначала прочитай заметку и передай expectedUpdatedAt. Текст заменяется только по прямому запросу пользователя. Можно закрепить и связать с предметом или задачей.",
    { noteId: id().optional(), expectedUpdatedAt: updatedAt, title: text(120).optional(), body: z.string().max(20000).optional(), pinned: z.boolean().optional(),
      subjectId: z.string().max(160).optional(), taskId: z.string().max(160).optional() }, workspace.upsertNoteCommand],
  ["delete_note", "Удалить заметку", "Удаляет заметку только после подтверждения; связанные задачи не удаляет.",
    { noteId: id(), confirm: z.boolean() }, workspace.deleteNoteCommand, "delete"],
  ["create_task_from_note", "Создать задачу из заметки", "Создаёт задачу с обратной ссылкой на заметку. Не удаляет и не переписывает текст заметки.",
    { noteId: id(), title: text(200), date: date().nullable().optional() }, workspace.taskFromNoteCommand],
  ["upsert_board_item", "Создать или изменить карточку доски", "Именованная доска (board), текст, фрейм, ссылка на объект или копия уже загруженного изображения. Для изменения передай expectedUpdatedAt. Не выдумывай assetId.",
    { itemId: id().optional(), expectedUpdatedAt: updatedAt, type: z.enum(["board", "text", "frame", "link", "image"]).optional(), boardId: z.string().max(160).optional(),
      text: z.string().max(20000).optional(), x: z.number().min(-1000000000).max(1000000000).optional(), y: z.number().min(-1000000000).max(1000000000).optional(),
      width: z.number().min(40).max(10000).optional(), height: z.number().min(24).max(10000).optional(), z: z.number().int().min(0).max(1000000000).optional(),
      fontSize: z.number().int().min(8).max(512).optional(), fontWeight: z.enum([400, 700]).optional(), color: color().optional(),
      groupId: z.string().max(160).optional(), locked: z.boolean().optional(), assetId: id().optional(),
      sourceType: z.enum(["task", "goal", "note", "subject", "material"]).optional(), sourceId: id().optional(),
      backgroundColor: z.enum(["#ffffff", "#e8f5f0", "#efeaff", "#fff0e2", "#e8f2ff", "#fff6d9"]).optional() }, workspace.upsertBoardItemCommand],
  ["delete_board_item", "Удалить карточку или доску", "Для непустой именованной доски требуется отдельное подтверждение deleteContents. Исходные объекты карточек-ссылок и файлы не удаляются.",
    { itemId: id(), confirm: z.boolean(), deleteContents: z.boolean().optional() }, workspace.deleteBoardItemCommand, "delete"],
  ["change_subtask", "Управлять подзадачей", "Создание, изменение, удаление или выполнение пункта. Для изменения структуры повторяющейся задачи явно выбери scope. Выполнение относится только к date и не завершает родительскую задачу.",
    { taskId: z.string().max(160), operation: z.enum(["create", "update", "delete", "complete", "reorder"]), itemId: id().optional(), itemIds: z.array(id()).max(50).optional(), title: text(120).optional(), date: targetDate,
      scope, completed: z.boolean().optional(), confirm: z.boolean().optional() }, workspace.changeSubtaskCommand, "conditional"],
  ["configure_goal", "Настроить связи и состояние цели", "Приостановить, архивировать, связать с задачами и привычками. Массивы связей заменяют соответствующие текущие списки; покажи изменения пользователю перед записью.",
    { goalId: id(), paused: z.boolean().optional(), archived: z.boolean().optional(), linkedTaskIds: z.array(id()).max(100).optional(),
      taskTargets: z.array(z.object({ taskId: id(), mode: z.enum(["once", "count"]), targetCount: z.number().int().min(1).max(3650), startDate: date() }).strict()).max(100).optional(),
      habitTargets: z.array(z.object({ habitId: id(), targetCount: z.number().int().min(1).max(3650), startDate: date() }).strict()).max(100).optional(),
      checkpointIds: z.array(id()).max(100).optional() }, workspace.configureGoalCommand],
  ["reorder_habits", "Изменить порядок привычек", "Передай все привычки по одному разу, включая архивные. История выполнений не меняется.",
    { habitIds: z.array(id()).max(500) }, workspace.reorderHabitsCommand],
  ["delete_habit", "Удалить привычку с историей", "Только после явного подтверждения удаления истории. Связанную с целью привычку лучше приостановить через set_habit_active.",
    { habitId: id(), confirm: z.boolean() }, workspace.deleteHabitCommand, "delete"],
  ["get_journal_revisions", "Прочитать версии дневника", "Приватные версии записи только при разрешённом владельцем чтении дневника.",
    { date: date() }, workspace.getJournalRevisions, "read"],
  ["edit_journal_entry", "Изменить запись дневника", "Заменяет текст, восстанавливает версию или удаляет запись только по прямому запросу и после подтверждения. Требует актуальный expectedUpdatedAt для существующей записи. По умолчанию предпочитай append_journal_entry.",
    { date: date(), operation: z.enum(["replace", "restoreRevision", "delete"]), text: z.string().max(50000).optional(), savedAt: updatedAt, expectedUpdatedAt: updatedAt, confirm: z.boolean() }, workspace.editJournalCommand, "delete"],
  ["set_habit_freeze", "Заморозить день привычки", "Замораживает или возвращает один день без стирания выполнений и истории.",
    { habitId: z.string().max(160), date: targetDate, frozen: z.boolean(), reason: z.string().max(160).optional() }, workspace.freezeHabitCommand],
  ["reorder_tasks", "Изменить порядок задач дня", "Указанные задачи идут первыми в заданном порядке. Остальные задачи дня сохраняются после них.",
    { date: date(), taskIds: z.array(id()).min(1).max(500) }, workspace.reorderTasksCommand],
  ["get_study_schedule", "Получить учебное расписание", "Расписание до 93 дней с чередованием недель, преподавателями, типами занятий и исключениями.",
    { from: date(), to: date(), subjectId: id().optional(), includeArchived: z.boolean().optional() }, study.getStudySchedule, "read"],
  ["list_homework", "Получить ДЗ и историю", "Разделяет день подготовки и срок сдачи. Выполненные ДЗ остаются текущими до дня сдачи включительно, затем доступны в истории.",
    { view: z.enum(["current", "history", "all"]).optional(), subjectId: id().optional(), includeArchived: z.boolean().optional(), ...paging }, study.listHomework, "read"],
  ["upsert_study_subject", "Создать или изменить предмет", "Предмет, цвет, преподаватель, семестр, архивирование без удаления истории.",
    { subjectId: id().optional(), name: text(80).optional(), teacher: z.string().max(120).optional(), semester: z.string().max(80).optional(), color: color().optional(), archived: z.boolean().optional() }, study.upsertSubjectCommand],
  ["delete_study_subject", "Удалить пустой предмет", "Удаление только после подтверждения и только без связей. Для предмета с историей используй архивирование.",
    { subjectId: id(), confirm: z.boolean() }, study.deleteSubjectCommand, "delete"],
  ["set_semester_archived", "Архивировать или вернуть семестр", "Меняет видимость всех предметов выбранного семестра; история ДЗ, расписание и материалы сохраняются. Требует подтверждения точного семестра.",
    { semester: z.string().max(80), archived: z.boolean(), confirm: z.boolean() }, study.archiveSemesterCommand],
  ["upsert_study_lesson", "Создать или изменить занятие", "Недельный шаблон пары: предмет, преподаватель, аудитория, лекция/практика, чётная/нечётная неделя. Для одного дня используй change_lesson_occurrence.",
    { lessonId: id().optional(), subjectId: id().optional(), weekday: z.number().int().min(0).max(6).optional(), weekType: z.enum(["all", "even", "odd"]).optional(),
      lessonType: z.enum(["", "lecture", "practice"]).optional(), startTime: time().optional(), endTime: time().optional(), room: z.string().max(80).optional(), teacher: z.string().max(120).optional() }, study.upsertLessonCommand],
  ["delete_study_lesson", "Удалить шаблон занятия", "Удаляет занятие из всего повторяющегося расписания после подтверждения. Не удаляет ДЗ.",
    { lessonId: id(), confirm: z.boolean() }, study.deleteLessonCommand, "delete"],
  ["set_study_week_cycle", "Настроить чередование недель", "Укажи дату опорной недели и её чётность. Дата приводится к понедельнику этой недели; следующие недели чередуются каждые 7 дней.",
    { anchorDate: date(), parity: z.enum(["even", "odd"]) }, study.setWeekCycleCommand],
  ["change_lesson_occurrence", "Изменить одну пару", "Отмена, перенос даты/времени/аудитории или восстановление одного повторения, без изменения недельного шаблона.",
    { lessonId: id(), date: date(), operation: z.enum(["cancel", "move", "restore"]), targetDate, startTime: time().optional(), endTime: time().optional(), room: z.string().max(80).optional(), confirm: z.boolean().optional() }, study.changeLessonOccurrenceCommand, "conditional"],
  ["upsert_homework", "Создать или изменить домашнее задание", "Если новый срок не указан, выбирает начало следующей практики от реального сегодняшнего дня и времени; при отсутствии практик — следующего занятия. workDate не меняет dueDate. Для завершения/удаления используй complete_task/delete_task.",
    { taskId: z.string().max(160).optional(), subjectId: id().optional(), title: text(200).optional(), details: z.string().max(4000).optional(),
      dueDate: targetDate, dueTime: time().or(z.literal("")).optional(), workDate: targetDate, fileIds: z.array(id()).max(30).optional(),
      dueReminderOffset: z.enum(["none", "0", "5", "15", "30", "60", "1440"]).optional() }, study.upsertHomeworkCommand],
  ["update_study_material", "Изменить материал", "Меняет отображаемое имя и предмет существующего материала, без повторной загрузки и изменения оригинала в Drive.",
    { fileId: id(), name: text(240).optional(), subjectId: z.string().max(160).optional() }, study.updateMaterialCommand],
  ["remove_study_material", "Убрать материал из приложения", "Убирает материал и его ссылки в ДЗ после подтверждения. Оригинальный файл в Google Drive НЕ удаляет.",
    { fileId: id(), confirm: z.boolean() }, study.removeMaterialCommand, "delete"],
  ["get_account_preferences", "Получить настройки аккаунта", "Синхронизируемые настройки без паролей, токенов и локальных черновиков. Локальные разрешения уведомлений MCP изменить не может.",
    {}, getAccountPreferences, "read"],
  ["update_account_preferences", "Изменить настройки аккаунта", "Тема, цвет, плотность, навигация, формат времени, начало недели, тихие часы, часовой пояс. Не изменяет полномочия MCP, авторизацию и настройки конкретного устройства.",
    { timeZone: z.string().min(1).max(100).optional(), preferences: z.object({
      themePreference: z.enum(["dark", "light", "system"]).optional(),
      accentPreference: z.enum(["emerald", "blue", "orange", "violet", "rose", "cyan", "amber", "lime"]).or(color()).optional(),
      densityPreference: z.enum(["compact", "comfortable"]).optional(), firstDayOfWeek: z.enum(["monday", "sunday"]).optional(), timeFormat: z.enum(["12", "24"]).optional(),
      navigationPreferences: z.object({ hidden: z.array(z.enum(["tasks", "timeline", "habits", "goals", "overview", "study", "nutrition", "journal", "board", "archive"])).max(10),
        mobile: z.array(z.enum(["tasks", "timeline", "habits", "goals", "overview", "study", "nutrition", "journal", "board", "archive", "settings"])).min(1).max(4) }).strict().optional(),
      quietHours: z.object({ enabled: z.boolean(), start: time(), end: time() }).strict().optional(),
    }).strict().optional() }, updateAccountPreferencesCommand],
];

export const WORKSPACE_TOOL_NAMES = definitions.map(([name]) => name);

export function registerWorkspaceTools(server, context, helpers) {
  for (const [name, title, description, fields, operation, mode] of definitions) {
    const read = mode === "read";
    const schema = z.object({ ...fields, ...(read ? {} : { requestId: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/) }) }).strict();
    server.registerTool(name, { title, description, inputSchema: schema,
      securitySchemes: helpers.security, annotations: { readOnlyHint: read, destructiveHint: mode === "delete" || mode === "conditional", openWorldHint: false } },
    async (raw) => {
      const input = schema.parse(raw);
      const execute = (state) => operation(state, input, stateOptions(state, context));
      return read ? helpers.readTool(context, execute) : helpers.writeTool(context, execute);
    });
  }
}

function stateOptions(state, context) {
  const now = new Date();
  const timeZone = stateTimeZone(state, context.timeZone);
  return { today: toDateKey(now, timeZone), currentTime: new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now) };
}
