import studyModel from "../app/src/study/study-model.js";
import checklist from "../app/src/tasks/task-checklist.js";
import { createTaskCommand } from "./task-service.mjs";
import { command, dateKey, entity, page, removeEntity, requireConfirmation, timeValue } from "./workspace-service.mjs";

export function getStudySchedule(state, input) {
  const from = dateKey(input.from), to = dateKey(input.to);
  const length = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (length < 1 || length > 93) throw new Error("Период расписания: от 1 до 93 дней");
  const days = Array.from({ length }, (_, offset) => {
    const date = new Date(Date.parse(from) + offset * 86400000).toISOString().slice(0, 10);
    return { date, parity: studyModel.weekParity(date, state.studyWeekCycle),
      lessons: studyModel.eventsForDate(state, date, { includeArchived: input.includeArchived }).filter((item) => !input.subjectId || item.subjectId === input.subjectId)
        .map((item) => ({ ...item, originalDate: Object.entries(item.exceptions || {}).find(([, override]) => !override.cancelled && override.date === date)?.[0] || date })) };
  });
  return { from, to, days, weekCycle: state.studyWeekCycle || {} };
}

export function listHomework(state, input, options) {
  let tasks = (state.tasks || []).filter((task) => task.studySubjectId && (!input.subjectId || task.studySubjectId === input.subjectId));
  if (input.view !== "all") tasks = tasks.filter((task) => studyModel.isHomeworkVisible(task, options.today) === (input.view !== "history"));
  if (!input.includeArchived) tasks = tasks.filter((task) => !(state.studySubjects || []).find((subject) => subject.id === task.studySubjectId)?.archived);
  return page(tasks.sort((a, b) => String(a.dueDate || a.date).localeCompare(String(b.dueDate || b.date))), input);
}

export function upsertSubjectCommand(state, input, options) {
  return command(state, input, "upsert_study_subject", (next, now, id) => {
    const subject = input.subjectId ? entity(next, "studySubjects", input.subjectId) : { id, createdAt: now, color: "#56c8a6", archived: false };
    for (const key of ["name", "teacher", "semester", "color", "archived"]) if (input[key] !== undefined) subject[key] = input[key];
    if (!String(subject.name || "").trim()) throw new Error("Укажите название предмета");
    subject.updatedAt = now;
    if (!input.subjectId) next.studySubjects.push(subject);
    return { subject, summary: `Предмет «${subject.name}» сохранён` };
  }, options);
}

export function deleteSubjectCommand(state, input, options) {
  requireConfirmation(input);
  return command(state, input, "delete_study_subject", (next, now) => {
    if (next.studyLessons.some((item) => item.subjectId === input.subjectId) || next.tasks.some((item) => item.studySubjectId === input.subjectId)
      || next.studyFiles.some((item) => item.subjectId === input.subjectId) || next.notes.some((item) => item.subjectId === input.subjectId)) {
      throw new Error("Предмет связан с занятиями, ДЗ, файлами или заметками. Архивируйте его вместо удаления.");
    }
    removeEntity(next, "studySubjects", input.subjectId, now);
    return { summary: "Предмет удалён" };
  }, options);
}

export function archiveSemesterCommand(state, input, options) {
  requireConfirmation(input);
  return command(state, input, "set_semester_archived", (next, now) => {
    const subjects = next.studySubjects.filter((item) => (item.semester || "") === input.semester);
    if (!subjects.length) throw new Error("Семестр не найден");
    subjects.forEach((subject) => { subject.archived = input.archived; subject.updatedAt = now; });
    return { subjects, summary: "Состояние семестра изменено; занятия, ДЗ и файлы сохранены" };
  }, options);
}

export function upsertLessonCommand(state, input, options) {
  return command(state, input, "upsert_study_lesson", (next, now, id) => {
    const current = input.lessonId ? entity(next, "studyLessons", input.lessonId) : { id, createdAt: now, exceptions: {}, weekType: "all", lessonType: "" };
    const lesson = { ...current };
    for (const key of ["subjectId", "weekday", "weekType", "lessonType", "startTime", "endTime", "room", "teacher"]) if (input[key] !== undefined) lesson[key] = input[key];
    entity(next, "studySubjects", lesson.subjectId);
    timeValue(lesson.startTime); timeValue(lesson.endTime);
    if (lesson.endTime <= lesson.startTime) throw new Error("Конец занятия должен быть позже начала");
    if (!Number.isInteger(lesson.weekday) || lesson.weekday < 0 || lesson.weekday > 6) throw new Error("День недели: 0–6, воскресенье — 0");
    if (lesson.weekType !== "all" && !next.studyWeekCycle?.anchorMonday) throw new Error("Сначала настройте опорную неделю");
    lesson.updatedAt = now;
    next.studyLessons = [...next.studyLessons.filter((item) => item.id !== lesson.id), lesson];
    return { lesson, summary: "Занятие сохранено" };
  }, options);
}

export function deleteLessonCommand(state, input, options) {
  requireConfirmation(input);
  return command(state, input, "delete_study_lesson", (next, now) => {
    removeEntity(next, "studyLessons", input.lessonId, now);
    return { summary: "Занятие удалено из расписания; ДЗ сохранены" };
  }, options);
}

export function setWeekCycleCommand(state, input, options) {
  return command(state, input, "set_study_week_cycle", (next, now) => {
    const anchorMonday = studyModel.mondayKey(dateKey(input.anchorDate));
    next.studyWeekCycle = { anchorMonday, anchorParity: input.parity, updatedAt: now };
    return { weekCycle: next.studyWeekCycle, summary: "Чередование учебных недель настроено" };
  }, options);
}

