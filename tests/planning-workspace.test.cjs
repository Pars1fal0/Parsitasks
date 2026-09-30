const assert = require("node:assert/strict");
const { goalActivity, normalizeTaskTargets } = require("../app/src/goals/goal-activity.js");
const { moveSingleTask, moveTasksToLater, moveTasksToDate } = require("../app/src/tasks/task-moves.js");
const { eventsForDate, isHomeworkVisible } = require("../app/src/study/study-model.js");
const { searchWorkspace } = require("../app/src/ui/global-search.js");
const { createImportExport } = require("../app/src/settings/import-export.js");
const { createNotifications } = require("../app/src/platform/notifications.js");
const { buildBacklogEntries } = require("../app/src/core/planning-history.js");
module.exports = [
  { name: "unified backlog includes yesterday preparation even when surrender is in the future", fn() {
    const tasks = [
      { id: "hw", title: "Homework", repeat: "none", date: "2026-09-30", dueDate: "2026-10-09" },
      { id: "old", title: "Old", repeat: "none", date: "2026-09-10" },
      { id: "excluded", title: "Excluded", repeat: "none", date: "2026-09-30", excludedDates: { "2026-09-30": true } },
      { id: "daily", title: "Daily", repeat: "daily", date: "2026-09-29" },
    ];
    const options = { tasks, todayKey: "2026-10-01", includeYesterday: true,
      addDays: (key, days) => { const date = new Date(`${key}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); },
      isTaskDone: () => false, isTaskExcluded: (task, day) => task.excludedDates?.[day] === true, taskOccursOn: () => true };
    const entries = buildBacklogEntries(options);
    assert.equal(entries.some((entry) => entry.task.id === "hw"), true);
    assert.equal(entries.some((entry) => entry.task.id === "old"), true);
    assert.equal(entries.some((entry) => entry.task.id === "excluded"), false);
    assert.equal(entries.filter((entry) => entry.task.id === "daily").length, 2);
    assert.equal(buildBacklogEntries({ ...options, includeYesterday: false }).some((entry) => entry.task.id === "hw"), false);
  } },
  { name: "new counted goals ignore completions before the chosen start and deduplicate moved occurrences", fn() {
    const state = { tasks: [{ id: "daily", completed: { "2026-09-20": true, "2026-10-01": true } },
      { id: "copy", sourceTaskId: "daily", completed: { "2026-10-01": true, "2026-10-02": true } }] };
    const goal = { linkedTaskIds: ["daily"], taskTargets: [{ taskId: "daily", mode: "count", targetCount: 3, startDate: "2026-10-01" }] };
    const result = goalActivity(goal, state, { todayKey: "2026-10-02" });
    assert.equal(result.taskResults[0].count, 2); assert.equal(result.percent, 67); assert.equal(result.achieved, false);
    assert.equal(goalActivity({ linkedTaskIds: ["daily"] }, state, { todayKey: "2026-09-21" }).achieved, true);
    assert.equal(normalizeTaskTargets([{ taskId: "x", mode: "count", targetCount: 9000 }], "2026-10-01")[0].targetCount, 3650);
  } },
  { name: "moving preparation preserves legacy homework surrender date and completed visibility", fn() {
    const task = { id: "hw", studySubjectId: "math", date: "2026-10-09", time: "08:00", reminderOffset: "60", completed: {} };
    const state = { tasks: [task], taskOrder: {} };
    moveSingleTask(state, task, task.date, "2026-10-07");
    assert.equal(task.date, "2026-10-07"); assert.equal(task.dueDate, "2026-10-09"); assert.equal(task.dueTime, "08:00");
    task.completed[task.date] = true;
    assert.equal(isHomeworkVisible(task, "2026-10-09"), true);
    assert.equal(isHomeworkVisible(task, "2026-10-10"), false);
  } },
  { name: "bulk Later defers individual repeat occurrences without losing the series or history", fn() {
    const task = { id: "r", title: "Read", date: "2026-09-01", repeat: "daily", completed: { "2026-09-28": true } };
    const state = { tasks: [task], taskOrder: {} }; let counter = 0;
    const result = moveTasksToLater({ state, entries: ["2026-09-28", "2026-09-29", "2026-09-30", "2026-09-30"].map((dateKey) => ({ taskId: "r", dateKey })),
      helpers: { createId: () => `copy-${counter++}`, taskScheduledOn: () => true } });
    assert.equal(result.moved, 2); assert.equal(state.tasks.length, 3); assert.equal(task.repeat, "daily");
    assert.equal(task.completed["2026-09-28"], true); assert.equal(task.excludedDates["2026-09-29"], true);
    assert.equal(state.tasks[1].date, null); assert.equal(state.tasks[1].sourceTaskId, "r");
  } },
  { name: "lesson layer follows week parity and includes teacher overrides without creating tasks", fn() {
    const state = { studySubjects: [{ id: "math", name: "Math", color: "#55aa99", teacher: "Default" }],
      studyWeekCycle: { anchorMonday: "2026-09-28", anchorParity: "even" },
      studyLessons: [{ id: "lesson", subjectId: "math", weekday: 1, weekType: "even", lessonType: "practice", teacher: "Override", startTime: "08:00", endTime: "09:30" }] };
    assert.equal(eventsForDate(state, "2026-09-28")[0].teacher, "Override");
    assert.equal(eventsForDate(state, "2026-10-05").length, 0); assert.equal(state.tasks, undefined);
  } },
  { name: "bulk rescheduling does not collapse several missed repeat occurrences into one", fn() {
    const task = { id: "r", title: "Read", date: "2026-09-01", repeat: "daily", completed: {} };
    const state = { tasks: [task], taskOrder: {} }; let counter = 0;
    const result = moveTasksToDate({ state, targetDateKey: "2026-10-03", entries: ["2026-09-29", "2026-09-30"].map((dateKey) => ({ taskId: "r", dateKey })),
      helpers: { createId: () => `copy-${counter++}`, taskScheduledOn: () => true } });
    assert.equal(result.moved, 2); assert.equal(state.tasks.length, 3);
    assert.equal(task.excludedDates["2026-10-03"], undefined);
    assert.deepEqual(state.tasks.slice(1).map((item) => item.movedFromDate), ["2026-09-29", "2026-09-30"]);
  } },
  { name: "search finds text and frames on boards and subjects by teacher", fn() {
    const state = { boardItems: [{ id: "text", type: "text", text: "Airport notes" }, { id: "frame", type: "frame", text: "Airport project" }],
      studySubjects: [{ id: "math", name: "Math", teacher: "Ada" }] };
    assert.deepEqual(searchWorkspace(state, "airport").map((item) => item.id), ["text", "frame"]);
    assert.equal(searchWorkspace(state, "ada")[0].type, "subject");
  } },
  { name: "JSON cancellation and account switches do not replace or back up data", async fn() {
    for (const scenario of ["cancel", "switch"]) {
      let owner = "a"; let changed = false;
      const controller = createImportExport({ els: { importFile: { value: "selected", files: [{ text: async () => '{"tasks":[]}' }] } },
        getUserId: () => owner, normalizeState: (state) => state,
        confirmAction: async () => { if (scenario === "switch") owner = "b"; return scenario !== "cancel"; },
        createUndoSnapshot: () => { changed = true; return { state: "{}" }; }, replaceState: () => { changed = true; }, showToast() {} });
      await controller.importData(); assert.equal(changed, false);
    }
  } },
  { name: "deadline reminders remain scheduled after the workday has passed", fn() {
    const task = { id: "hw", date: "2026-09-29", dueDate: "2026-10-02", dueTime: "08:00", dueReminderOffset: "60", completed: {} };
    const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const api = createNotifications({ getState: () => ({ tasks: [task], habits: [] }), getNow: () => new Date("2026-10-01T12:00:00"),
      toDateKey: key, parseDate: (value) => new Date(`${value}T00:00:00`), cleanTimeValue: (value) => value || "",
      taskOccursOn: (item, day) => item.date === day, isTaskDone: (item, day) => item.completed[day] === true });
    const reminders = api.collectReminders(7);
    assert.equal(reminders.length, 1); assert.equal(reminders[0].dateKey, task.date);
    assert.equal(key(reminders[0].at), task.dueDate); assert.equal(reminders[0].at.getHours(), 7);
    task.completed[task.date] = true; assert.equal(api.collectReminders(7).length, 0);
    task.date = null; task.completed = {};
    assert.equal(api.collectReminders(7)[0].dateKey, task.dueDate);
  } },
];
