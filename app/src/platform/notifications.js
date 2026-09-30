(function (global) {
  function createNotifications(ctx) {
    const pendingNotifications = new Set();
    const acknowledgedSnoozes = new Set();
    const local = (ctx.reminderStorage || global.localStorage) && global.RhythmWorkspaceLocal?.createWorkspaceLocal({
      storage: ctx.reminderStorage, getUserId: ctx.getUserId,
      onError: () => ctx.showToast?.("Не удалось сохранить отложенное напоминание"),
    });
    const desktop = () => global.rhythmDesktop || global.window?.rhythmDesktop;
    const nowDate = () => ctx.getNow?.() || new Date();
    const allowed = (date) => global.RhythmReminderPolicy?.nextAllowed(date, ctx.getQuietHours?.()) || new Date(date);
    const reminderKey = (kind, id, date) => JSON.stringify([kind, id, date]);
    const acknowledgementKey = (kind, id, date, until) => JSON.stringify([ctx.getUserId?.() || "local", kind, id, date, until]);
    function snoozes() {
      const value = local?.read("reminder-snoozes", {}) || {};
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }
    function activeSnooze(kind, id, date, queue = snoozes()) {
      const entry = queue[reminderKey(kind, id, date)];
      return entry && !entry.delivered && Number.isFinite(Date.parse(entry.until))
        && !acknowledgedSnoozes.has(acknowledgementKey(kind, id, date, entry.until)) ? entry : null;
    }
    function reminderFor(entity, dateKey, kind, queue) {
      if (kind === "habit") {
        if (!global.RhythmHabitSchedule.shouldRemind(entity, dateKey)) return null;
      } else if (ctx.isTaskDone(entity, dateKey)) return null;
      const base = kind === "habit" ? habitReminderDate(entity, dateKey) : getReminderDate(entity, dateKey);
      if (!base) return null;
      const snooze = activeSnooze(kind, entity.id, dateKey, queue);
      return { entity, dateKey, kind, snooze, at: allowed(snooze ? new Date(snooze.until) : base) };
    }
    function collectReminders(days = 7) {
      const state = ctx.getState();
      const now = nowDate();
      const dates = new Set();
      const queue = snoozes();
      for (let offset = -1; offset <= days; offset += 1) {
        const day = new Date(now); day.setDate(day.getDate() + offset); dates.add(ctx.toDateKey(day));
      }
      Object.entries(queue).forEach(([key, entry]) => {
        if (entry?.delivered || !Number.isFinite(Date.parse(entry?.until))) return;
        try { const parts = JSON.parse(key); if (/^\d{4}-\d{2}-\d{2}$/.test(parts[2])) dates.add(parts[2]); } catch { /* Ignore malformed local entries. */ }
      });
      const reminders = [];
      dates.forEach((date) => {
        const tasks = ctx.tasksForDate ? ctx.tasksForDate(date) : (state.tasks || []).filter((task) => ctx.taskOccursOn(task, date));
        tasks.forEach((task) => { const item = reminderFor(task, date, "task", queue); if (item) reminders.push(item); });
        (state.habits || []).forEach((habit) => {
          const item = reminderFor(habit, date, "habit", queue);
          if (item && (date >= ctx.toDateKey(now) || item.snooze || item.at >= new Date(now.getTime() - 86400000))) reminders.push(item);
        });
      });
      return reminders.sort((a, b) => a.at - b.at);
    }

    function markDelivered(entity, dateKey, kind) {
      const entry = activeSnooze(kind, entity.id, dateKey);
      if (entry) {
        acknowledgedSnoozes.add(acknowledgementKey(kind, entity.id, dateKey, entry.until));
        const values = snoozes(); values[reminderKey(kind, entity.id, dateKey)] = { ...entry, delivered: true };
        local?.write("reminder-snoozes", values);
      }
      entity.notified ||= {};
      entity.notified[dateKey] = true;
      ctx.saveState();
    }

    function snoozeReminder(kind, id, dateKey, choice) {
      if (!["task", "habit"].includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
      const entity = ctx.getState()[kind === "habit" ? "habits" : "tasks"].find((item) => item.id === id);
      if (!entity || (kind === "task" && !ctx.taskOccursOn(entity, dateKey)) || !reminderFor(entity, dateKey, kind)) {
        renderCenter(); ctx.showToast?.("Это событие больше не требует напоминания"); return false;
      }
      const until = allowed(global.RhythmReminderPolicy.snoozeUntil(nowDate(), choice)).toISOString();
      const entries = snoozes();
      // Keep the local queue bounded without removing pending reminders.
      Object.entries(entries).forEach(([key, entry]) => { if (entry.delivered && Date.parse(entry.until) < nowDate().getTime() - 30 * 86400000) delete entries[key]; });
      entries[reminderKey(kind, id, dateKey)] = { until, delivered: false };
      if (!local?.write("reminder-snoozes", entries)) return false;
      syncDesktopReminders(); renderCenter();
      ctx.showToast?.(`Напоминание отложено до ${new Date(until).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`);
      return true;
    }

    function bindEvents() {
      ["openReminderCenter", "settingsReminderCenter"].forEach((id) => document.querySelector(`#${id}`)?.addEventListener("click", openCenter));
      document.querySelector("#reminderClose")?.addEventListener("click", () => document.querySelector("#reminderDialog").close());
      document.querySelector("#reminderPermissionButton")?.addEventListener("click", async () => {
        if (ctx.enableNotifications) await ctx.enableNotifications();
        else await requestNotifications();
        renderCenter();
      });
      global.navigator?.serviceWorker?.addEventListener("message", (event) => { if (event.data?.type === "open-reminders") openCenter(); });
      desktop()?.onReminderClicked?.(openCenter);
      desktop()?.onReminderDelivered?.((payload) => {
        const kind = payload.habitId ? "habit" : "task";
        const entity = ctx.getState()[kind === "habit" ? "habits" : "tasks"].find((item) => item.id === (payload.habitId || payload.taskId));
        if (entity) markDelivered(entity, payload.dateKey, kind);
        if (document.querySelector("#reminderDialog")?.open) renderCenter();
      });
      const url = new URL(global.location.href);
      if (url.searchParams.has("reminders")) {
        url.searchParams.delete("reminders"); global.history.replaceState(global.history.state, "", url.href); openCenter();
      }
    }
    function openCenter() {
      renderCenter();
      const dialog = document.querySelector("#reminderDialog");
      if (!dialog.open) dialog.showModal();
    }
    function renderCenter() {
      const list = global.document?.querySelector?.("#reminderList");
      if (!list) return;
      list.replaceChildren();
      const quiet = ctx.getQuietHours?.();
      const permissionButton = document.querySelector("#reminderPermissionButton");
      if (permissionButton) {
        const enabled = ctx.getNotificationsEnabled?.() !== false;
        permissionButton.hidden = enabled && (Boolean(desktop()) || global.Notification?.permission === "granted");
        permissionButton.textContent = enabled ? "Разрешить уведомления" : "Включить напоминания";
        permissionButton.disabled = !desktop() && !("Notification" in global);
      }
      document.querySelector("#reminderStatus").textContent = ctx.getNotificationsEnabled?.() === false ? "Напоминания на паузе"
        : quiet?.enabled ? `Тихие часы: ${quiet.start}–${quiet.end}` : "Тихие часы выключены";
      const entries = collectReminders();
      if (!entries.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "На ближайшие дни напоминаний нет"; list.append(empty); }
      entries.forEach((item) => {
        const row = document.createElement("div"); row.className = "reminder-row";
        row.dataset.reminderId = item.entity.id;
        const title = document.createElement("strong"); title.textContent = item.kind === "habit" ? ctx.habitTitleOnDate?.(item.entity, item.dateKey) || item.entity.title : item.entity.title;
        const detail = document.createElement("small");
        const occurrence = ctx.parseDate(item.dateKey).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
        detail.textContent = `${item.kind === "habit" ? "Привычка" : "Задача"} за ${occurrence} · ${item.snooze ? "Отложено: " : item.entity.notified?.[item.dateKey] ? "Отправлено: " : ""}${item.at.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
        const actions = document.createElement("div"); actions.className = "feature-row-actions";
        const select = document.createElement("select"); select.setAttribute("aria-label", `Отложить: ${title.textContent}`);
        [["10", "10 минут"], ["30", "30 минут"], ["60", "1 час"], ["tomorrow", "Завтра, 09:00"]].forEach(([value, text]) => select.add(new Option(text, value)));
        const button = document.createElement("button"); button.type = "button"; button.className = "ghost-button compact-button"; button.textContent = "Отложить";
        button.addEventListener("click", () => snoozeReminder(item.kind, item.entity.id, item.dateKey, select.value));
        actions.append(select, button); row.append(title, detail, actions); list.append(row);
      });
    }

    function checkDueNotifications() {
      if (ctx.getNotificationsEnabled && !ctx.getNotificationsEnabled()) return;
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      if (desktop()) return;
      const now = nowDate();
      if (allowed(now) > now) return;
      collectReminders(1).forEach(({ entity, dateKey, kind, at, snooze }) => {
        if (at > now || (entity.notified?.[dateKey] && !snooze)) return;
        deliverNotification(entity, dateKey, kind);
      });
    }

    async function deliverNotification(task, dateKey, kind = "task") {
      const tag = `${kind === "habit" ? "habit-" : ""}${task.id}-${dateKey}`;
      if (pendingNotifications.has(tag)) return;
      pendingNotifications.add(tag);
      try {
        const options = { body: kind === "habit" ? ctx.habitTitleOnDate?.(task, dateKey) || task.title : task.title,
          data: { dateKey, [kind === "habit" ? "habitId" : "taskId"]: task.id, url: kind === "habit" ? "/app#habits" : "/app#tasks" }, tag };
        if (!desktop() && global.navigator?.serviceWorker) {
          const registration = await global.navigator.serviceWorker.getRegistration?.();
          if (registration?.showNotification) await registration.showNotification("Parsitasks", options);
          else { const notification = new Notification("Parsitasks", options); notification.onclick = openCenter; }
        } else {
          const notification = new Notification("Parsitasks", options); notification.onclick = openCenter;
        }
        markDelivered(task, dateKey, kind);
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
      if (!desktop()?.syncReminders) return;

      const now = nowDate();
      if (ctx.getNotificationsEnabled && !ctx.getNotificationsEnabled()) {
        desktop().syncReminders({ generatedAt: now.toISOString(), reminders: [] });
        return;
      }
      const reminders = collectReminders(60).filter((item) => (!item.entity.notified?.[item.dateKey] || item.snooze)
        && (item.kind !== "habit" || item.dateKey >= ctx.toDateKey(now) || item.snooze || ctx.toDateKey(item.at) >= ctx.toDateKey(now))).map(({ entity, dateKey, kind, at, snooze }) => ({
        id: `${kind}-${entity.id}-${dateKey}:${at.toISOString()}`,
        [kind === "habit" ? "habitId" : "taskId"]: entity.id,
        title: kind === "habit" ? ctx.habitTitleOnDate?.(entity, dateKey) || entity.title : entity.title,
        dateKey, reminderAt: at.toISOString(),
        dueAt: kind === "habit" || snooze ? at.toISOString() : getDueDate(entity, dateKey).toISOString(),
        category: kind === "habit" ? "Привычка" : ctx.getCategory(entity.categoryId)?.name || "",
        priority: entity.priority,
      }));
      desktop().syncReminders({ generatedAt: now.toISOString(), reminders, quietHours: ctx.getQuietHours?.() });
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

    function habitReminderDate(habit, dateKey) {
      const time = ctx.cleanTimeValue(habit.reminderTime);
      if (!time) return null;
      const date = ctx.parseDate(dateKey);
      const [hours, minutes] = time.split(":").map(Number);
      date.setHours(hours, minutes, 0, 0);
      return date;
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
      bindEvents,
      collectReminders,
      openCenter,
      renderCenter,
      snoozeReminder,
      candidateReminderDates,
      checkDueNotifications,
      deliverNotification,
      getDueDate,
      getReminderDate,
      habitReminderDate,
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
