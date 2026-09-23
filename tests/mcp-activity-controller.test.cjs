const assert = require("node:assert/strict");
const { installDom } = require("./dom-test-utils.cjs");
const activityApi = require("../src/integrations/mcp-activity.js");
const { createMcpActivityController } = require("../src/integrations/mcp-activity-controller.js");

module.exports = [
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
