(function (global) {
  function createNotifications(ctx) {
    const pendingNotifications = new Set();

    function checkDueNotifications() {
      if (ctx.getNotificationsEnabled && !ctx.getNotificationsEnabled()) return;
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      const now = new Date();

      ctx.getState().tasks.forEach((task) => {
        const dates = candidateReminderDates(task, now);
        dates.forEach((dateKey) => {
          const reminderAt = getReminderDate(task, dateKey);
          if (!reminderAt || reminderAt > now || ctx.isTaskDone(task, dateKey) || task.notified?.[dateKey]) return;
          deliverNotification(task, dateKey);
        });
      });
    }

    async function deliverNotification(task, dateKey) {
      const tag = `${task.id}-${dateKey}`;
      if (pendingNotifications.has(tag)) return;
      pendingNotifications.add(tag);
      try {
        const options = { body: task.title, data: { dateKey, taskId: task.id, url: "/app#tasks" }, tag };
        if (!global.rhythmDesktop && global.navigator?.serviceWorker) {
          const registration = await global.navigator.serviceWorker.getRegistration?.();
          if (registration?.showNotification) await registration.showNotification("Parsitasks", options);
          else new Notification("Parsitasks", options);
        } else {
          new Notification("Parsitasks", options);
        }
        task.notified ||= {};
        task.notified[dateKey] = true;
        ctx.saveState();
      } catch {
        // Keep the reminder pending in state so a later check can try again.
      } finally {
        pendingNotifications.delete(tag);
      }
    }

    async function requestNotifications() {
      if (window.rhythmDesktop) {
        await window.rhythmDesktop.showTestNotification();
        updateNotificationButton("granted");
        ctx.showToast("Фоновые напоминания активны");
        return;
      }

      if (!("Notification" in window)) {
        ctx.els.notifyButton.textContent = "Не поддерживаются";
        return;
      }

      const permission = await Notification.requestPermission();
      updateNotificationButton(permission);
    }

    function updateNotificationButton(permission = "Notification" in window ? Notification.permission : "default") {
      if (ctx.getNotificationsEnabled && !ctx.getNotificationsEnabled()) {
        setNotifyButtonLabel("Напоминания на паузе");
        ctx.els.desktopStatus.textContent = "Уведомления отключены в настройках";
        return;
      }

      if (window.rhythmDesktop) {
        setNotifyButtonLabel("Фон включен");
        ctx.els.desktopStatus.textContent = "Закрытое окно останется в фоне";
        return;
      }
      setNotifyButtonLabel(permission === "granted" ? "Уведомления включены" : "Уведомления");
      if (ctx.els.desktopStatus) {
        ctx.els.desktopStatus.textContent = permission === "granted"
          ? "В браузере напоминания работают, пока вкладка открыта"
          : "Для фоновых напоминаний используй desktop-версию";
      }
    }

    function setNotifyButtonLabel(label) {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      icon.classList.add("ui-icon");
      use.setAttribute("href", "#icon-bell");
      icon.appendChild(use);
      ctx.els.notifyButton.replaceChildren(icon, document.createTextNode(label));
    }
    function syncDesktopReminders() {
      if (!window.rhythmDesktop?.syncReminders) return;

      const now = new Date();
      if (ctx.getNotificationsEnabled && !ctx.getNotificationsEnabled()) {
        window.rhythmDesktop.syncReminders({ generatedAt: now.toISOString(), reminders: [] });
        return;
      }

      const start = new Date(now);
      start.setDate(now.getDate() - 1);
      const reminders = [];

      for (let i = 0; i < 62; i += 1) {
        const current = new Date(start);
        current.setDate(start.getDate() + i);
        const dateKey = ctx.toDateKey(current);
        ctx.tasksForDate(dateKey).forEach((task) => {
          const reminderAt = getReminderDate(task, dateKey);
          if (!reminderAt || ctx.isTaskDone(task, dateKey)) return;
          const dueAt = getDueDate(task, dateKey);
          reminders.push({
            id: `${task.id}-${dateKey}`,
            taskId: task.id,
            title: task.title,
            dateKey,
            dueAt: dueAt.toISOString(),
            reminderAt: reminderAt.toISOString(),
            category: ctx.getCategory(task.categoryId)?.name || "",
            priority: task.priority,
          });
        });
      }

      window.rhythmDesktop.syncReminders({ generatedAt: now.toISOString(), reminders });
    }

    function candidateReminderDates(task, now) {
      const dates = [];
      for (let offset = -1; offset <= 1; offset += 1) {
        const date = new Date(now);
        date.setDate(now.getDate() + offset);
        const dateKey = ctx.toDateKey(date);
        if (ctx.taskOccursOn(task, dateKey)) dates.push(dateKey);
      }
      return dates;
    }

    function getDueDate(task, dateKey) {
      const [hours, minutes] = (ctx.cleanTimeValue(task.time) || "09:00").split(":").map(Number);
      const date = ctx.parseDate(dateKey);
      date.setHours(hours || 0, minutes || 0, 0, 0);
      return date;
    }

    function getTaskDeadlineDate(task, dateKey) {
      const date = ctx.parseDate(dateKey);
      const time = ctx.cleanTimeValue(task.time);
      if (!time) {
        date.setHours(23, 59, 59, 999);
        return date;
      }

      const [hours, minutes] = time.split(":").map(Number);
      date.setHours(hours, minutes, 0, 0);
      return date;
    }

    function getReminderDate(task, dateKey) {
      const reminderTime = task.scheduleMode === "block" ? ctx.cleanTimeValue(task.startTime) : ctx.cleanTimeValue(task.time);
      if (!reminderTime || task.reminderOffset === "none") return null;
      const offset = Number(task.reminderOffset || 0);
      if (!Number.isFinite(offset)) return null;
      const reminder = ctx.parseDate(dateKey);
      const [hours, minutes] = reminderTime.split(":").map(Number);
      reminder.setHours(hours, minutes, 0, 0);
      reminder.setMinutes(reminder.getMinutes() - offset);
      return reminder;
    }

    return {
      candidateReminderDates,
      checkDueNotifications,
      deliverNotification,
      getDueDate,
      getReminderDate,
      getTaskDeadlineDate,
      requestNotifications,
      syncDesktopReminders,
      updateNotificationButton,
    };
  }

  const api = { createNotifications };
  global.RhythmNotifications = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
