(function (global) {
  function createSyncDiagnostics(ctx) {
    let lastCheck = null;

    function setConnectionResult(result) {
      lastCheck = {
        at: new Date().toISOString(),
        error: result?.error ? ctx.describeError(result.error) : "",
        found: result?.found === true,
        ok: result?.ok === true,
        reason: result?.reason || "",
      };
      render();
    }

    function render() {
      const container = ctx.container;
      if (!container) return;
      const snapshot = ctx.getSnapshot();
      container.replaceChildren();

      const rows = [
        diagnosticRow("Сеть", snapshot.online ? "Онлайн" : "Нет подключения", snapshot.online ? "ok" : "error"),
        diagnosticRow("Проект", snapshot.projectConfigured ? "Настроен" : "Не настроен", snapshot.projectConfigured ? "ok" : "error"),
        diagnosticRow("Аккаунт", snapshot.authenticated ? snapshot.accountLabel || "Выполнен вход" : "Вход не выполнен", snapshot.authenticated ? "ok" : "error"),
        diagnosticRow("Автосинхронизация", snapshot.enabled ? "Включена" : "Выключена", snapshot.enabled ? "ok" : "muted"),
        diagnosticRow("Локальные изменения", snapshot.pending ? "Ожидают отправки" : "Отправлены", snapshot.pending ? "warning" : "ok"),
      ];

      const latest = latestIsoDate(snapshot.lastPushedAt, snapshot.lastPulledAt);
      rows.push(diagnosticRow("Последний обмен", latest ? ctx.formatDate(latest) : "Ещё не выполнялся", latest ? "muted" : "warning"));

      if (snapshot.inFlight) rows.push(diagnosticRow("Текущая операция", "Синхронизация...", "warning"));
      if (snapshot.lastError) rows.push(diagnosticRow("Последняя ошибка", snapshot.lastError, "error"));
      if (lastCheck) rows.push(connectionCheckRow(lastCheck));

      container.append(...rows);
    }

    function connectionCheckRow(check) {
      if (check.ok) {
        const detail = check.found ? "Подключение работает, данные найдены" : "Подключение работает, облако пока пустое";
        return diagnosticRow("Проверка", `${detail} · ${ctx.formatDate(check.at)}`, "ok");
      }
      const reasons = {
        busy: "Другая операция ещё выполняется",
        "not-configured": "Сначала настрой проект и войди в аккаунт",
      };
      const detail = check.error || reasons[check.reason] || "Не удалось проверить подключение";
      return diagnosticRow("Проверка", `${detail} · ${ctx.formatDate(check.at)}`, "error");
    }

    function diagnosticRow(label, value, tone) {
      const row = document.createElement("div");
      row.className = `sync-diagnostic-row is-${tone}`;
      const marker = document.createElement("span");
      marker.className = "sync-diagnostic-marker";
      marker.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = label;
      const detail = document.createElement("small");
      detail.textContent = value;
      copy.append(title, detail);
      row.append(marker, copy);
      return row;
    }

    return { render, setConnectionResult };
  }

  function latestIsoDate(...values) {
    return values.filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value))).sort().at(-1) || "";
  }

  const api = { createSyncDiagnostics, latestIsoDate };
  global.RhythmSyncDiagnostics = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
