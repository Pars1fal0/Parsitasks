(function (global) {
  const editorApi = global.RhythmJournalEditor || (typeof require !== "undefined" ? require("./journal-editor.js") : null);
  const PROMPTS = [
    "Что сегодня запомнилось?",
    "Что сегодня получилось?",
    "Что оказалось сложнее, чем ожидалось?",
    "За что ты благодарен этому дню?",
    "Что хочется сделать иначе завтра?",
  ];

  function createJournalView(ctx) {
    let pendingDate = "";
    let monthAnchor = "";
    let saveTimer = null;
    let promptIndex = 0;

    function bindEvents() {
      ctx.els.journalText?.addEventListener("input", handleInput);
      ctx.els.journalText?.addEventListener("blur", flush);
      ctx.els.journalText?.addEventListener("paste", handlePaste);
      (ctx.els.journalFormatButtons || []).forEach((button) => {
        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          editorApi.applyFormat(ctx.els.journalText, button.dataset.journalFormat);
          handleInput();
        });
      });
      ctx.els.journalPrompt?.addEventListener("click", cyclePrompt);
      ctx.els.journalPrevMonth?.addEventListener("click", () => shiftMonth(-1));
      ctx.els.journalNextMonth?.addEventListener("click", () => shiftMonth(1));
      [ctx.els.journalSearch, ctx.els.journalSearchFrom, ctx.els.journalSearchTo]
        .forEach((element) => element?.addEventListener("input", renderSearchResults));
    }

    function render() {
      const date = ctx.getActiveDate();
      const entry = ctx.getEntry(date);
      if (!monthAnchor || monthAnchor.slice(0, 7) !== date.slice(0, 7)) monthAnchor = date;
      ctx.els.journalDate.textContent = ctx.formatLongDate(date);
      if (document.activeElement !== ctx.els.journalText || pendingDate !== date) {
        editorApi.writeText(ctx.els.journalText, entry?.text || "");
      }
      pendingDate = date;
      renderCount();
      renderPrompt(entry);
      renderStatus(entry?.updatedAt ? `Сохранено ${ctx.formatTime(entry.updatedAt)}` : "Запись сохранится автоматически");
      renderCalendar();
      renderSearchResults();
      renderHistory(entry);
    }

    function handleInput() {
      pendingDate = ctx.getActiveDate();
      const text = editorText();
      if (text.length > ctx.maxLength) editorApi.writeText(ctx.els.journalText, text.slice(0, ctx.maxLength));
      renderCount();
      renderPrompt({ text: editorText() });
      renderStatus("Сохраняю...");
      if (saveTimer) global.clearTimeout(saveTimer);
      saveTimer = global.setTimeout(flush, 550);
    }

    function flush() {
      if (saveTimer) global.clearTimeout(saveTimer);
      saveTimer = null;
      const date = pendingDate || ctx.getActiveDate();
      const result = ctx.saveEntry(date, editorText());
      const entry = result?.entry || ctx.getEntry(date);
      renderStatus(entry?.updatedAt ? `Сохранено ${ctx.formatTime(entry.updatedAt)}` : "Запись сохранится автоматически");
      if (result?.changed) {
        renderCalendar();
        renderSearchResults();
        renderHistory(entry);
      }
    }

    function renderCalendar() {
      const model = ctx.buildMonth(ctx.getEntries(), monthAnchor || ctx.getActiveDate(), ctx.getFirstDayOfWeek());
      const monthDate = new Date(Date.UTC(model.year, model.month, 1));
      ctx.els.journalCalendarTitle.textContent = new Intl.DateTimeFormat("ru-RU", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(monthDate);
      replaceChildren(ctx.els.journalWeekdays, weekdayLabels(ctx.getFirstDayOfWeek()).map((label) => textNode("span", label)));
      const activeDate = ctx.getActiveDate();
      replaceChildren(ctx.els.journalCalendarGrid, model.days.map((day) => {
        const button = textNode("button", String(day.day), "journal-calendar-day");
        button.type = "button";
        button.dataset.date = day.date;
        button.classList.toggle("is-outside", !day.currentMonth);
        button.classList.toggle("has-entry", day.hasEntry);
        button.classList.toggle("is-active", day.date === activeDate);
        button.setAttribute("aria-label", ctx.formatLongDate(day.date));
        if (day.date === activeDate) button.setAttribute("aria-current", "date");
        button.addEventListener("click", () => {
          flush();
          monthAnchor = day.date;
          ctx.setActiveDate(day.date);
        });
        return button;
      }));
    }

    function renderSearchResults() {
      if (!ctx.els.journalSearchResults) return;
      const query = ctx.els.journalSearch?.value || "";
      const from = ctx.els.journalSearchFrom?.value || "";
      const to = ctx.els.journalSearchTo?.value || "";
      const shouldShow = Boolean(query.trim() || from || to);
      const results = shouldShow ? ctx.searchEntries(ctx.getEntries(), query, { from, to }).slice(0, 20) : [];
      if (!shouldShow) {
        ctx.els.journalSearchResults.replaceChildren();
        return;
      }
      if (!results.length) {
        replaceChildren(ctx.els.journalSearchResults, [textNode("p", "Ничего не найдено", "muted")]);
        return;
      }
      replaceChildren(ctx.els.journalSearchResults, results.map((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "journal-search-result";
        button.append(textNode("strong", ctx.formatLongDate(entry.date)));
        button.append(textNode("span", excerpt(entry.text)));
        button.addEventListener("click", () => {
          flush();
          monthAnchor = entry.date;
          ctx.setActiveDate(entry.date);
        });
        return button;
      }));
    }

    function renderHistory(entry) {
      const revisions = [...(entry?.revisions || [])].reverse();
      ctx.els.journalHistoryCount.textContent = revisions.length ? String(revisions.length) : "";
      if (!revisions.length) {
        replaceChildren(ctx.els.journalHistoryList, [textNode("p", "Предыдущих версий пока нет", "muted")]);
        return;
      }
      replaceChildren(ctx.els.journalHistoryList, revisions.map((revision) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "journal-history-item";
        button.append(textNode("strong", `Версия от ${ctx.formatDateTime(revision.savedAt)}`));
        button.append(textNode("span", excerpt(revision.text)));
        button.addEventListener("click", async () => {
          const confirmed = await ctx.confirmRestore?.(revision.savedAt);
          if (confirmed === false) return;
          const result = ctx.restoreRevision(entry.date, revision.savedAt);
          if (!result?.changed) return;
          editorApi.writeText(ctx.els.journalText, result.entry.text);
          render();
          ctx.showToast?.("Предыдущая версия восстановлена");
        });
        return button;
      }));
    }

    function cyclePrompt() {
      promptIndex = (promptIndex + 1) % PROMPTS.length;
      renderPrompt({ text: editorText() });
      ctx.els.journalText.focus();
    }

    function renderPrompt(entry) {
      const empty = !String(entry?.text || "").trim();
      ctx.els.journalPrompt.hidden = !empty;
      ctx.els.journalPrompt.textContent = PROMPTS[promptIndex];
      editorApi.setPlaceholder(ctx.els.journalText, PROMPTS[promptIndex]);
    }

    function shiftMonth(delta) {
      const source = new Date(`${monthAnchor || ctx.getActiveDate()}T00:00:00.000Z`);
      source.setUTCMonth(source.getUTCMonth() + delta, 1);
      monthAnchor = source.toISOString().slice(0, 10);
      renderCalendar();
    }

    function renderCount() {
      const length = editorText().length;
      ctx.els.journalCount.textContent = `${length.toLocaleString("ru-RU")} / ${ctx.maxLength.toLocaleString("ru-RU")}`;
    }

    function handlePaste(event) {
      if (!event.clipboardData || ["INPUT", "TEXTAREA"].includes(ctx.els.journalText.tagName)) return;
      event.preventDefault();
      editorApi.insertPlainText(ctx.els.journalText, event.clipboardData.getData("text/plain"));
    }

    function editorText() {
      return editorApi.readText(ctx.els.journalText);
    }

    function renderStatus(message) {
      ctx.els.journalStatus.textContent = message;
    }

    return { bindEvents, flush, render };
  }

  function weekdayLabels(firstDay) {
    const labels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    return firstDay === "sunday" ? [labels[6], ...labels.slice(0, 6)] : labels;
  }

  function excerpt(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > 110 ? `${text.slice(0, 107)}...` : text;
  }

  function textNode(tagName, text, className = "") {
    const element = document.createElement(tagName);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function replaceChildren(element, children) {
    element.replaceChildren(...children);
  }

  const api = { createJournalView, excerpt, weekdayLabels };
  global.RhythmJournalView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
