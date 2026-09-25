const assert = require("node:assert/strict");
const { createStateNormalizer } = require("./test-utils.cjs");

module.exports = [
  {
    name: "preserves valid Google Calendar task links and drops malformed entries",
    fn() {
      const normalizer = createStateNormalizer();
      const normalized = normalizer.normalizeState({
        googleCalendarLinks: {
          task: {
            eventId: "event-1",
            localUpdatedAt: "2026-08-02T10:00:00.000Z",
            occurrenceDate: "2026-08-03",
            remoteUpdatedAt: "bad-date",
            sourceTaskId: "series",
            syncedAt: "2026-08-02T11:00:00.000Z",
          },
          broken: { eventId: "" },
        },
      });
      assert.deepEqual(normalized.googleCalendarLinks, {
        task: {
          eventId: "event-1",
          localUpdatedAt: "2026-08-02T10:00:00.000Z",
          occurrenceDate: "2026-08-03",
          remoteUpdatedAt: "",
          sourceTaskId: "series",
          syncedAt: "2026-08-02T11:00:00.000Z",
        },
      });
    },
  },
  {
    name: "cleans imported tasks and habits",
    fn() {
      const normalizer = createStateNormalizer();
      const normalized = normalizer.normalizeState({
        categories: [{ id: "cat-1", name: "Дом", color: "not-a-color" }],
        tasks: [
          {
            id: "task-1",
            title: "",
            date: "bad-date",
            time: "25:99",
            category: "Работа",
            priority: "urgent-ish",
            repeat: "custom",
            customRepeat: { type: "interval", every: 4 },
            reminderOffset: "999",
            completed: { "2026-06-26": true, nope: true },
            acknowledgedOverdue: { "2026-06-25": true, nope: true },
          },
        ],
        habits: [
          {
            id: "habit-1",
            title: "",
            type: "number",
            repeat: "custom",
            customRepeat: { type: "monthDay", day: 31 },
            goal: 0,
            logs: { "2026-06-26": "3" },
          },
        ],
        goals: [
          {
            id: "goal-1",
            title: "",
            description: "  Сделать  MVP  ",
            measure: "  3 шага  ",
            reality: "  есть  время  ",
            why: "  важно  для роста  ",
            dueDate: "bad-date",
            taskIds: ["task-1", "missing-task"],
            steps: [
              { id: "step-1", title: "  Дизайн  ", done: true },
              { title: "  ", done: true },
              "Деплой",
            ],
            status: "done",
          },
        ],
        journalEntries: [
          {
            id: "journal-1",
            date: "2026-06-26",
            text: "Первый абзац\r\n\r\nВторой абзац",
            updatedAt: "2026-06-26T20:00:00.000Z",
          },
        ],
        boardItems: [
          {
            id: "board-text",
            type: "text",
            x: "120",
            y: 80,
            width: 300,
            height: 160,
            text: "  Важная мысль  ",
            fontSize: 72,
            fontWeight: 700,
            color: "#397EE8",
            z: 2,
          },
          {
            id: "board-image",
            type: "image",
            x: 10,
            y: 20,
            assetId: "asset-1",
            remotePath: "user/asset-1.webp",
            mime: "image/webp",
            name: "idea.webp",
          },
          {
            id: "board-frame",
            type: "frame",
            text: "План",
            groupId: "group-1",
            locked: true,
          },
          { id: "broken-image", type: "image", assetId: "" },
        ],
        taskOrder: { "2026-06-26": [123] },
        tombstones: {
          tasks: { "task-deleted": "2026-06-27T10:00:00.000Z", invalid: "yesterday" },
        },
      });

      assert.equal(normalized.schemaVersion, 16);
      assert.equal(normalized.categories[0].color, "#00a78e");
      assert.equal(normalized.categories[1].name, "Работа");
      assert.equal(normalized.tasks[0].title, "Задача");
      assert.equal(normalized.tasks[0].date, "2026-06-26");
      assert.equal(normalized.tasks[0].time, "");
      assert.equal(normalized.tasks[0].priority, "medium");
      assert.equal(normalized.tasks[0].customRepeat.every, 4);
      assert.equal(normalized.tasks[0].reminderOffset, "none");
      assert.deepEqual(normalized.tasks[0].completed, { "2026-06-26": true });
      assert.deepEqual(normalized.tasks[0].acknowledgedOverdue, { "2026-06-25": true });
      assert.equal(normalized.habits[0].title, "Привычка");
      assert.equal(normalized.habits[0].titleHistory[0].title, "Привычка");
      assert.equal(normalized.habits[0].configHistory[0].type, "number");
      assert.equal(normalized.habits[0].goal, 1);
      assert.deepEqual(normalized.habits[0].logs, { "2026-06-26": 3 });
      assert.equal(normalized.goals[0].title, "Цель");
      assert.equal(normalized.goals[0].description, "Сделать MVP");
      assert.equal(normalized.goals[0].measure, "3 шага");
      assert.equal(normalized.goals[0].reality, "есть время");
      assert.equal(normalized.goals[0].why, "важно для роста");
      assert.equal(normalized.goals[0].dueDate, "2026-06-26");
      assert.equal(normalized.goals[0].taskIds, undefined);
      assert.equal(normalized.journalEntries[0].text, "Первый абзац\n\nВторой абзац");
      assert.equal(normalized.boardItems.length, 3);
      assert.equal(normalized.boardItems.find((item) => item.id === "board-text").text, "  Важная мысль  ");
      assert.equal(normalized.boardItems.find((item) => item.id === "board-text").fontSize, 72);
      assert.equal(normalized.boardItems.find((item) => item.id === "board-text").fontWeight, 700);
      assert.equal(normalized.boardItems.find((item) => item.id === "board-text").color, "#397ee8");
      assert.equal(normalized.boardItems.find((item) => item.id === "board-image").remotePath, "user/asset-1.webp");
      assert.equal(normalized.boardItems.find((item) => item.id === "board-frame").groupId, "group-1");
      assert.equal(normalized.boardItems.find((item) => item.id === "board-frame").locked, true);
      assert.deepEqual(
        normalized.goals[0].steps.map((step) => ({ done: step.done, title: step.title })),
        [
          { done: true, title: "Дизайн" },
          { done: true, title: "Деплой" },
        ],
      );
      assert.equal(normalized.goals[0].status, "done");
      assert.ok(normalized.goals[0].completedAt);
      assert.deepEqual(normalized.taskOrder, {});
      assert.deepEqual(normalized.tombstones.tasks, { "task-deleted": "2026-06-27T10:00:00.000Z" });
      assert.ok(normalized.tasks[0].updatedAt);
    },
  },
  {
    name: "remembers that default categories were already seeded after all categories are deleted",
    fn() {
      const normalizer = createStateNormalizer();
      const normalized = normalizer.normalizeState({
        categories: [],
        tombstones: { categories: { removed: "2026-07-13T08:00:00.000Z" } },
      });

      assert.equal(normalized.defaultsSeeded, true);
    },
  },
  {
    name: "deduplicates categories and remaps tasks to the canonical category",
    fn() {
      const normalizer = createStateNormalizer();
      const normalized = normalizer.normalizeState({
        categories: [
          { id: "category-b", name: "  Работа  ", color: "#ff0000" },
          { id: "category-a", name: "работа", color: "#00ff00" },
          { id: "category-home", name: "Дом", color: "#0000ff" },
        ],
        tasks: [
          { id: "task-b", title: "Из старой категории", categoryId: "category-b" },
          { id: "task-a", title: "Из основной категории", categoryId: "category-a" },
        ],
      });

      assert.deepEqual(normalized.categories.map((category) => category.id), ["category-a", "category-home"]);
      assert.deepEqual(normalized.tasks.map((task) => task.categoryId), ["category-a", "category-a"]);
      assert.ok(normalized.tombstones.categories["category-b"]);
    },
  },
  {
    name: "normalizes scheduled task blocks",
    fn() {
      const normalizer = createStateNormalizer();
      const normalized = normalizer.normalizeState({
        tasks: [
          {
            id: "task-block",
            title: "Созвон",
            date: "2026-06-30",
            time: "",
            startTime: "14:00",
            endTime: "15:30",
            priority: "high",
            repeat: "none",
          },
        ],
      });

      assert.equal(normalized.tasks[0].scheduleMode, "block");
      assert.equal(normalized.tasks[0].startTime, "14:00");
      assert.equal(normalized.tasks[0].endTime, "15:30");
      assert.equal(normalized.tasks[0].time, "15:30");
      assert.equal(normalized.tasks[0].reminderOffset, "15");
    },
  },
  {
    name: "preserves no-time, deadline, and block schedule modes",
    fn() {
      const normalizer = createStateNormalizer();
      const normalized = normalizer.normalizeState({
        tasks: [
          { id: "no-time", title: "Без времени", date: "2026-07-13", time: "" },
          { id: "deadline", title: "Дедлайн", date: "2026-07-13", time: "18:30" },
          { id: "block", title: "Блок", date: "2026-07-13", startTime: "14:00", endTime: "15:00" },
        ],
      });

      assert.deepEqual(
        normalized.tasks.map((task) => task.scheduleMode),
        ["none", "deadline", "block"],
      );
    },
  },
  {
    name: "migrates legacy linked goal tasks into independent checkpoints",
    fn() {
      const normalizer = createStateNormalizer();
      const normalized = normalizer.normalizeState({
        tasks: [{ id: "legacy-task", title: "Собрать прототип", date: "2026-07-12", completed: { "2026-07-12": true } }],
        goals: [{ id: "goal", title: "Запустить продукт", dueDate: "2026-08-01", taskIds: ["legacy-task"], steps: [] }],
      });

      assert.equal(normalized.goals[0].taskIds, undefined);
      assert.equal(normalized.goals[0].steps[0].title, "Собрать прототип");
      assert.equal(normalized.goals[0].steps[0].done, true);
    },
  },
  {
    name: "normalizes nutrition records and drops malformed meals",
    fn() {
      const normalizer = createStateNormalizer();
      const normalized = normalizer.normalizeState({
        nutritionFoods: [
          { id: "rice", name: " Рис ", unit: "г", calories: 350 },
          { id: "rice", name: "Дубликат", unit: "г", calories: 100 },
        ],
        nutritionMeals: [
          {
            id: "lunch",
            date: "2026-07-27",
            title: " Обед ",
            type: "lunch",
            ingredients: [{ foodId: "rice", name: "Рис", quantity: 100, unit: "г" }],
          },
          { id: "broken", date: "", title: "" },
        ],
        nutritionSettings: { targets: { calories: 2200 }, paused: true },
      });

      assert.equal(normalized.nutritionFoods.length, 1);
      assert.equal(normalized.nutritionMeals.length, 1);
      assert.equal(normalized.nutritionMeals[0].title, "Обед");
      assert.equal(normalized.nutritionSettings.targets.calories, 2200);
      assert.equal(normalized.nutritionSettings.paused, true);
    },
  },
];
