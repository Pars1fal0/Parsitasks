(function (global) {
  function createRemoteDataController(ctx) {
    let busy = false;
    let previewRequestId = 0;
    const captureOwner = () => {
      const config = ctx.getConfig();
      return { userId: config.userId, supabaseUrl: config.supabaseUrl };
    };
    const isOwner = (owner) => {
      const current = captureOwner();
      return ctx.isReady() && current.userId === owner.userId && current.supabaseUrl === owner.supabaseUrl;
    };
    let displayedOwner = captureOwner();

    function bindEvents() {
      ctx.els.remoteSnapshotsLoadButton?.addEventListener("click", loadSnapshots);
      ctx.els.remoteSnapshotRestoreButton?.addEventListener("click", restoreSelectedSnapshot);
      ctx.els.remoteAccountDeleteButton?.addEventListener("click", deleteAccount);
      ctx.els.remoteSnapshotSelect?.addEventListener("change", () => {
        syncControls();
        previewSelectedSnapshot();
      });
      syncControls();
      renderSnapshotPreview();
    }

    async function loadSnapshots() {
      if (!ctx.isReady()) return ctx.showToast("Сначала войди в аккаунт синхронизации");
      if (busy) return;
      const owner = captureOwner();
      setBusy(true, "Загружаю версии...");
      try {
        const result = await ctx.remoteSync.listSnapshots(ctx.getConfig(), 30);
        if (!isOwner(owner)) return;
        renderSnapshots(result.snapshots);
        setStatus(result.snapshots.length ? `Доступно версий: ${result.snapshots.length}` : "Предыдущих версий пока нет");
      } catch (error) {
        if (isOwner(owner)) setStatus(schemaHint(error));
      } finally {
        setBusy(false);
      }
    }

    async function restoreSelectedSnapshot() {
      const snapshotId = ctx.els.remoteSnapshotSelect?.value;
      if (!snapshotId || busy || !ctx.isReady()) return ctx.showToast("Сначала выбери облачную версию");
      const owner = captureOwner();
      const confirmed = await ctx.confirmAction({
        confirmLabel: "Восстановить версию",
        message: "Текущее облачное состояние сохранится как отдельная версия. Локальный safety backup будет создан перед восстановлением.",
        tone: "danger",
        title: "Восстановить облачную версию?",
      });
      if (!confirmed || !isOwner(owner) || busy) return;
      setBusy(true, "Восстанавливаю версию...");
      let cloudRestored = false;
      let localRestored = false;
      try {
        const undo = ctx.createUndoSnapshot();
        const backup = ctx.createImportSafetyBackup({ state: JSON.stringify(ctx.getState()) });
        if (backup?.ok === false) throw new Error("Не удалось создать safety backup");
        const result = await ctx.remoteSync.restoreSnapshot(ctx.getConfig(), snapshotId);
        if (!isOwner(owner)) return;
        cloudRestored = true;
        const previous = ctx.getState();
        ctx.replaceState(result.snapshot.state);
        try {
          if (ctx.saveState({ skipBackup: true, skipRemote: true }) === false) throw new Error("Не удалось сохранить восстановленную версию на устройстве");
        } catch (error) {
          ctx.replaceState(previous);
          ctx.render();
          throw error;
        }
        await ctx.afterSnapshotRestored?.(result);
        if (!isOwner(owner)) return;
        localRestored = true;
        ctx.render();
        ctx.showToast("Облачная версия восстановлена", { undo });
        const versions = await ctx.remoteSync.listSnapshots(ctx.getConfig(), 30);
        if (!isOwner(owner)) return;
        renderSnapshots(versions.snapshots);
        setStatus(`Версия восстановлена · доступно версий: ${versions.snapshots.length}`);
      } catch (error) {
        if (!isOwner(owner)) return;
        const message = localRestored ? "Версия восстановлена, но список облачных копий не обновился. Повтори загрузку списка"
          : cloudRestored ? "Облако восстановлено, но локальную копию записать не удалось. Экспортируй текущие данные и повтори загрузку из облака"
            : "Не удалось восстановить облачную версию";
        setStatus(`${message} · ${schemaHint(error)}`);
        ctx.showToast(message);
      } finally {
        setBusy(false);
      }
    }

    async function previewSelectedSnapshot() {
      const snapshotId = ctx.els.remoteSnapshotSelect?.value;
      const requestId = ++previewRequestId;
      if (!snapshotId || !ctx.isReady()) return renderSnapshotPreview();
      const owner = captureOwner();
      renderSnapshotPreview({ loading: true });
      try {
        const result = await ctx.remoteSync.getSnapshot(ctx.getConfig(), snapshotId);
        if (requestId !== previewRequestId || !isOwner(owner)) return;
        renderSnapshotPreview({ snapshot: result.snapshot });
      } catch (error) {
        if (requestId !== previewRequestId || !isOwner(owner)) return;
        renderSnapshotPreview({ error: schemaHint(error) });
      }
    }

    async function deleteAccount() {
      if (!ctx.isReady() || busy) return ctx.showToast("Сначала войди в аккаунт синхронизации");
      const owner = captureOwner();
      const verificationText = ctx.getUserEmail() || "УДАЛИТЬ";
      const confirmed = await ctx.confirmAction({
        confirmLabel: "Удалить аккаунт",
        message: "Аккаунт, облачное состояние и все серверные версии будут удалены без возможности восстановления. Локальные данные на этом устройстве останутся.",
        tone: "danger",
        title: "Удалить аккаунт и облачные данные?",
        verificationLabel: ctx.getUserEmail()
          ? "Введи email аккаунта для подтверждения"
          : 'Введи "УДАЛИТЬ" для подтверждения',
        verificationText,
      });
      if (!confirmed || !isOwner(owner) || busy) return;
      setBusy(true, "Удаляю аккаунт...");
      try {
        await ctx.remoteSync.deleteAccount(ctx.getConfig());
        if (!isOwner(owner)) return;
        await ctx.afterAccountDeleted();
        renderSnapshots([]);
        setStatus("Облачный аккаунт удалён. Локальные данные сохранены.");
        ctx.showToast("Аккаунт и облачные данные удалены");
      } catch (error) {
        if (!isOwner(owner)) return;
        setStatus(schemaHint(error));
        ctx.showToast("Не удалось удалить облачный аккаунт");
      } finally {
        setBusy(false);
      }
    }

    function renderSnapshots(snapshots) {
      previewRequestId += 1;
      const select = ctx.els.remoteSnapshotSelect;
      if (!select) return;
      select.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = snapshots.length ? "Выбери версию" : "Нет доступных версий";
      select.appendChild(placeholder);
      snapshots.forEach((snapshot) => {
        const option = document.createElement("option");
        option.value = String(snapshot.id);
        option.textContent = formatSnapshotLabel(snapshot);
        select.appendChild(option);
      });
      if (ctx.els.remoteSnapshotRestoreButton) ctx.els.remoteSnapshotRestoreButton.disabled = true;
      renderSnapshotPreview();
    }

    function renderSnapshotPreview({ error = "", loading = false, snapshot = null } = {}) {
      const container = ctx.els.remoteSnapshotPreview;
      if (!container) return;
      container.replaceChildren();
      container.classList.remove("is-error");
      container.hidden = !error && !loading && !snapshot;
      if (container.hidden) return;

      const title = document.createElement("strong");
      title.textContent = loading ? "Загружаю содержимое версии..." : error ? "Предпросмотр недоступен" : "Что находится в этой версии";
      container.appendChild(title);
      if (loading) return;

      const detail = document.createElement("small");
      if (error) {
        detail.textContent = error;
        container.classList.add("is-error");
        container.appendChild(detail);
        return;
      }

      container.classList.remove("is-error");
      const summary = summarizeSnapshotState(snapshot?.state);
      detail.textContent = [
        snapshot?.created_at ? ctx.formatDate(snapshot.created_at) : "",
        ...snapshotSummaryParts({ ...summary.counts, ...(snapshot?.summary || {}) }),
      ].filter(Boolean).join(" · ");
      container.appendChild(detail);

      if (summary.examples.length) {
        const examples = document.createElement("p");
        examples.textContent = `Примеры: ${summary.examples.join(", ")}`;
        container.appendChild(examples);
      }
    }

    function formatSnapshotLabel(snapshot) {
      const counts = snapshotSummaryParts(snapshot?.summary);
      return [ctx.formatDate(snapshot.created_at), counts.join(" · ")].filter(Boolean).join(" · ");
    }

    function setBusy(value, message = "") {
      busy = value;
      syncControls();
      if (message) setStatus(message);
    }

    function syncControls() {
      const owner = captureOwner();
      if (owner.userId !== displayedOwner.userId || owner.supabaseUrl !== displayedOwner.supabaseUrl) {
        displayedOwner = owner;
        previewRequestId += 1;
        renderSnapshots([]);
        renderSnapshotPreview();
        setStatus("История версий ещё не загружена");
      }
      const unavailable = busy || !ctx.isReady();
      if (ctx.els.remoteSnapshotsLoadButton) ctx.els.remoteSnapshotsLoadButton.disabled = unavailable;
      if (ctx.els.remoteAccountDeleteButton) ctx.els.remoteAccountDeleteButton.disabled = unavailable;
      if (ctx.els.remoteSnapshotSelect) ctx.els.remoteSnapshotSelect.disabled = unavailable;
      if (ctx.els.remoteSnapshotRestoreButton) {
        ctx.els.remoteSnapshotRestoreButton.disabled = unavailable || !ctx.els.remoteSnapshotSelect?.value;
      }
    }

    function setStatus(message) {
      if (ctx.els.remoteSnapshotsStatus) ctx.els.remoteSnapshotsStatus.textContent = message;
    }

    function schemaHint(error) {
      const text = String(error?.message || "");
      return /rhythm_state_snapshots|delete_parsitasks_account|404|PGRST/i.test(text)
        ? "Обнови database/supabase-schema.sql в SQL Editor, затем повтори действие"
        : `Ошибка облачных данных: ${text || "неизвестная ошибка"}`;
    }

    return { bindEvents, deleteAccount, loadSnapshots, previewSelectedSnapshot, restoreSelectedSnapshot, syncControls };
  }

  function snapshotSummaryParts(summary = {}) {
    return [
      Number.isFinite(Number(summary.tasks)) ? `${Number(summary.tasks)} задач` : "",
      Number.isFinite(Number(summary.habits)) ? `${Number(summary.habits)} привычек` : "",
      Number.isFinite(Number(summary.goals)) ? `${Number(summary.goals)} целей` : "",
      Number.isFinite(Number(summary.boardItems)) ? `${Number(summary.boardItems)} элементов доски` : "",
      Number.isFinite(Number(summary.journalEntries)) ? `${Number(summary.journalEntries)} записей дневника` : "",
      Number.isFinite(Number(summary.nutritionMeals)) ? `${Number(summary.nutritionMeals)} блюд` : "",
    ].filter(Boolean);
  }

  function summarizeSnapshotState(state = {}) {
    const groups = [
      ["tasks", "title"],
      ["habits", "title"],
      ["goals", "title"],
      ["notes", "title"],
      ["nutritionMeals", "title"],
      ["boardItems", "text"],
    ];
    const counts = {};
    const examples = [];
    groups.forEach(([key, titleKey]) => {
      const items = Array.isArray(state?.[key]) ? state[key] : [];
      counts[key] = items.length;
      items.forEach((item) => {
        const title = String(item?.[titleKey] || "").trim();
        if (title && examples.length < 3) examples.push(title);
      });
    });
    counts.journalEntries = Array.isArray(state?.journalEntries) ? state.journalEntries.length : 0;
    return { counts, examples };
  }

  const api = { createRemoteDataController, snapshotSummaryParts, summarizeSnapshotState };
  global.RhythmRemoteDataController = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