export function changeLessonOccurrenceCommand(state, input, options) {
  if (input.operation === "cancel") requireConfirmation(input);
  return command(state, input, "change_lesson_occurrence", (next, now) => {
    const lesson = entity(next, "studyLessons", input.lessonId);
    const date = dateKey(input.date);
    const sourceDate = lesson.exceptions?.[date] ? date : Object.entries(lesson.exceptions || {}).find(([, override]) => override.date === date)?.[0] || date;
    if (!studyModel.lessonOccursOnDate(lesson, date, next.studyWeekCycle) && !lesson.exceptions?.[sourceDate]) throw new Error("Занятие не запланировано на эту дату");
    lesson.exceptions ||= {};
    if (input.operation === "restore") delete lesson.exceptions[sourceDate];
    else if (input.operation === "cancel") lesson.exceptions[sourceDate] = { date: lesson.exceptions[sourceDate]?.date || date, cancelled: true, room: "" };
    else {
      const targetDate = dateKey(input.targetDate || date);
      const startTime = timeValue(input.startTime || lesson.startTime), endTime = timeValue(input.endTime || lesson.endTime);
      if (endTime <= startTime) throw new Error("Конец занятия должен быть позже начала");
      if (targetDate !== date && studyModel.lessonOccursOnDate(lesson, targetDate, next.studyWeekCycle)) throw new Error("В этот день уже есть повторение этого занятия");
      if (targetDate !== sourceDate && lesson.exceptions[targetDate]) throw new Error("В выбранный день уже есть исключение этого занятия");
      lesson.exceptions[sourceDate] = { date: targetDate, startTime, endTime, room: input.room ?? lesson.room, cancelled: false };
    }
    lesson.updatedAt = now;
    return { lesson, originalDate: sourceDate, summary: "Изменено только выбранное занятие, не вся серия" };
  }, options);
}

export function upsertHomeworkCommand(state, input, options) {
  return command(state, input, "upsert_homework", (next, now) => {
    const current = input.taskId ? entity(next, "tasks", input.taskId.replace(/^task:/, "")) : null;
    if (current && !current.studySubjectId) throw new Error("Задача не является ДЗ");
    const subjectId = input.subjectId || current?.studySubjectId;
    const subject = entity(next, "studySubjects", subjectId);
    if (subject.archived) throw new Error("Сначала восстановите предмет из архива");
    const occurrence = !current && input.dueDate === undefined
      ? studyModel.nextLessonOccurrence(next.studyLessons, subjectId, options.today, next.studyWeekCycle, options.currentTime) : null;
    const dueDate = dateKey(input.dueDate || current?.dueDate || occurrence?.date);
    const dueTime = input.dueTime !== undefined ? input.dueTime : current?.dueTime ?? occurrence?.startTime ?? "";
    if (dueTime) timeValue(dueTime);
    const workDate = dateKey(input.workDate || current?.date || dueDate);
    const title = input.title ?? current?.title;
    if (!String(title || "").trim()) throw new Error("Укажите название ДЗ");
    let task = current;
    if (!task) {
      const mutation = createTaskCommand(next, { requestId: input.requestId, title, date: workDate }, { now, today: options.today });
      Object.assign(next, mutation.state); task = mutation.task;
    }
    if (input.fileIds) input.fileIds.forEach((id) => entity(next, "studyFiles", id));
    if (task.date !== workDate) {
      if (next.taskOrder[task.date]) next.taskOrder[task.date] = next.taskOrder[task.date].filter((id) => id !== task.id);
      checklist.moveDate(task, task.date, workDate);
      if (task.completed?.[task.date] === true) { delete task.completed[task.date]; task.completed[workDate] = true; }
    }
    next.taskOrder[workDate] = [...new Set([...(next.taskOrder[workDate] || []), task.id])];
    Object.assign(task, { title, date: workDate, dueDate, dueTime, dueReminderOffset: dueTime ? input.dueReminderOffset || task.dueReminderOffset || "60" : "none",
      studySubjectId: subjectId, studyDetails: input.details ?? task.studyDetails ?? "", studyAssignedDate: task.studyAssignedDate || options.today,
      studyFileIds: input.fileIds ?? task.studyFileIds ?? [], updatedAt: now });
    return { task, suggestedLesson: occurrence || null, summary: `ДЗ сохранено: работа ${workDate}, сдача ${dueDate}${dueTime ? ` ${dueTime}` : ""}` };
  }, options);
}

export function updateMaterialCommand(state, input, options) {
  return command(state, input, "update_study_material", (next, now) => {
    const file = entity(next, "studyFiles", input.fileId);
    if (input.subjectId) entity(next, "studySubjects", input.subjectId);
    if (input.name !== undefined) file.name = input.name;
    if (input.subjectId !== undefined) file.subjectId = input.subjectId;
    file.updatedAt = now;
    return { file, summary: "Название и привязка материала сохранены; файл в Drive не изменялся" };
  }, options);
}

export function removeMaterialCommand(state, input, options) {
  requireConfirmation(input);
  return command(state, input, "remove_study_material", (next, now) => {
    removeEntity(next, "studyFiles", input.fileId, now);
    next.tasks.forEach((task) => {
      if (task.studyFileIds?.includes(input.fileId)) { task.studyFileIds = task.studyFileIds.filter((id) => id !== input.fileId); task.updatedAt = now; }
    });
    return { summary: "Материал убран из Parsitasks и вложений ДЗ; оригинал в Google Drive сохранён" };
  }, options);
}
