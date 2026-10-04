(function (global) {
  function buildActivitySeries({ endDate, days = 30, today, parseDate, toDateKey, statsForDate }) {
    const end = parseDate(endDate > today ? today : endDate);
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(end);
      date.setDate(end.getDate() - (days - 1 - index));
      const key = toDateKey(date);
      const stats = statsForDate(key);
      const habitDone = Math.max(0, stats.habitDone - (stats.habitFlexibleDone || 0));
      const habitTotal = Math.max(0, stats.habitTotal - (stats.habitFlexibleDone || 0));
      return { date: key, taskDone: stats.taskDone, taskTotal: stats.taskTotal, habitDone, habitTotal,
        taskPercent: stats.taskTotal ? Math.round(stats.taskDone / stats.taskTotal * 100) : null,
        habitPercent: habitTotal ? Math.round(habitDone / habitTotal * 100) : null };
    });
  }

  function createActivityCharts(ctx) {
    const root = document.querySelector("#activityCharts");
    let days = 30;
    let charts = [];
    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function render() {
      charts.forEach((chart) => chart.destroy()); charts = [];
      root.replaceChildren();
      const series = buildActivitySeries({ endDate: ctx.getActiveDate(), days, today: ctx.toDateKey(new Date()), ...ctx });
      const toolbar = element("div", "activity-chart-toolbar");
      const period = element("div", "activity-chart-period");
      period.append(element("h2", "", "Динамика"), element("span", "muted", `${ctx.formatShortDate(series[0].date)} — ${ctx.formatShortDate(series.at(-1).date)}`));
      const control = element("div", "segmented-control"); control.setAttribute("aria-label", "Период графиков");
      [7, 30, 90].forEach((value) => {
        const choice = element("button", days === value ? "is-active" : "", `${value} дней`); choice.type = "button";
        choice.dataset.chartDays = value; choice.setAttribute("aria-pressed", String(days === value));
        choice.addEventListener("click", () => { days = value; if (ctx.onPeriodChange) ctx.onPeriodChange(); else render(); root.querySelector(`[data-chart-days="${value}"]`)?.focus({ preventScroll: true }); });
        control.append(choice);
      });
      toolbar.append(period, control); root.append(toolbar);
      const grid = element("div", "activity-chart-grid"); root.append(grid);
      const colors = getComputedStyle(document.documentElement);
      const muted = colors.getPropertyValue("--muted").trim();
      const text = colors.getPropertyValue("--text").trim();
      const reduced = global.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const formatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
      const configs = [
        { key: "tasks", title: "Задачи", color: colors.getPropertyValue("--teal").trim(), label: "Выполнено, %", value: (point) => point.taskPercent,
          total: (() => { const scheduled = series.filter((point) => point.taskTotal); return scheduled.length ? `${Math.round(scheduled.reduce((sum, point) => sum + point.taskDone / point.taskTotal * 100, 0) / scheduled.length)}%` : "—"; })(),
          unit: "в среднем за день", hasData: series.some((point) => point.taskTotal),
          detail: (point) => point.taskTotal ? `${point.taskPercent}% · выполнено ${point.taskDone} из ${point.taskTotal}` : "Не было задач" },
        { key: "habits", title: "Привычки по расписанию", color: "#82aaff", label: "Выполнено, %", value: (point) => point.habitPercent,
          total: (() => { const count = series.reduce((sum, point) => sum + point.habitTotal, 0); return count ? `${Math.round(series.reduce((sum, point) => sum + point.habitDone, 0) / count * 100)}%` : "—"; })(),
          unit: "выполнение за период", hasData: series.some((point) => point.habitTotal),
          detail: (point) => point.habitTotal ? `${point.habitPercent}% · выполнено ${point.habitDone} из ${point.habitTotal}` : "Не было запланированных привычек" },
      ];
      configs.forEach((config) => {
        const section = element("section", "activity-chart-section"); section.dataset.activityChart = config.key;
        const heading = element("div", "activity-chart-heading");
        const title = element("h3", "", config.title);
        const metric = element("div", "activity-chart-metric");
        metric.append(element("strong", "", String(config.total)), element("span", "muted", config.unit));
        heading.append(title, metric); section.append(heading); grid.append(section);
        const legend = element("div", "activity-chart-legend");
        const done = element("span", "", config.label); done.style.setProperty("--series-color", config.color); legend.append(done);
        section.append(legend);
        if (!config.hasData) { section.append(element("p", "activity-chart-empty muted", config.key === "tasks" ? "За этот период задач пока нет" : "За этот период нет привычек по расписанию")); return; }
        const frame = element("div", "activity-chart-frame");
        const canvas = element("canvas"); canvas.tabIndex = 0; canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `${config.title}: ${config.total} ${config.unit}`);
        canvas.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight Home End Escape");
        const tooltip = element("div", "activity-chart-tooltip"); tooltip.hidden = true;
        const tooltipDate = element("strong"); const tooltipValue = element("span");
        tooltip.append(tooltipDate, tooltipValue);
        const announcement = element("span", "sr-only"); announcement.setAttribute("role", "status"); announcement.setAttribute("aria-live", "polite");
        frame.append(canvas, tooltip, announcement); section.append(frame);
        let selected = -1;
        const cursor = { id: `activityCursor-${config.key}`, afterDraw(chart) {
          if (selected < 0) return;
          const x = chart.scales.x.getPixelForValue(selected); const { top, bottom } = chart.chartArea;
          const drawing = chart.ctx; drawing.save(); drawing.strokeStyle = muted; drawing.lineWidth = 1;
          drawing.setLineDash([3, 4]); drawing.beginPath(); drawing.moveTo(x, top); drawing.lineTo(x, bottom); drawing.stroke(); drawing.restore();
        } };
        const data = [{ label: config.label, data: series.map(config.value), borderColor: config.color,
          backgroundColor: config.color + "18", fill: true, borderWidth: 2.5, cubicInterpolationMode: "monotone",
          pointRadius: days === 7 ? 3 : 2, pointHoverRadius: 5, pointBackgroundColor: config.color, spanGaps: false }];
        const chart = new global.RhythmCharts.Chart(canvas, {
          type: "line", data: { labels: series.map((point) => formatter.format(ctx.parseDate(point.date))), datasets: data }, plugins: [cursor],
          options: { responsive: true, maintainAspectRatio: false, animation: reduced ? false : { duration: 450, easing: "easeOutQuart" },
            interaction: { mode: "index", intersect: false }, plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { border: { display: false }, grid: { display: false }, ticks: { color: muted, maxRotation: 0, maxTicksLimit: 5, font: { size: 11 } } },
              y: { min: 0, max: 100, border: { display: false },
                grid: { color: "rgba(129, 144, 139, .16)", tickLength: 0 }, ticks: { color: muted, precision: 0, maxTicksLimit: 5, padding: 8,
                  callback: (value) => `${value}%`, font: { size: 11 } } } },
            color: text,
          },
        }); charts.push(chart);
        function inspect(index, announce = false) {
          selected = Math.max(0, Math.min(series.length - 1, index));
          const point = series[selected]; tooltip.dataset.date = point.date;
          tooltipDate.textContent = ctx.formatLongDate(point.date); tooltipValue.textContent = config.detail(point);
          tooltip.hidden = false;
          const x = chart.scales.x.getPixelForValue(selected);
          tooltip.style.left = `${Math.max(8, Math.min(frame.clientWidth - tooltip.offsetWidth - 8, x - tooltip.offsetWidth / 2))}px`;
          const active = chart.data.datasets.flatMap((dataset, datasetIndex) => dataset.data[selected] === null ? [] : [{ datasetIndex, index: selected }]);
          chart.setActiveElements(active); chart.update("none");
          if (announce) announcement.textContent = `${tooltipDate.textContent}. ${tooltipValue.textContent}`;
        }
        canvas.addEventListener("pointermove", (event) => {
          const rect = canvas.getBoundingClientRect();
          inspect(Math.round(chart.scales.x.getValueForPixel(event.clientX - rect.left)));
        });
        canvas.addEventListener("pointerdown", (event) => { const rect = canvas.getBoundingClientRect(); inspect(Math.round(chart.scales.x.getValueForPixel(event.clientX - rect.left)), true); });
        canvas.addEventListener("pointerleave", () => { if (document.activeElement === canvas) return; selected = -1; tooltip.hidden = true; chart.setActiveElements([]); chart.update("none"); });
        canvas.addEventListener("focus", () => inspect(selected < 0 ? series.length - 1 : selected, true));
        canvas.addEventListener("blur", () => { selected = -1; tooltip.hidden = true; chart.setActiveElements([]); chart.update("none"); });
        canvas.addEventListener("keydown", (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
          event.preventDefault();
          if (event.key === "Escape") { tooltip.hidden = true; selected = -1; chart.setActiveElements([]); chart.update("none"); return; }
          inspect(event.key === "Home" ? 0 : event.key === "End" ? series.length - 1 : selected + (event.key === "ArrowLeft" ? -1 : 1), true);
        });
      });
      const details = element("details", "activity-chart-data"); details.append(element("summary", "", "Данные по дням"));
      const table = element("table"); const caption = element("caption", "sr-only", "Задачи и привычки за выбранный период");
      const head = element("thead"); const titles = element("tr");
      ["Дата", "Задачи", "Привычки по расписанию"].forEach((label) => { const cell = element("th", "", label); cell.scope = "col"; titles.append(cell); }); head.append(titles);
      const body = element("tbody");
      [...series].reverse().forEach((point) => { const row = element("tr"); const date = element("th", "", ctx.formatShortDate(point.date)); date.scope = "row";
        row.append(date, element("td", "", point.taskTotal ? `${point.taskDone} / ${point.taskTotal} · ${point.taskPercent}%` : "—"), element("td", "", point.habitTotal ? `${point.habitDone} / ${point.habitTotal} · ${point.habitPercent}%` : "—")); body.append(row); });
      table.append(caption, head, body); details.append(table); root.append(details);
    }
    return { render, getDates: () => buildActivitySeries({ endDate: ctx.getActiveDate(), days, today: ctx.toDateKey(new Date()), ...ctx }).map((point) => point.date) };
  }
  const api = { buildActivitySeries, createActivityCharts };
  global.RhythmActivityCharts = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
