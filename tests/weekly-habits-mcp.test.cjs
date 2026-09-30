const assert = require("node:assert/strict");
module.exports = [
  { name: "MCP shows flexible weekly progress without inventing daily obligations", async fn() {
    const service = await import("../mcp/task-service.mjs");
    const state = service.createEmptyState();
    state.habits = [{ id: "h", title: "Gym", startDate: "2026-09-14", repeat: "weeklyGoal", weeklyTarget: 3,
      reminderTime: "08:30", type: "check", logs: { "2026-09-14": true, "2026-09-16": true, "2026-09-18": true } }];
    const result = service.getTodayOverview(state, "2026-09-20");
    assert.equal(result.habits.length, 1);
    assert.equal(result.habits[0].status, "not-due");
    assert.equal(result.habits[0].weeklyProgress.completed, 3);
    assert.equal(result.habits[0].weeklyProgress.achieved, true);
    assert.equal(result.habits[0].reminderTime, "08:30");
    assert.equal(result.summary.habitsTotal, 0);
    assert.equal(result.summary.habitsFlexible, 1);
  } },
  { name: "MCP reads the selected checklist occurrence and preserves it when completing a task", async fn() {
    const service = await import("../mcp/task-service.mjs");
    const state = service.createEmptyState();
    state.tasks = [{ id: "t", title: "Prepare", date: "2026-09-14", repeat: "daily", checklist: [{ id: "a", title: "First" }],
      checklistLogs: { "2026-09-14": { a: { done: true, updatedAt: "2026-09-14T10:00:00Z" } } } }];
    assert.equal(service.getTodayOverview(state, "2026-09-14").tasks[0].checklist[0].done, true);
    assert.equal(service.getTodayOverview(state, "2026-09-15").tasks[0].checklistProgress.done, 0);
    const result = service.completeTaskCommand(state, { requestId: "complete-checklist-001", taskId: "t", date: "2026-09-14", completed: true });
    assert.equal(result.state.tasks[0].checklistLogs["2026-09-14"].a.done, true);
  } },
];
