(function (global) {
  function appendSubtask({ state, task, dateKey, title, scope = "occurrence", createId }) {
    const checklist = global.RhythmTaskChecklist || require("./task-checklist.js");
    const text = String(title || "").trim().replace(/\s+/g, " ");
    if (!state.tasks.includes(task)) throw new Error("Задача больше недоступна");
    if (!text || text.length > 120) throw new Error("Название подзадачи: от 1 до 120 символов");
    if ((task.checklist || []).length >= 50) throw new Error("В задаче может быть не больше 50 подзадач");
    return changeChecklist({ state, task, dateKey, scope, createId,
      items: checklist.normalizeItems([...(task.checklist || []), { id: createId(), title: text }], createId) });
  }

  function removeSubtask({ state, task, dateKey, itemId, scope = "occurrence", createId }) {
    const checklist = global.RhythmTaskChecklist || require("./task-checklist.js");
    if (!state.tasks.includes(task)) throw new Error("Задача больше недоступна");
    if (!task.checklist?.some((item) => item.id === itemId)) throw new Error("Подзадача больше недоступна");
    const saved = changeChecklist({ state, task, dateKey, scope, createId, items: task.checklist.filter((item) => item.id !== itemId) });
    // Recurrence editing keeps the previous series intact; clean only the resulting task.
    saved.checklistLogs = checklist.normalizeLogs(saved.checklistLogs);
    Object.values(saved.checklistLogs).forEach((day) => delete day[itemId]);
    return saved;
  }

  function changeChecklist({ state, task, dateKey, items, scope, createId }) {
    const moves = global.RhythmTaskMoves || require("./task-moves.js");
    const edited = { ...task, checklist: items, updatedAt: new Date().toISOString() };
    if (task.date === null && !task.deferredFromDate) edited.deferredFromDate = dateKey;
    if (task.repeat !== "none" && !task.sourceTaskId) {
      if (!["occurrence", "following"].includes(scope)) throw new Error("Выберите область изменения повтора");
      return moves.updateRecurringTaskDetails({ state, task, editedTask: edited, dateKey, scope, helpers: { createId } });
    }
    Object.assign(task, edited);
    return task;
  }

  function createSubtaskDialog(ctx) {
    const dialog = document.querySelector("#taskSubtaskDialog");
    const form = dialog.querySelector("form");
    const input = form.elements.title;
    const scopePanel = dialog.querySelector("fieldset");
    const message = dialog.querySelector("[role=alert]");
    let openedState = null;
    let taskId = "";
    let dateKey = "";

    function open(task, date) {
      form.reset(); message.textContent = "";
      openedState = ctx.getState(); taskId = task.id;
      dateKey = date || task.deferredFromDate || task.dueDate || ctx.today();
      dialog.querySelector(".task-subtask-parent").textContent = task.title;
      scopePanel.hidden = task.repeat === "none" || Boolean(task.sourceTaskId);
      dialog.querySelector("[data-subtask-occurrence]").textContent = `Только ${ctx.formatLongDate(dateKey)}`;
      dialog.querySelector("[data-subtask-following]").textContent = `Это и будущие выполнения`;
      dialog.showModal(); input.focus();
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const state = ctx.getState();
      const task = state.tasks.find((item) => item.id === taskId);
      if (state !== openedState || !task) {
        message.textContent = "Данные изменились. Закройте окно и откройте задачу заново.";
        return;
      }
      const undo = ctx.createUndoSnapshot();
      let saved;
      try {
        saved = appendSubtask({ state, task, dateKey, title: input.value, scope: form.elements.scope.value, createId: ctx.createId });
      } catch (error) { message.textContent = error.message; return; }
      if (ctx.saveState() === false) {
        ctx.restoreState(undo);
        openedState = ctx.getState();
        ctx.render();
        message.textContent = "Не удалось сохранить подзадачу. Ввод сохранён, попробуйте снова.";
        return;
      }
      const savedDate = dateKey;
      dialog.close(); ctx.render();
      ctx.expandChecklist?.(saved.id, savedDate);
      ctx.showToast("Подзадача создана", { undo });
    });
    dialog.querySelector("[data-subtask-cancel]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => { form.reset(); message.textContent = ""; openedState = null; taskId = ""; });
    return { open };
  }
  const api = { appendSubtask, removeSubtask, createSubtaskDialog };
  global.RhythmTaskSubtasks = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
