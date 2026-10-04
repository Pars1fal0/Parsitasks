const assert = require("node:assert/strict");
const { buildTimelineModel } = require("../app/src/timeline/timeline-view.js");
const { TIMELINE_LAST_MINUTE, nextBlockTimes } = require("../app/src/timeline/timeline-layout.js");

module.exports = [
  {
    name: "keeps all 24 hours available even on an empty day",
    fn() {
      const model = buildTimelineModel({
        activeDate: "2026-06-30",
        formatTime: (value) => value,
        getCategory: () => null,
        isTaskDone: () => false,
        priorityLabels: {},
        tasks: [],
      });
      assert.equal(model.hourRows.length, 24);
      assert.equal(model.hourRows[0].hour, 0);
      assert.equal(model.hourRows.at(-1).hour, 23);
    },
  },
  {
    name: "keeps quarter-hour start slots but lets resized blocks reach 23:59",
    fn() {
      assert.equal(TIMELINE_LAST_MINUTE, 23 * 60 + 45);
      assert.deepEqual(nextBlockTimes(23 * 60, 23 * 60 + 30, "end", 60), {
        start: 23 * 60,
        end: 23 * 60 + 59,
      });
      assert.deepEqual(nextBlockTimes(23 * 60 + 45, 23 * 60 + 59, "end", 15), { start: 1425, end: 1439 });
      assert.deepEqual(nextBlockTimes(1425, 1439, "start", 15), { start: 1425, end: 1439 });
      assert.deepEqual(nextBlockTimes(600, 607, "end", 0), { start: 600, end: 607 });
    },
  },
  {
    name: "deadline overdue status uses actual time, not the marker visual height",
    fn() {
      const model = buildTimelineModel({
        activeDate: "2026-10-04", todayKey: "2026-10-04", now: new Date(2026, 9, 4, 9, 15),
        formatTime: (value) => value, getCategory: () => null, isTaskDone: () => false, priorityLabels: {},
        tasks: [
          { id: "deadline", title: "Deadline", time: "09:00" },
          { id: "block", title: "Block", time: "09:30", scheduleMode: "block", startTime: "09:00", endTime: "09:30" },
          { id: "current", title: "Current", time: "09:15" },
        ],
      });
      const byId = new Map(model.timedTasks.map((entry) => [entry.task.id, entry]));
      assert.equal(byId.get("deadline").isOverdue, true);
      assert.equal(byId.get("block").isOverdue, false);
      assert.equal(byId.get("current").isOverdue, false);
      assert.equal(byId.get("deadline").visualDuration, 30);
    },
  },
  {
    name: "groups timed tasks by hour and keeps unscheduled tasks separate",
    fn() {
      const tasks = [
        { id: "late", title: "Late", time: "18:30", priority: "low", categoryId: "cat" },
        { id: "none", title: "No time", time: "", priority: "high", categoryId: "" },
        { id: "early", title: "Early", time: "08:15", priority: "medium", categoryId: "" },
      ];
      const model = buildTimelineModel({
        activeDate: "2026-06-30",
        formatTime: (value) => value,
        getCategory: (id) => (id ? { name: "Work", color: "#00a78e" } : null),
        isTaskDone: (task) => task.id === "early",
        priorityLabels: { high: "High", medium: "Medium", low: "Low" },
        tasks,
      });

      assert.deepEqual(model.timedTasks.map((entry) => entry.task.id), ["early", "late"]);
      assert.deepEqual(model.unscheduledTasks.map((entry) => entry.task.id), ["none"]);
      assert.equal(model.hourRows.find((row) => row.hour === 8).tasks[0].done, true);
      assert.equal(model.hourRows.find((row) => row.hour === 18).tasks[0].metaLabel, "Work");
    },
  },
  {
    name: "marks overdue timed tasks and exposes current time line",
    fn() {
      const tasks = [
        { id: "past", title: "Past", time: "09:00", priority: "high", categoryId: "" },
        { id: "future", title: "Future", time: "11:00", priority: "medium", categoryId: "" },
        { id: "done", title: "Done", time: "08:30", priority: "low", categoryId: "" },
      ];
      const model = buildTimelineModel({
        activeDate: "2026-06-30",
        formatTime: (value) => value,
        getCategory: () => null,
        isTaskDone: (task) => task.id === "done",
        now: new Date(2026, 5, 30, 10, 30),
        priorityLabels: { high: "High", medium: "Medium", low: "Low" },
        tasks,
        todayKey: "2026-06-30",
      });

      assert.equal(model.timedTasks.find((entry) => entry.task.id === "past").isOverdue, true);
      assert.equal(model.timedTasks.find((entry) => entry.task.id === "future").isOverdue, false);
      assert.equal(model.timedTasks.find((entry) => entry.task.id === "done").isOverdue, false);
      assert.deepEqual(model.nowLine, { hour: 10, offsetPercent: 50 });
    },
  },
  {
    name: "uses start and end times for scheduled blocks",
    fn() {
      const tasks = [
        { id: "block", title: "Block", scheduleMode: "block", startTime: "14:00", endTime: "15:30", time: "15:30", priority: "medium", categoryId: "" },
      ];
      const model = buildTimelineModel({
        activeDate: "2026-06-30",
        formatTime: (value) => value,
        getCategory: () => null,
        isTaskDone: () => false,
        now: new Date(2026, 5, 30, 10, 30),
        priorityLabels: { medium: "Medium" },
        tasks,
        todayKey: "2026-06-30",
      });

      const entry = model.timedTasks[0];
      assert.equal(entry.isTimeBlock, true);
      assert.equal(entry.minutes, 14 * 60);
      assert.equal(entry.endMinutes, 15 * 60 + 30);
      assert.equal(entry.timeLabel, "14:00-15:30");
      assert.equal(model.hourRows.some((row) => row.hour === 15), true);
    },
  },
  {
    name: "keeps short block duration and splits overlapping tasks into columns",
    fn() {
      const tasks = [
        { id: "a", title: "A", scheduleMode: "block", startTime: "10:00", endTime: "10:15", time: "10:15", priority: "medium", categoryId: "" },
        { id: "b", title: "B", scheduleMode: "block", startTime: "10:00", endTime: "10:30", time: "10:30", priority: "medium", categoryId: "" },
        { id: "c", title: "C", scheduleMode: "block", startTime: "10:15", endTime: "10:45", time: "10:45", priority: "medium", categoryId: "" },
      ];
      const model = buildTimelineModel({
        activeDate: "2026-06-30",
        formatTime: (value) => value,
        getCategory: () => null,
        isTaskDone: () => false,
        priorityLabels: { medium: "Medium" },
        tasks,
      });

      const byId = new Map(model.timedTasks.map((entry) => [entry.task.id, entry]));
      assert.equal(byId.get("a").visualDuration, 15);
      assert.equal(byId.get("b").visualDuration, 30);
      assert.equal(byId.get("c").visualDuration, 30);
      assert.equal(byId.get("a").columnCount, 2);
      assert.equal(byId.get("b").columnCount, 2);
      assert.equal(byId.get("c").columnCount, 2);
      assert.notEqual(byId.get("a").columnIndex, byId.get("b").columnIndex);
      assert.equal(byId.get("c").columnIndex, byId.get("a").columnIndex);
    },
  },
  {
    name: "uses three columns when three tasks overlap at once",
    fn() {
      const tasks = [
        { id: "a", title: "A", scheduleMode: "block", startTime: "10:00", endTime: "11:00", time: "11:00", priority: "medium", categoryId: "" },
        { id: "b", title: "B", scheduleMode: "block", startTime: "10:15", endTime: "10:45", time: "10:45", priority: "medium", categoryId: "" },
        { id: "c", title: "C", scheduleMode: "block", startTime: "10:30", endTime: "11:15", time: "11:15", priority: "medium", categoryId: "" },
      ];
      const model = buildTimelineModel({
        activeDate: "2026-06-30",
        formatTime: (value) => value,
        getCategory: () => null,
        isTaskDone: () => false,
        priorityLabels: { medium: "Medium" },
        tasks,
      });

      assert.deepEqual(model.timedTasks.map((entry) => entry.columnCount), [3, 3, 3]);
      assert.deepEqual(new Set(model.timedTasks.map((entry) => entry.columnIndex)).size, 3);
    },
  },
];
