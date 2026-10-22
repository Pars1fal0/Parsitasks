const assert = require("node:assert/strict");
const { installDom } = require("./dom-test-utils.cjs");
const activityApi = require("../app/src/integrations/mcp-activity.js");
const { createMcpActivityController } = require("../app/src/integrations/mcp-activity-controller.js");

module.exports = [
  { name: "MCP undo reports storage and conflict failures without changing the workspace", async fn() {
    let state = { tasks: [{ id: "task", title: "Keep me" }], mcpActivity: [{ id: "action", createdAt: "2026-10-21T10:00:00Z",
      inverse: { entities: { tasks: { removeIds: ["task"], restore: [] } } } }] };
    const original = structuredClone(state), messages = [];
    const controller = createMcpActivityController({ activityApi, getState: () => state, confirmAction: async () => true,
      replaceState: (value) => { state = value; }, saveState: () => false, render() {}, showToast: (text) => messages.push(text) });
    await controller.undo("action");
    assert.deepEqual(state, original);
    assert.ok(messages.at(-1).includes("Не удалось сохранить"));
    state.mcpActivity[0].inverse.entities.tasks.expected = [{ id: "task", value: { id: "task", title: "Old title" } }];
    const beforeConflict = structuredClone(state);
    await assert.doesNotReject(controller.undo("action"));
    assert.deepEqual(state, beforeConflict);
    assert.ok(messages.at(-1).includes("данные изменились"));
  } },
  { name: "MCP undo refuses confirmation from a previous account", async fn() {
    let owner = "one", accept, writes = 0;
    const state = { mcpActivity: [{ id: "action" }] };
    const controller = createMcpActivityController({ getState: () => state, getOwner: () => owner,
      confirmAction: () => new Promise((resolve) => { accept = resolve; }), saveState: () => { writes++; } });
    const pending = controller.undo("action"); owner = "two"; accept(true); await pending;
    assert.equal(writes, 0);
  } },
  {
    name: "MCP activity controller renders changes and undoes them without innerHTML",
    async fn() {
      installDom();
      const container = document.createElement("div");
      let state = {
        tasks: [{ id: "created-task", title: "Created by ChatGPT" }],
        habits: [],
        goals: [],
        categories: [],
        taskOrder: { "2026-07-20": ["created-task"] },
        tombstones: { tasks: {}, habits: {}, goals: {}, categories: {} },
        mcpActivity: [{
          id: "mcp-action-create-1",
          requestId: "create-1",
          type: "create_task",
          title: "Создание задачи",
          summary: "Задача создана",
          createdAt: "2026-07-19T10:00:00.000Z",
          status: "applied",
          inverse: {
            entities: { tasks: { restore: [], removeIds: ["created-task"] } },
            taskOrder: { "2026-07-20": null },
            tombstones: { tasks: {}, habits: {}, goals: {}, categories: {} },
          },
        }],
      };
      let saves = 0;
      const controller = createMcpActivityController({
        activityApi,
        confirmAction: async () => true,
        container,
        formatDate: () => "19 июля",
        getState: () => state,
        render() {},
        replaceState: (nextState) => { state = nextState; },
        saveState: () => { saves += 1; },
        showToast() {},
      });

      controller.render();
      const row = container.querySelector(".mcp-activity-row");
      assert.equal(row.querySelector("strong").textContent, "Создание задачи");
      await controller.undo("mcp-action-create-1");
      assert.equal(state.tasks.length, 0);
      assert.equal(state.mcpActivity[0].status, "undone");
      assert.equal(saves, 1);
    },
  },
];
