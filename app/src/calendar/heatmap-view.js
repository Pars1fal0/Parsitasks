(function (global) {
  const WEEKDAY_LABELS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

  function createHeatmapView(ctx) {
    const compactQuery = typeof global.matchMedia === "function" ? global.matchMedia("(max-width: 680px)") : null;

    function renderHeatmap() {
      const model = buildHeatmapModel({
        activeDate: ctx.getActiveDate(),
        formatLongDate: ctx.formatLongDate,
        parseDate: ctx.parseDate,
        statsForDate: ctx.statsForDate,
        toDateKey: ctx.toDateKey,
      });
      const tooltipNode = getHeatmapTooltip();

      ctx.els.heatmapGrid.replaceChildren();
      const slots = [
        ...Array.from({ length: model.leadingBlanks }, () => null),
        ...model.days,
        ...Array.from({ length: model.trailingBlanks }, () => null),
      ];

      if (compactQuery?.matches) {
        const firstHalfColumns = Math.ceil(model.columns / 2);
        ctx.els.heatmapGrid.classList.add("is-split");
        ctx.els.heatmapGrid.append(
          createHeatmapSection(model, slots, 0, firstHalfColumns, tooltipNode, ctx),
          createHeatmapSection(model, slots, firstHalfColumns, model.columns - firstHalfColumns, tooltipNode, ctx),
        );
        return;
      }

      ctx.els.heatmapGrid.classList.remove("is-split");
      ctx.els.heatmapGrid.append(...createHeatmapParts(model, slots, 0, model.columns, tooltipNode, ctx));
    }

    compactQuery?.addEventListener?.("change", renderHeatmap);

    return { renderHeatmap };
  }

  function createHeatmapSection(model, slots, startColumn, columnCount, tooltipNode, ctx) {
    const section = document.createElement("div");
    section.className = "heatmap-half";
    section.append(...createHeatmapParts(model, slots, startColumn, columnCount, tooltipNode, ctx));
    return section;
  }

  function createHeatmapParts(model, slots, startColumn, columnCount, tooltipNode, ctx) {
    const monthRow = document.createElement("div");
    const weekdayColumn = document.createElement("div");
    const cellsGrid = document.createElement("div");
    const endColumn = startColumn + columnCount;

    monthRow.className = "heatmap-months";
    monthRow.style.setProperty("--heatmap-columns", columnCount);
    model.monthSpans.forEach((item) => {
      const overlapStart = Math.max(startColumn, item.column);
      const overlapEnd = Math.min(endColumn, item.column + item.span);
      if (overlapStart >= overlapEnd) return;
      const node = document.createElement("span");
      node.textContent = item.label;
      node.style.gridColumn = `${overlapStart - startColumn + 1} / span ${overlapEnd - overlapStart}`;
      monthRow.appendChild(node);
    });

    weekdayColumn.className = "heatmap-weekdays";
    WEEKDAY_LABELS.forEach((label) => {
      const node = document.createElement("span");
      node.textContent = label;
      weekdayColumn.appendChild(node);
    });

    cellsGrid.className = "heatmap-cells";
    cellsGrid.style.setProperty("--heatmap-columns", columnCount);
    slots.slice(startColumn * 7, endColumn * 7).forEach((day) => {
      cellsGrid.appendChild(day ? createHeatmapCell(model, day, tooltipNode, ctx) : createEmptyCell());
    });

    return [monthRow, weekdayColumn, cellsGrid];
  }

  function createHeatmapCell(model, day, tooltipNode, ctx) {
    const cell = document.createElement("div");
    cell.className = "heatmap-cell";
    cell.tabIndex = 0;
    cell.dataset.date = day.dateKey;
    cell.dataset.tooltip = day.tooltip;
    cell.style.setProperty("--task-alpha", ctx.heatAlpha(day.taskPercent));
    cell.style.setProperty("--habit-alpha", ctx.heatAlpha(day.habitPercent));
    cell.setAttribute("aria-label", day.tooltip);
    if (day.dateKey === model.activeDate) cell.classList.add("is-current");
    bindTooltip(cell, tooltipNode, day.tooltip);
    return cell;
  }

  function buildHeatmapModel({ activeDate, formatLongDate, parseDate, statsForDate, toDateKey }) {
    const end = parseDate(activeDate);
    const start = new Date(end);
    start.setDate(end.getDate() - 364);

    const leadingBlanks = weekdayIndex(start);
    const days = [];
    const monthLabels = [];
    const monthSpans = [];
    let lastMonth = "";

    for (let i = 0; i < 365; i += 1) {
      const current = new Date(start);
      current.setDate(start.getDate() + i);
      const dateKey = toDateKey(current);
      const stats = statsForDate(dateKey);
      const slotIndex = leadingBlanks + i;
      const column = Math.floor(slotIndex / 7);
      const monthKey = `${current.getFullYear()}-${current.getMonth()}`;

      if (monthKey !== lastMonth) {
        monthLabels[column] = monthLabel(current);
        monthSpans.push({ column, label: monthLabel(current) });
        lastMonth = monthKey;
      }

      days.push({
        dateKey,
        habitPercent: stats.habitPercent,
        taskPercent: stats.taskPercent,
        tooltip: `${formatLongDate(dateKey)} (${dateKey}): задачи ${stats.taskPercent}%, привычки ${stats.habitPercent}%`,
      });
    }

    const totalSlots = Math.ceil((leadingBlanks + days.length) / 7) * 7;
    const columns = totalSlots / 7;
    const trailingBlanks = totalSlots - leadingBlanks - days.length;
    const resolvedMonthSpans = monthSpans.map((item, index) => ({
      ...item,
      span: Math.max(1, (monthSpans[index + 1]?.column ?? columns) - item.column),
    }));

    return {
      activeDate,
      columns,
      days,
      leadingBlanks,
      monthLabels: Array.from({ length: columns }, (_, index) => monthLabels[index] || ""),
      monthSpans: resolvedMonthSpans,
      trailingBlanks,
    };
  }

  function monthLabel(date) {
    return new Intl.DateTimeFormat("ru-RU", { month: "short" }).format(date).replace(".", "");
  }

  function weekdayIndex(date) {
    return (date.getDay() + 6) % 7;
  }

  function createEmptyCell() {
    const node = document.createElement("div");
    node.className = "heatmap-empty-cell";
    return node;
  }

  function bindTooltip(cell, tooltipNode, text) {
    cell.addEventListener("pointerenter", () => showHeatmapTooltip(tooltipNode, cell, text));
    cell.addEventListener("pointermove", () => positionHeatmapTooltip(tooltipNode, cell));
    cell.addEventListener("pointerleave", () => hideHeatmapTooltip(tooltipNode));
    cell.addEventListener("click", () => showHeatmapTooltip(tooltipNode, cell, text));
    cell.addEventListener("focus", () => showHeatmapTooltip(tooltipNode, cell, text));
    cell.addEventListener("blur", () => hideHeatmapTooltip(tooltipNode));
  }

  function getHeatmapTooltip() {
    let tooltip = document.querySelector("[data-heatmap-tooltip]");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "heatmap-tooltip";
      tooltip.dataset.heatmapTooltip = "";
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function showHeatmapTooltip(tooltip, cell, text) {
    tooltip.textContent = text;
    tooltip.classList.add("is-visible");
    positionHeatmapTooltip(tooltip, cell);
  }

  function positionHeatmapTooltip(tooltip, cell) {
    const rect = cell.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportPadding = 10;
    const desiredLeft = rect.left + rect.width / 2 - tooltipRect.width / 2;
    const left = Math.min(Math.max(viewportPadding, desiredLeft), window.innerWidth - tooltipRect.width - viewportPadding);
    const hasRoomAbove = rect.top > tooltipRect.height + 14;
    const top = hasRoomAbove ? rect.top - tooltipRect.height - 8 : rect.bottom + 8;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function hideHeatmapTooltip(tooltip) {
    tooltip.classList.remove("is-visible");
  }

  const api = { buildHeatmapModel, createHeatmapView };
  global.RhythmHeatmapView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
