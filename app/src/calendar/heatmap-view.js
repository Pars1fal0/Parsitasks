const WEEKDAY_LABELS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
const MONTH_LABELS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function createHeatmapView(ctx) {
  const compactQuery = typeof globalThis.matchMedia === "function" ? globalThis.matchMedia("(max-width: 680px)") : null;
  let inspectedDate = "";
  let range = "tracking";
  const rangeControls = ctx.els.heatmapGrid?.parentElement?.querySelector(".heatmap-range-toolbar");
  rangeControls?.querySelectorAll("[data-heatmap-range]").forEach((button) => {
    button.addEventListener("click", () => { range = button.dataset.heatmapRange; renderHeatmap(); });
  });

  function renderHeatmap() {
    const model = buildHeatmapModel({
      activeDate: ctx.getActiveDate(),
      formatLongDate: ctx.formatLongDate,
      parseDate: ctx.parseDate,
      statsForDate: ctx.statsForDate,
      toDateKey: ctx.toDateKey,
      range,
    });
    rangeControls?.querySelectorAll("[data-heatmap-range]").forEach((button) => {
      const selected = button.dataset.heatmapRange === range;
      button.classList.toggle("is-active", selected); button.setAttribute("aria-pressed", String(selected));
    });
    const period = rangeControls?.querySelector(".heatmap-range-label");
    if (period) {
      const formatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });
      const first = formatter.format(ctx.parseDate(model.days[0].dateKey));
      const last = formatter.format(ctx.parseDate(model.days.at(-1).dateKey));
      period.textContent = first === last ? first : `${first} — ${last}`;
    }
    const tooltipNode = getHeatmapTooltip();
    hideHeatmapTooltip(tooltipNode);
    let inspector = ctx.els.heatmapGrid.parentElement.querySelector(".heatmap-inspector");
    if (!inspector) {
      inspector = document.createElement("div"); inspector.className = "heatmap-inspector";
      const label = document.createElement("label"); label.textContent = "Подробности за день";
      const input = document.createElement("input"); input.type = "date"; input.setAttribute("aria-label", "День для статистики");
      label.append(input);
      const output = document.createElement("p"); output.setAttribute("role", "status");
      inspector.append(label, output); ctx.els.heatmapGrid.after(inspector);
      input.addEventListener("change", () => { inspectedDate = input.value; renderHeatmap(); });
    }
    const selected = model.days.find((day) => day.dateKey === inspectedDate) || model.days.at(-1);
    inspectedDate = selected.dateKey;
    const dateInput = inspector.querySelector("input");
    dateInput.min = model.days[0].dateKey; dateInput.max = model.days.at(-1).dateKey; dateInput.value = inspectedDate;
    const stats = ctx.statsForDate(inspectedDate);
    inspector.querySelector("p").textContent = `${ctx.formatLongDate(inspectedDate)}: задачи ${stats.taskDone || 0} из ${stats.taskTotal || 0}, привычки ${stats.habitDone || 0} из ${stats.habitTotal || 0}${stats.habitFrozen ? `, заморожено ${stats.habitFrozen}` : ""}`;

    ctx.els.heatmapGrid.replaceChildren();
    ctx.els.heatmapGrid.style.setProperty("--heatmap-columns", model.columns);
    const slots = [
      ...Array.from({ length: model.leadingBlanks }, () => null),
      ...model.days,
      ...Array.from({ length: model.trailingBlanks }, () => null),
    ];

    if (compactQuery?.matches && model.columns > 26) {
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
  visibleMonthSpans(model.monthSpans, startColumn, columnCount).forEach((item) => {
    const node = document.createElement("span");
    node.textContent = item.label;
    node.style.gridColumn = `${item.column - startColumn + 1} / span ${item.span}`;
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
  if (day.areTasksComplete) cell.classList.add("is-tasks-complete");
  if (day.areHabitsComplete) cell.classList.add("is-habits-complete");
  if (day.isPerfectDay) cell.classList.add("is-perfect-day");
  if (day.habitFrozen) cell.classList.add("has-frozen-habit");
  if (day.habitFrozen && day.habitTotal === 0) cell.classList.add("all-habits-frozen");
  cell.setAttribute("aria-label", day.tooltip);
  if (day.dateKey === model.activeDate) cell.classList.add("is-current");
  if (day.dateKey === ctx.todayKey?.()) { cell.classList.add("is-today"); cell.setAttribute("aria-current", "date"); }
  bindTooltip(cell, tooltipNode, day.tooltip);
  return cell;
}

function buildHeatmapModel({ activeDate, formatLongDate, parseDate, statsForDate, toDateKey, range = "year" }) {
  const end = parseDate(activeDate);
  const start = new Date(end);
  start.setDate(end.getDate() - 364);

  let days = [];
  const monthLabels = [];
  const monthSpans = [];
  let lastMonth = "";

  for (let i = 0; i < 365; i += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const dateKey = toDateKey(current);
    const stats = statsForDate(dateKey);
    const areTasksComplete = stats.taskTotal > 0 && stats.taskDone === stats.taskTotal;
    const areHabitsComplete = stats.habitTotal > 0 && stats.habitDone === stats.habitTotal;
    const isPerfectDay = areTasksComplete && areHabitsComplete;
    days.push({
      dateKey,
      areTasksComplete,
      areHabitsComplete,
      isPerfectDay,
      habitPercent: stats.habitPercent,
      habitFrozen: stats.habitFrozen || 0,
      habitTotal: stats.habitTotal || 0,
      taskPercent: stats.taskPercent,
      taskTotal: stats.taskTotal || 0,
      tooltip: `${formatLongDate(dateKey)} (${dateKey}): задачи ${stats.taskDone || 0} из ${stats.taskTotal || 0}, привычки ${stats.habitDone || 0} из ${stats.habitTotal || 0}${stats.habitFrozen ? `, заморожено ${stats.habitFrozen}` : ""}${isPerfectDay ? " · Всё выполнено" : ""}`,
    });
  }

  if (range === "tracking") {
    const first = days.findIndex((day) => day.taskTotal > 0 || day.habitTotal > 0 || day.habitFrozen > 0);
    days = days.slice(first < 0 ? -1 : first);
  }
  const leadingBlanks = weekdayIndex(parseDate(days[0].dateKey));
  days.forEach((day, index) => {
    const current = parseDate(day.dateKey);
    const column = Math.floor((leadingBlanks + index) / 7);
    const monthKey = `${current.getFullYear()}-${current.getMonth()}`;
    if (monthKey !== lastMonth) {
      monthLabels[column] = monthLabel(current);
      monthSpans.push({ column, label: monthLabel(current) });
      lastMonth = monthKey;
    }
  });

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
  return MONTH_LABELS[date.getMonth()];
}

function visibleMonthSpans(spans, startColumn, columnCount) {
  const endColumn = startColumn + columnCount;
  return spans.map((item) => {
    const column = Math.max(startColumn, item.column);
    return { ...item, column, span: Math.min(endColumn, item.column + item.span) - column };
  }).filter((item) => item.span >= 3);
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

const api = { buildHeatmapModel, createHeatmapView, visibleMonthSpans };

export { buildHeatmapModel, createHeatmapView, visibleMonthSpans };
export default api;
