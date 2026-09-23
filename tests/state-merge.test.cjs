const assert = require("node:assert/strict");
const { mergeStates } = require("../app/src/core/state-merge.js");

module.exports = [
  {
    name: "keeps the newest Google Calendar task link across devices",
    fn() {
      const merged = mergeStates(
        {
          tasks: [], habits: [], goals: [], categories: [], taskOrder: {},
          googleCalendarLinks: { task: { eventId: "old", syncedAt: "2026-08-02T10:00:00.000Z" } },
        },
        {
          tasks: [], habits: [], goals: [], categories: [], taskOrder: {},
          googleCalendarLinks: { task: { eventId: "new", syncedAt: "2026-08-02T11:00:00.000Z" } },
        },
      );
      assert.equal(merged.googleCalendarLinks.task.eventId, "new");
    },
  },
  {
    name: "keeps the newest journal text edited on another device",
    fn() {
      const local = {
        tasks: [], habits: [], goals: [], categories: [], taskOrder: {},
        journalEntries: [{ id: "journal", date: "2026-07-25", text: "Локальный текст", updatedAt: "2026-07-25T10:00:00.000Z" }],
        syncMeta: { entityFields: { journalEntries: { journal: { text: "2026-07-25T10:00:00.000Z" } } } },
      };
      const remote = {
        tasks: [], habits: [], goals: [], categories: [], taskOrder: {},
        journalEntries: [{ id: "journal", date: "2026-07-25", text: "Удалённый текст", updatedAt: "2026-07-25T11:00:00.000Z" }],
        syncMeta: { entityFields: { journalEntries: { journal: { text: "2026-07-25T11:00:00.000Z" } } } },
      };

      assert.equal(mergeStates(local, remote).journalEntries[0].text, "Удалённый текст");
    },
  },
  {
    name: "keeps the newest synchronized user time zone",
    fn() {
      const merged = mergeStates(
        {
          profile: { timeZone: "Europe/Moscow", updatedAt: "2026-07-25T10:00:00.000Z" },
          tasks: [], habits: [], goals: [], categories: [], taskOrder: {},
        },
        {
          profile: { timeZone: "Asia/Yekaterinburg", updatedAt: "2026-07-25T11:00:00.000Z" },
          tasks: [], habits: [], goals: [], categories: [], taskOrder: {},
        },
      );
      assert.equal(merged.profile.timeZone, "Asia/Yekaterinburg");
    },
  },
  {
    name: "keeps an explicit task completion and habit value reset from being resurrected",
    fn() {
      const resetAt = "2026-07-13T12:00:00.000Z";
      const staleAt = "2026-07-12T12:00:00.000Z";
      const merged = mergeStates(
        {
          tasks: [{ id: "task", completed: {}, updatedAt: resetAt }],
          habits: [{ id: "habit", logs: {}, updatedAt: resetAt }],
          goals: [], categories: [], taskOrder: {},
          syncMeta: {
            taskFields: { task: { completed: { "2026-07-12": resetAt } } },
            habitLogs: { habit: { "2026-07-12": resetAt } },
          },
        },
        {
          tasks: [{ id: "task", completed: { "2026-07-12": true }, updatedAt: staleAt }],
          habits: [{ id: "habit", logs: { "2026-07-12": 5 }, updatedAt: staleAt }],
          goals: [], categories: [], taskOrder: {},
        },
      );

      assert.deepEqual(merged.tasks[0].completed, {});
      assert.deepEqual(merged.habits[0].logs, {});
    },
  },
  {
    name: "uses the newest explicit task and habit order",
    fn() {
      const merged = mergeStates(
        {
          tasks: [{ id: "a" }, { id: "b" }], habits: [{ id: "h1" }, { id: "h2" }], goals: [], categories: [],
          taskOrder: { "2026-07-13": ["a", "b"] },
          syncMeta: { taskOrder: { "2026-07-13": "2026-07-13T10:00:00.000Z" }, habitOrderUpdatedAt: "2026-07-13T10:00:00.000Z" },
        },
        {
          tasks: [{ id: "a" }, { id: "b" }], habits: [{ id: "h2" }, { id: "h1" }], goals: [], categories: [],
          taskOrder: { "2026-07-13": ["b", "a"] },
          syncMeta: { taskOrder: { "2026-07-13": "2026-07-13T11:00:00.000Z" }, habitOrderUpdatedAt: "2026-07-13T11:00:00.000Z" },
        },
      );

      assert.deepEqual(merged.taskOrder["2026-07-13"], ["b", "a"]);
      assert.deepEqual(merged.habits.map((habit) => habit.id), ["h2", "h1"]);
    },
  },
  {
    name: "merges independently edited goal checkpoints",
    fn() {
      const merged = mergeStates(
        {
          tasks: [], habits: [], categories: [], taskOrder: {},
          goals: [{ id: "goal", updatedAt: "2026-07-13T10:00:00.000Z", steps: [{ id: "a", title: "A", done: true }, { id: "b", title: "B", done: false }] }],
          syncMeta: { goalSteps: { goal: { a: "2026-07-13T10:00:00.000Z" } } },
        },
        {
          tasks: [], habits: [], categories: [], taskOrder: {},
          goals: [{ id: "goal", updatedAt: "2026-07-13T11:00:00.000Z", steps: [{ id: "a", title: "A", done: false }, { id: "b", title: "B renamed", done: false }] }],
          syncMeta: { goalSteps: { goal: { b: "2026-07-13T11:00:00.000Z" } } },
        },
      );

      assert.equal(merged.goals[0].steps.find((step) => step.id === "a").done, true);
      assert.equal(merged.goals[0].steps.find((step) => step.id === "b").title, "B renamed");
    },
  },
  {
    name: "merges records and dated logs from two devices",
    fn() {
      const merged = mergeStates(
        {
          tasks: [{ id: "shared", title: "Local", completed: { "2026-07-11": true } }, { id: "local" }],
          habits: [{ id: "habit", logs: { "2026-07-11": 2 } }], goals: [], categories: [], taskOrder: {},
        },
        {
          tasks: [{ id: "shared", title: "Remote", completed: { "2026-07-12": true } }, { id: "remote" }],
          habits: [{ id: "habit", logs: { "2026-07-12": 3 } }], goals: [], categories: [], taskOrder: {},
        },
      );
      assert.deepEqual(merged.tasks.map((task) => task.id), ["shared", "local", "remote"]);
      assert.deepEqual(merged.tasks[0].completed, { "2026-07-11": true, "2026-07-12": true });
      assert.deepEqual(merged.habits[0].logs, { "2026-07-11": 2, "2026-07-12": 3 });
    },
  },
  {
    name: "keeps the newest entity fields while merging dated activity",
    fn() {
      const merged = mergeStates(
        {
          tasks: [{ id: "task", title: "New local title", updatedAt: "2026-07-12T12:00:00.000Z", completed: {} }],
          habits: [], goals: [], categories: [], taskOrder: {},
        },
        {
          tasks: [{ id: "task", title: "Old remote title", updatedAt: "2026-07-11T12:00:00.000Z", completed: { "2026-07-11": true } }],
          habits: [], goals: [], categories: [], taskOrder: {},
        },
      );
      assert.equal(merged.tasks[0].title, "New local title");
      assert.equal(merged.tasks[0].completed["2026-07-11"], true);
    },
  },
  {
    name: "merges independent task fields edited on different devices",
    fn() {
      const localEdit = "2026-07-13T10:00:00.000Z";
      const remoteEdit = "2026-07-13T11:00:00.000Z";
      const merged = mergeStates(
        {
          tasks: [{ id: "task", title: "Local title", priority: "low", updatedAt: localEdit }],
          habits: [], goals: [], categories: [], taskOrder: {},
          syncMeta: { entityFields: { tasks: { task: { title: localEdit } } } },
        },
        {
          tasks: [{ id: "task", title: "Original title", priority: "high", updatedAt: remoteEdit }],
          habits: [], goals: [], categories: [], taskOrder: {},
          syncMeta: { entityFields: { tasks: { task: { priority: remoteEdit } } } },
        },
      );

      assert.equal(merged.tasks[0].title, "Local title");
      assert.equal(merged.tasks[0].priority, "high");
      assert.equal(merged.syncMeta.entityFields.tasks.task.title, localEdit);
      assert.equal(merged.syncMeta.entityFields.tasks.task.priority, remoteEdit);
    },
  },
  {
    name: "does not resurrect an entity deleted on another device",
    fn() {
      const merged = mergeStates(
        {
          tasks: [], habits: [], goals: [], categories: [], taskOrder: {},
          tombstones: { tasks: { removed: "2026-07-12T12:00:00.000Z" } },
        },
        {
          tasks: [{ id: "removed", title: "Stale task", updatedAt: "2026-07-11T12:00:00.000Z" }],
          habits: [], goals: [], categories: [], taskOrder: {},
        },
      );
      assert.equal(merged.tasks.length, 0);
      assert.equal(merged.tombstones.tasks.removed, "2026-07-12T12:00:00.000Z");
    },
  },
  {
    name: "keeps a deletion across two devices even when the stale device clock is ahead",
    fn() {
      const deletedOnLaptop = {
        tasks: [], habits: [], goals: [], categories: [], taskOrder: { "2026-07-13": [] },
        tombstones: { tasks: { shared: "2026-07-13T10:00:00.000Z" } },
      };
      const staleOnDesktop = {
        tasks: [{ id: "shared", title: "Stale task", updatedAt: "2030-01-01T00:00:00.000Z" }],
        habits: [], goals: [], categories: [], taskOrder: { "2026-07-13": ["shared"] },
      };

      const desktopAfterPull = mergeStates(staleOnDesktop, deletedOnLaptop);
      const laptopAfterDesktopPush = mergeStates(deletedOnLaptop, desktopAfterPull);

      assert.equal(desktopAfterPull.tasks.length, 0);
      assert.deepEqual(desktopAfterPull.taskOrder["2026-07-13"], []);
      assert.equal(laptopAfterDesktopPush.tasks.length, 0);
      assert.equal(laptopAfterDesktopPush.tombstones.tasks.shared, "2026-07-13T10:00:00.000Z");
    },
  },
  {
    name: "keeps MCP activity and its newest undo status across devices",
    fn() {
      const base = {
        id: "mcp-action-1",
        title: "Создание задачи",
        summary: "Задача создана",
        createdAt: "2026-07-19T10:00:00.000Z",
        status: "applied",
        inverse: {},
      };
      const merged = mergeStates(
        { tasks: [], habits: [], goals: [], categories: [], taskOrder: {}, mcpActivity: [base] },
        {
          tasks: [], habits: [], goals: [], categories: [], taskOrder: {},
          mcpActivity: [{
            ...base,
            status: "undone",
            updatedAt: "2026-07-19T11:00:00.000Z",
            undoneAt: "2026-07-19T11:00:00.000Z",
          }],
        },
      );

      assert.equal(merged.mcpActivity.length, 1);
      assert.equal(merged.mcpActivity[0].status, "undone");
    },
  },
  {
    name: "merges board edits and keeps a deleted board item deleted",
    fn() {
      const merged = mergeStates(
        {
          tasks: [], habits: [], goals: [], categories: [], taskOrder: {},
          boardItems: [
            {
              id: "note",
              type: "text",
              text: "Локальный текст",
              x: 10,
              y: 20,
              width: 280,
              height: 180,
              z: 1,
              updatedAt: "2026-07-26T10:00:00.000Z",
            },
          ],
          tombstones: { boardItems: { removed: "2026-07-26T12:00:00.000Z" } },
          syncMeta: {
            entityFields: {
              boardItems: {
                note: { text: "2026-07-26T11:00:00.000Z" },
              },
            },
          },
        },
        {
          tasks: [], habits: [], goals: [], categories: [], taskOrder: {},
          boardItems: [
            {
              id: "note",
              type: "text",
              text: "Удалённый текст",
              x: 120,
              y: 20,
              width: 280,
              height: 180,
              z: 1,
              updatedAt: "2026-07-26T11:00:00.000Z",
            },
            {
              id: "removed",
              type: "text",
              text: "Устаревший элемент",
              updatedAt: "2026-07-25T10:00:00.000Z",
            },
          ],
          syncMeta: {
            entityFields: {
              boardItems: {
                note: {
                  text: "2026-07-26T10:00:00.000Z",
                  x: "2026-07-26T11:30:00.000Z",
                },
              },
            },
          },
        },
      );

      assert.equal(merged.boardItems.length, 1);
      assert.equal(merged.boardItems[0].text, "Локальный текст");
      assert.equal(merged.boardItems[0].x, 120);
      assert.equal(merged.tombstones.boardItems.removed, "2026-07-26T12:00:00.000Z");
    },
  },
  {
    name: "merges nutrition edits and keeps remote meal deletion",
    fn() {
      const merged = mergeStates(
        {
          tasks: [], habits: [], goals: [], categories: [], taskOrder: {},
          nutritionFoods: [{ id: "rice", name: "Рис", calories: 350, updatedAt: "2026-07-26T10:00:00.000Z" }],
          nutritionMeals: [{ id: "meal", title: "Старый обед", date: "2026-07-27", updatedAt: "2026-07-26T10:00:00.000Z" }],
          nutritionSettings: { paused: false, updatedAt: "2026-07-26T10:00:00.000Z" },
        },
        {
          tasks: [], habits: [], goals: [], categories: [], taskOrder: {},
          nutritionFoods: [{ id: "rice", name: "Бурый рис", calories: 350, updatedAt: "2026-07-26T11:00:00.000Z" }],
          nutritionMeals: [],
          nutritionSettings: { paused: true, updatedAt: "2026-07-26T11:00:00.000Z" },
          tombstones: { nutritionMeals: { meal: "2026-07-26T11:00:00.000Z" } },
        },
      );

      assert.equal(merged.nutritionFoods[0].name, "Бурый рис");
      assert.equal(merged.nutritionMeals.length, 0);
      assert.equal(merged.nutritionSettings.paused, true);
    },
  },
];
