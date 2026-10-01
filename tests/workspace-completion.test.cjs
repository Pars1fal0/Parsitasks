const assert = require("node:assert/strict");
const study = require("../app/src/study/study-model.js");
const board = require("../app/src/board/board-model.js");
const goals = require("../app/src/goals/goals-view.js");
const activity = require("../app/src/goals/goal-activity.js");
const { searchWorkspace } = require("../app/src/ui/global-search.js");
const { mergeStates } = require("../app/src/core/state-merge.js");
const { createSyncMetadataTracker } = require("../app/src/sync/sync-metadata.js");
const config = {
  cleanText: (value) => String(value || "").trim(), createId: () => "new",
  cleanTimeValue: (value) => /^\d\d:\d\d$/.test(value || "") ? value : "",
  sanitizeColor: (value) => value || "", normalizeDateKey: (value) => value || "",
};
const subject = { id: "math", name: "Математика", semester: "Осень 2026" };
const lesson = { id: "practice", subjectId: "math", weekday: 4, weekType: "all", startTime: "09:00", endTime: "10:30", lessonType: "practice" };

module.exports = [
  { name: "archives study without deleting lessons or homework and allows historical viewing", fn() {
    const subjects = study.normalizeSubjects([{ ...subject, archived: true }], config);
    const lessons = study.normalizeLessons([lesson], config, subjects);
    const state = { studySubjects: subjects, studyLessons: lessons };
    assert.equal(subjects[0].semester, "Осень 2026");
    assert.equal(lessons.length, 1);
    assert.equal(study.eventsForDate(state, "2026-10-01").length, 0);
    assert.equal(study.eventsForDate(state, "2026-10-01", { includeArchived: true }).length, 1);
  } },
  { name: "cancels or moves only one practice and uses the changed date for homework suggestions", fn() {
    const changed = { ...lesson, exceptions: { "2026-10-01": { date: "2026-10-02", startTime: "11:00", endTime: "12:00", room: "502" } } };
    const lessons = study.normalizeLessons([changed], config, [subject]);
    const state = { studySubjects: [subject], studyLessons: lessons };
    assert.equal(study.eventsForDate(state, "2026-10-01").length, 0);
    assert.equal(study.eventsForDate(state, "2026-10-02")[0].startTime, "11:00");
    assert.equal(study.eventsForDate(state, "2026-10-02")[0].room, "502");
    assert.equal(study.nextLessonDate(lessons, "math", "2026-09-30"), "2026-10-02");
    assert.equal(study.eventsForDate(state, "2026-10-08")[0].startTime, "09:00");
    lessons[0].exceptions["2026-10-01"].cancelled = true;
    assert.equal(study.eventsForDate(state, "2026-10-02").length, 0);
    assert.equal(study.nextLessonDate(lessons, "math", "2026-09-30"), "2026-10-08");
  } },
  { name: "search ranks useful results before grouped history and supports type filtering", fn() {
    const completed = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [new Date(Date.UTC(2026, 7, index + 1)).toISOString().slice(0, 10), true]));
    const state = { tasks: [{ id: "repeat", title: "Математика", date: "2026-08-01", repeat: "daily", completed }], studySubjects: [subject], notes: [{ id: "note", title: "Математика", body: "Правила" }] };
    const results = searchWorkspace(state, "математика");
    assert.equal(results.filter((item) => item.type === "archive").length, 1);
    assert.equal(results.at(-1).type, "archive");
    assert.ok(results.some((item) => item.type === "subject"));
    assert.ok(results.some((item) => item.type === "note"));
    assert.deepEqual(searchWorkspace(state, "математика", { type: "note" }).map((item) => item.id), ["note"]);
    assert.match(results.at(-1).detail, /60 раз/);
  } },
  { name: "goals without deadlines are active and paused goals do not auto-complete", fn() {
    const goal = { id: "g", title: "Прочитать", dueDate: "", paused: true, status: "active", linkedTaskIds: ["t"], steps: [] };
    assert.equal(goals.goalState({ ...goal, paused: false }, "2026-10-01"), "active");
    assert.equal(goals.goalState(goal, "2026-10-01"), "paused");
    assert.deepEqual(goals.goalStats([goal, { ...goal, archived: true }], "2026-10-01"), { active: 0, overdue: 0, done: 0 });
    const state = { goals: [goal], tasks: [{ id: "t", completed: { "2026-10-01": true } }] };
    assert.equal(activity.reconcileGoalStatuses(state), false);
    assert.equal(goal.status, "active");
  } },
  { name: "named boards and study changes survive sync alongside independent edits", fn() {
    const items = board.normalizeItems([{ id: "b", type: "board", text: "Учёба" }, { id: "card", type: "text", text: "Формулы", boardId: "b" }, { id: "old", type: "text", text: "Старая карточка" }]);
    assert.equal(items.find((item) => item.id === "b").text, "Учёба");
    assert.equal(items.find((item) => item.id === "card").boardId, "b");
    assert.equal(items.find((item) => item.id === "old").boardId, "");
    const old = { boardItems: items, studySubjects: [subject], studyLessons: [lesson], goals: [{ id: "g", title: "Цель", paused: false }], tasks: [{ id: "t", title: "Задача" }] };
    const next = structuredClone(old); next.studySubjects[0].archived = true; next.studyLessons[0].exceptions = { "2026-10-01": { cancelled: true } }; next.goals[0].paused = true; next.tasks[0].sourceNoteId = "note";
    createSyncMetadataTracker({ now: () => "2026-10-01T10:00:00.000Z" }).trackChanges(old, next);
    const merged = mergeStates(old, next);
    assert.equal(merged.studySubjects[0].archived, true);
    assert.equal(merged.studyLessons[0].exceptions["2026-10-01"].cancelled, true);
    assert.equal(merged.goals[0].paused, true);
    assert.equal(merged.tasks[0].sourceNoteId, "note");
    assert.equal(merged.boardItems.length, 3);
  } },
];
