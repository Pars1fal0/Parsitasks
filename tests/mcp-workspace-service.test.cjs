const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const documentState = require("../app/src/core/document-state.js");
const browserActivity = require("../app/src/integrations/mcp-activity.js");
const load = (name) => import(pathToFileURL(path.resolve(__dirname, `../mcp/${name}.mjs`)).href);
const now = "2026-10-07T08:00:00.000Z";
const options = { now, today: "2026-10-07", currentTime: "12:00" };
function fixture() {
  return documentState.normalizeState({ schemaVersion: 26, profile: { timeZone: "Europe/Saratov" },
    tasks: [{ id: "task-1", title: "Work", date: "2026-10-07", repeat: "none" }, { id: "daily-1", title: "Repeat", date: "2026-10-01", repeat: "daily" }],
    habits: [{ id: "habit-1", title: "Water", startDate: "2026-10-01", type: "number", goal: 2000, unit: "ml", repeat: "daily" }],
    goals: [{ id: "goal-1", title: "Goal", steps: [] }],
    studySubjects: [{ id: "subject-1", name: "Math", semester: "Autumn" }],
    studyWeekCycle: { anchorMonday: "2026-09-28", anchorParity: "even", updatedAt: now },
    studyLessons: [{ id: "practice-1", subjectId: "subject-1", weekday: 5, weekType: "all", lessonType: "practice", startTime: "11:30", endTime: "13:00" },
      { id: "lecture-1", subjectId: "subject-1", weekday: 4, weekType: "all", lessonType: "lecture", startTime: "08:00", endTime: "09:30" }],
    studyFiles: [{ id: "file-1", googleId: "drive-1", name: "Book.pdf", subjectId: "subject-1" }],
    notes: [{ id: "note-1", title: "Note", body: "Text", subjectId: "subject-1", updatedAt: "2026-10-01T00:00:00Z" }],
  });
}
module.exports = [
  { name: "MCP workspace pagination discovers all supported entity collections without mutating state", async fn() {
    const service = await load("workspace-service"); const state = fixture(); const original = structuredClone(state);
    for (const type of ["task", "habit", "goal", "note", "board", "subject", "lesson", "material", "category"]) {
      const result = service.listWorkspaceEntities(state, { type, limit: 1 }); assert.ok(result.items.length <= 1);
    }
    assert.equal(service.listWorkspaceEntities(state, { type: "task", taskView: "day", date: options.today }).total, 2);
    assert.deepEqual(state, original);
  } },
  { name: "MCP note editing rejects stale revisions and foreign references; retries and undo survive browser normalization", async fn() {
    const service = await load("workspace-service"); const activity = await load("activity-service"); const state = fixture();
    const input = { requestId: "note-update-001", noteId: "note-1", body: "Changed", expectedUpdatedAt: state.notes[0].updatedAt };
    assert.throws(() => service.upsertNoteCommand(state, { ...input, expectedUpdatedAt: now }, options), /expectedUpdatedAt/);
    assert.throws(() => service.upsertNoteCommand(state, { ...input, taskId: "foreign-task" }, options), /не найден/);
    const change = service.upsertNoteCommand(state, input, options);
    assert.equal(state.notes[0].body, "Text"); assert.equal(change.note.body, "Changed");
    assert.equal(service.upsertNoteCommand(change.state, input, options).changed, false);
    const normalized = documentState.normalizeState(change.state);
    const undone = activity.undoMcpActivity(normalized, change.activity.id, "2026-10-08T00:00:00Z");
    assert.equal(undone.state.notes[0].body, "Text");
    assert.equal(browserActivity.undoActivity(normalized, change.activity.id).state.notes[0].body, "Text");
    change.state.notes[0].body = "Newer user edit";
    assert.throws(() => activity.undoMcpActivity(change.state, change.activity.id), /данные изменились/);
    assert.throws(() => browserActivity.undoActivity(change.state, change.activity.id), /данные изменились/);
  } },
  { name: "MCP note deletion requires confirmation, leaves tasks intact and restores a fresh non-tombstoned identity", async fn() {
    const service = await load("workspace-service"); const activity = await load("activity-service"); const state = fixture();
    state.tasks[0].sourceNoteId = "note-1";
    assert.throws(() => service.deleteNoteCommand(state, { requestId: "note-delete-001", noteId: "note-1" }, options), /подтверждение/);
    const result = service.deleteNoteCommand(state, { requestId: "note-delete-001", noteId: "note-1", confirm: true }, options);
    const undone = activity.undoMcpActivity(result.state, result.activity.id, "2026-10-08T00:00:00Z");
    assert.equal(result.state.tasks.length, state.tasks.length);
    assert.notEqual(undone.state.notes[0].id, "note-1");
    assert.equal(undone.state.tasks.find((task) => task.id === "task-1").sourceNoteId, undone.state.notes[0].id);
  } },
  { name: "MCP tasks from notes retain backlinks without rewriting note text", async fn() {
    const service = await load("workspace-service"); const state = fixture();
    const change = service.taskFromNoteCommand(state, { requestId: "note-task-001", noteId: "note-1", title: "Read" }, options);
    assert.equal(change.task.sourceNoteId, "note-1"); assert.deepEqual(change.state.notes, state.notes);
    assert.equal(change.state.mcpActivity.length, 1);
  } },
  { name: "MCP subtasks separate one recurring occurrence and preserve past and future checklist history", async fn() {
    const service = await load("workspace-service"); const state = fixture();
    const change = service.changeSubtaskCommand(state, { requestId: "sub-create-001", taskId: "daily-1", operation: "create", title: "Step", date: options.today, scope: "occurrence" }, options);
    assert.equal(change.task.repeat, "none"); assert.equal(change.task.checklist.length, 1);
    assert.equal(change.state.tasks.find((task) => task.id === "daily-1").checklist.length, 0);
    assert.equal(change.state.mcpActivity.length, 1);
    const done = service.changeSubtaskCommand(change.state, { requestId: "sub-done-001", taskId: change.task.id, itemId: change.task.checklist[0].id, operation: "complete", date: options.today }, options);
    assert.equal(done.task.checklistLogs[options.today][change.task.checklist[0].id].done, true);
    assert.notEqual(done.task.completed[options.today], true);
    assert.throws(() => service.changeSubtaskCommand(state, { requestId: "sub-create-002", taskId: "daily-1", operation: "create", title: "Step", date: options.today }, options), /scope|область/i);
  } },
  { name: "MCP deletion of the last subtask cleans logs and remains undoable", async fn() {
    const service = await load("workspace-service"); const activity = await load("activity-service"); const state = fixture();
    state.tasks[0].checklist = [{ id: "sub-1", title: "Step" }];
    state.tasks[0].checklistLogs[options.today] = { "sub-1": { done: true, updatedAt: now } };
    const change = service.changeSubtaskCommand(state, { requestId: "sub-delete-001", taskId: "task-1", itemId: "sub-1", operation: "delete", confirm: true }, options);
    assert.equal(change.task.checklist.length, 0); assert.equal(change.task.checklistLogs[options.today]?.["sub-1"], undefined);
    assert.equal(activity.undoMcpActivity(change.state, change.activity.id).state.tasks.find((task) => task.id === "task-1").checklist.length, 1);
  } },
  { name: "MCP board cards validate sources and parent boards; deleting a board requires explicit contents consent", async fn() {
    const service = await load("workspace-service"); const activity = await load("activity-service"); let state = fixture();
    const board = service.upsertBoardItemCommand(state, { requestId: "board-create-001", type: "board", text: "Study" }, options);
    const card = service.upsertBoardItemCommand(board.state, { requestId: "card-create-001", type: "link", boardId: board.item.id, sourceType: "task", sourceId: "task-1", backgroundColor: "#efeaff" }, options);
    assert.throws(() => service.upsertBoardItemCommand(state, { requestId: "card-create-002", type: "link", sourceType: "note", sourceId: "foreign" }, options), /не найден/);
    assert.throws(() => service.upsertBoardItemCommand(state, { requestId: "card-image-001", type: "image", assetId: "foreign" }, options), /загрузить/);
    assert.throws(() => service.deleteBoardItemCommand(card.state, { requestId: "board-delete-001", itemId: board.item.id, confirm: true }, options), /deleteContents/);
    const removed = service.deleteBoardItemCommand(card.state, { requestId: "board-delete-001", itemId: board.item.id, confirm: true, deleteContents: true }, options);
    assert.equal(removed.state.tasks.length, state.tasks.length);
    const undone = activity.undoMcpActivity(removed.state, removed.activity.id);
    const restoredBoard = undone.state.boardItems.find((item) => item.type === "board");
    assert.equal(undone.state.boardItems.find((item) => item.type === "link").boardId, restoredBoard.id);
  } },
  { name: "MCP homework defaults to the next practice time from real today instead of a selected calendar date", async fn() {
    const service = await load("study-service"); const state = fixture();
    const result = service.upsertHomeworkCommand(state, { requestId: "homework-create-001", subjectId: "subject-1", title: "Exercises", workDate: "2026-10-15" }, options);
    assert.equal(result.task.dueDate, "2026-10-09"); assert.equal(result.task.dueTime, "11:30"); assert.equal(result.task.date, "2026-10-15");
    assert.equal(result.state.mcpActivity.length, 1);
    state.studyLessons = state.studyLessons.filter((lesson) => lesson.lessonType === "lecture");
    assert.equal(service.upsertHomeworkCommand(state, { requestId: "homework-create-002", subjectId: "subject-1", title: "Read" }, options).task.dueDate, "2026-10-08");
    state.studyLessons = [];
    assert.throws(() => service.upsertHomeworkCommand(state, { requestId: "homework-create-003", subjectId: "subject-1", title: "Read" }, options), /дату/);
  } },
  { name: "MCP homework moves preparation independently of submission and retains completed history through due day", async fn() {
    const service = await load("study-service"); const state = fixture();
    const result = service.upsertHomeworkCommand(state, { requestId: "homework-create-001", subjectId: "subject-1", title: "Exercises", workDate: options.today }, options);
    result.task.completed[options.today] = true;
    const moved = service.upsertHomeworkCommand(result.state, { requestId: "homework-update-001", taskId: result.task.id, workDate: "2026-10-08" }, options);
    assert.equal(moved.task.dueDate, "2026-10-09"); assert.equal(moved.task.completed["2026-10-08"], true);
    assert.equal(service.listHomework(moved.state, { view: "current" }, { today: "2026-10-09" }).total, 1);
    assert.equal(service.listHomework(moved.state, { view: "current" }, { today: "2026-10-10" }).total, 0);
    assert.equal(service.listHomework(moved.state, { view: "history" }, { today: "2026-10-10" }).total, 1);
  } },
  { name: "MCP study archive preserves all relations; linked subjects cannot be deleted", async fn() {
    const service = await load("study-service"); const state = fixture();
    assert.throws(() => service.deleteSubjectCommand(state, { requestId: "subject-delete-001", subjectId: "subject-1", confirm: true }, options), /Архивируйте/);
    const archived = service.archiveSemesterCommand(state, { requestId: "semester-archive-001", semester: "Autumn", archived: true, confirm: true }, options);
    assert.equal(archived.state.studyLessons.length, state.studyLessons.length); assert.equal(archived.state.studyFiles.length, state.studyFiles.length);
    assert.equal(service.getStudySchedule(archived.state, { from: "2026-10-09", to: "2026-10-09" }).days[0].lessons.length, 0);
    assert.equal(service.getStudySchedule(archived.state, { from: "2026-10-09", to: "2026-10-09", includeArchived: true }).days[0].lessons.length, 1);
  } },
  { name: "MCP study alternating weeks and single cancellations move homework suggestions without changing the series", async fn() {
    const service = await load("study-service"); const activity = await load("activity-service"); const state = fixture();
    const cycle = service.setWeekCycleCommand(state, { requestId: "study-cycle-001", anchorDate: "2026-10-02", parity: "odd" }, options);
    assert.equal(cycle.weekCycle.anchorMonday, "2026-09-28");
    assert.equal(activity.undoMcpActivity(cycle.state, cycle.activity.id).state.studyWeekCycle.anchorParity, "even");
    const cancelled = service.changeLessonOccurrenceCommand(state, { requestId: "practice-cancel-001", lessonId: "practice-1", date: "2026-10-09", operation: "cancel", confirm: true }, options);
    assert.equal(service.upsertHomeworkCommand(cancelled.state, { requestId: "homework-create-001", subjectId: "subject-1", title: "Exercise" }, options).task.dueDate, "2026-10-16");
    assert.equal(cancelled.lesson.weekday, 5);
    const moved = service.changeLessonOccurrenceCommand(state, { requestId: "practice-move-001", lessonId: "practice-1", date: "2026-10-09", operation: "move", targetDate: "2026-10-10" }, options);
    assert.equal(service.getStudySchedule(moved.state, { from: "2026-10-10", to: "2026-10-10" }).days[0].lessons.length, 1);
  } },
  { name: "MCP material removal keeps Drive originals, cleans homework links and can be undone", async fn() {
    const service = await load("study-service"); const activity = await load("activity-service"); const state = fixture();
    state.tasks[0].studyFileIds = ["file-1"];
    const change = service.removeMaterialCommand(state, { requestId: "material-delete-001", fileId: "file-1", confirm: true }, options);
    assert.match(change.summary, /оригинал.*сохранён/); assert.deepEqual(change.state.tasks[0].studyFileIds, []);
    const undone = activity.undoMcpActivity(change.state, change.activity.id);
    assert.equal(undone.state.tasks.find((task) => task.id === "task-1").studyFileIds[0], undone.state.studyFiles[0].id);
  } },
  { name: "MCP account preferences are cloud profile entries, never credentials or permission escalation", async fn() {
    const service = await load("preferences-service"); const activity = await load("activity-service"); const state = fixture();
    const result = service.updateAccountPreferencesCommand(state, { requestId: "preferences-001", preferences: { accentPreference: "#ab34ef", navigationPreferences: { hidden: ["nutrition"], mobile: ["study", "tasks"] } } }, options);
    assert.equal(result.state.profile.preferences.accentPreference.value, "#ab34ef");
    assert.equal(result.state.profile.preferences.navigationPreferences.value.mobile[0], "study");
    assert.deepEqual(result.state.profile.journalAccess, state.profile.journalAccess);
    assert.throws(() => service.updateAccountPreferencesCommand(state, { requestId: "preferences-002", preferences: { journalAccess: { read: true } } }, options), /недоступна/);
    assert.throws(() => service.updateAccountPreferencesCommand(state, { requestId: "preferences-003", timeZone: "fake/zone" }, options), /пояс/);
    assert.deepEqual(activity.undoMcpActivity(documentState.normalizeState(result.state), result.activity.id).state.profile.preferences, state.profile.preferences);
  } },
  { name: "MCP goal target configuration, habit freezing and task ordering use real existing entities", async fn() {
    const service = await load("workspace-service"); const state = fixture();
    const goal = service.configureGoalCommand(state, { requestId: "goal-config-001", goalId: "goal-1", taskTargets: [{ taskId: "daily-1", mode: "count", targetCount: 3, startDate: options.today }] }, options);
    assert.deepEqual(goal.goal.linkedTaskIds, ["daily-1"]); assert.equal(goal.goal.taskTargets[0].targetCount, 3);
    const frozen = service.freezeHabitCommand(state, { requestId: "habit-freeze-001", habitId: "habit-1", date: options.today, frozen: true }, options);
    assert.equal(frozen.habit.freezeDays[options.today].active, true);
    const ordered = service.reorderTasksCommand(state, { requestId: "task-order-001", date: options.today, taskIds: ["daily-1"] }, options);
    assert.deepEqual(ordered.order, ["daily-1", "task-1"]);
    assert.throws(() => service.reorderTasksCommand(state, { requestId: "task-order-002", date: options.today, taskIds: ["foreign"] }, options), /другого дня/);
  } },
  { name: "MCP search includes new domains, filters before limiting and never discloses denied journal entries", async fn() {
    const service = await load("task-service"); const state = fixture();
    state.journalEntries = [{ id: "journal-1", date: options.today, text: "Note" }]; state.profile.journalAccess.read = false;
    assert.equal(service.searchKnowledge(state, "Note", { limit: 1, types: ["note"] }).results[0].type, "note");
    assert.equal(service.searchKnowledge(state, "Note").results.some((item) => item.type === "journal"), false);
    assert.equal(service.fetchKnowledge(state, "journal:journal-1"), null);
    for (const id of ["note:note-1", "subject:subject-1", "lesson:practice-1", "material:file-1"]) assert.ok(service.fetchKnowledge(state, id));
  } },
  { name: "MCP creates deferred tasks and independent submission deadlines without losing checklist identities", async fn() {
    const service = await load("task-service"); const writes = await load("write-service"); const state = fixture();
    const created = service.createTaskCommand(state, { requestId: "a".repeat(100), title: "Later", date: null, dueDate: "2026-10-09", dueTime: "09:30", checklist: ["One", "Two"] }, options);
    assert.equal(created.task.date, null); assert.equal(created.task.checklist.length, 2); assert.notEqual(created.task.checklist[0].id, created.task.checklist[1].id);
    const deferred = writes.updateTaskCommand(state, { requestId: "task-defer-001", taskId: "task-1", date: null }, options);
    assert.equal(deferred.task.date, null); assert.equal(deferred.task.deferredFromDate, options.today);
    const scheduled = writes.updateTaskCommand(deferred.state, { requestId: "task-schedule-001", taskId: "task-1", date: "2026-10-08" }, options);
    assert.equal(scheduled.task.deferredFromDate, "");
  } },
  { name: "MCP newly created objects remain immediately undoable after the web client canonicalizes them", async fn() {
    const service = await load("workspace-service"); const study = await load("study-service"); const activity = await load("activity-service"); const state = fixture();
    const changes = [service.taskFromNoteCommand(state, { requestId: "undo-note-task-001", noteId: "note-1", title: "Read" }, options),
      study.upsertHomeworkCommand(state, { requestId: "undo-homework-001", subjectId: "subject-1", title: "Exercise" }, options),
      service.upsertBoardItemCommand(state, { requestId: "undo-text-card-001", type: "text", text: "Idea" }, options),
      study.upsertSubjectCommand(state, { requestId: "undo-subject-001", name: "Physics" }, options)];
    for (const change of changes) {
      const loaded = documentState.normalizeState(change.state);
      assert.doesNotThrow(() => activity.undoMcpActivity(loaded, change.activity.id));
      assert.doesNotThrow(() => browserActivity.undoActivity(loaded, change.activity.id));
    }
  } },
  { name: "MCP habit reordering and freezing survive normalization, undo and dated configuration", async fn() {
    const service = await load("workspace-service"); const management = await load("management-service"); const activity = await load("activity-service"); const state = fixture();
    const habit = management.createHabitCommand(state, { requestId: "flexible-habit-001", title: "Run", repeat: "weeklyGoal", weeklyTarget: 4, reminderTime: "18:30" }, options);
    assert.equal(habit.habit.weeklyTarget, 4); assert.equal(habit.habit.reminderTime, "18:30");
    const reordered = service.reorderHabitsCommand(habit.state, { requestId: "habit-order-001", habitIds: [habit.habit.id, "habit-1"] }, options);
    const normalized = documentState.normalizeState(reordered.state);
    assert.equal(activity.undoMcpActivity(normalized, reordered.activity.id).state.habits[0].id, "habit-1");
    assert.equal(browserActivity.undoActivity(normalized, reordered.activity.id).state.habits[0].id, "habit-1");
    const updated = management.updateHabitCommand(habit.state, { requestId: "habit-settings-001", habitId: "habit-1", numberStep: 250, fromDate: options.today }, options);
    assert.equal(updated.habit.numberStep, 250);
  } },
  { name: "MCP journal replacement versions text and rejects forbidden writes and stale revisions", async fn() {
    const service = await load("workspace-service"); const state = fixture();
    state.journalEntries = [{ id: "entry-1", date: options.today, text: "Original", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", revisions: [] }];
    const input = { requestId: "journal-replace-001", date: options.today, operation: "replace", text: "New", expectedUpdatedAt: state.journalEntries[0].updatedAt, confirm: true };
    const change = service.editJournalCommand(state, input, options);
    assert.equal(change.state.journalEntries[0].revisions[0].text, "Original");
    assert.ok(!JSON.stringify(change.entry).includes("Original"));
    assert.throws(() => service.editJournalCommand(change.state, { ...input, requestId: "journal-replace-002" }, options), /expectedUpdatedAt/);
    state.profile.journalAccess.write = false;
    assert.throws(() => service.editJournalCommand(state, input, options), /запрещена/);
  } },
  { name: "MCP new mutations preserve unknown workspace collections and refuse newer schemas", async fn() {
    const service = await load("workspace-service"); const state = fixture(); state.extraFuture = { keep: true };
    const change = service.upsertNoteCommand(state, { requestId: "preserve-001", title: "New", body: "Body" }, options);
    assert.deepEqual(change.state.extraFuture, state.extraFuture);
    state.schemaVersion = 27;
    assert.throws(() => service.upsertNoteCommand(state, { requestId: "future-schema-001", title: "No write" }, options), /обновите MCP/);
  } },
  { name: "MCP moving an already moved lesson changes its source exception rather than duplicating it", async fn() {
    const study = await load("study-service"); const state = fixture();
    const once = study.changeLessonOccurrenceCommand(state, { requestId: "lesson-move-once", lessonId: "practice-1", date: "2026-10-09", targetDate: "2026-10-10", operation: "move" }, options);
    const twice = study.changeLessonOccurrenceCommand(once.state, { requestId: "lesson-move-twice", lessonId: "practice-1", date: "2026-10-10", targetDate: "2026-10-11", operation: "move" }, options);
    assert.deepEqual(Object.keys(twice.lesson.exceptions), ["2026-10-09"]);
    const schedule = study.getStudySchedule(twice.state, { from: "2026-10-09", to: "2026-10-11" });
    assert.deepEqual(schedule.days.map((day) => day.lessons.length), [0, 0, 1]);
    assert.equal(schedule.days[2].lessons[0].originalDate, "2026-10-09");
  } },
];
