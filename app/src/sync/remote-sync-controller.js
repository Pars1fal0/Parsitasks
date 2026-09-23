(function (global) {
  function createRemoteSyncWorkflow(ctx) {
    let inFlight = false;
    let lastError = "";
    let pending = ctx.getSyncMeta?.().pending === true;
    let pendingVersion = pending ? 1 : 0;
    let queuedPush = false;
    let timerId = null;

    function getConfig() {
      const settings = ctx.getSettings();
      return ctx.remoteSync.normalizeConfig({
        anonKey: settings.anonKey,
        accessToken: settings.accessToken,
        enabled: settings.enabled,
        supabaseUrl: settings.supabaseUrl,
        userId: settings.userId,
      });
    }

    function isReady() {
      return ctx.remoteSync.isConfigured(getConfig());
    }

    function hasCredentials() {
      return ctx.remoteSync.isConfigured({ ...getConfig(), enabled: true });
    }

    function getOperationConfig() {
      return { ...getConfig(), enabled: true };
    }

    function clearError() {
      lastError = "";
    }

    function resetQueue() {
      if (timerId) clearTimeout(timerId);
      timerId = null;
      queuedPush = false;
      pendingVersion += 1;
      setPending(false);
      clearError();
    }

    function renderStatus() {
      if (!ctx.statusElement) return;
      const settings = ctx.getSettings();
      syncActionState();
      if (!hasCredentials()) return setStatus("БД: не настроено · войди в аккаунт");
      if (!settings.enabled) return setStatus("БД: подключение готово · автоматическая синхронизация выключена");
      if (lastError) return setStatus(`БД: ошибка · ${lastError}`);
      if (inFlight) return setStatus("БД: синхронизация...");
      if (pending) return setStatus("БД: ожидает синхронизации локальных изменений");
      const meta = ctx.getSyncMeta();
      const pushed = meta.lastPushedAt ? ctx.formatDate(meta.lastPushedAt) : "еще не сохранялось";
      const pulled = meta.lastPulledAt ? ctx.formatDate(meta.lastPulledAt) : "еще не загружалось";
      const latestSync = ctx.latestIsoDate(meta.lastPushedAt, meta.lastPulledAt);
      const latest = latestSync ? ctx.formatDate(latestSync) : "еще не было";
      setStatus(`БД: подключена · последняя синхронизация: ${latest} · сохранено: ${pushed} · загружено: ${pulled}`);
    }

    function schedulePush() {
      pendingVersion += 1;
      setPending(true);
      if (!isReady()) return renderStatus();
      renderStatus();
      queuePush();
    }

    function queuePush(delay = 1200) {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => {
        timerId = null;
        push({ silent: true });
      }, delay);
    }

    async function push(options = {}) {
      options?.preventDefault?.();
      const manual = !options?.silent;
      if (!hasCredentials()) {
        renderStatus();
        if (manual) ctx.showToast("Заполни настройки удаленной БД");
        return;
      }
      if (inFlight) {
        queuedPush = true;
        return { queued: true };
      }
      const pushVersion = pendingVersion;
      begin();
      try {
        let mergedRemote = false;
        let pushed;
        let pushedAt;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const preparation = await prepareRemotePush();
          mergedRemote ||= preparation.merged;
          pushedAt = new Date().toISOString();
          try {
            pushed = await ctx.remoteSync.pushState(getOperationConfig(), {
              clientUpdatedAt: pushedAt,
              expectMissing: preparation.expectMissing,
              expectedUpdatedAt: preparation.expectedUpdatedAt,
              schemaVersion: ctx.schemaVersion,
              state: ctx.getState(),
              uiState: ctx.getRemoteUiSettings({ remoteSyncLastPushedAt: pushedAt }),
            });
            break;
          } catch (error) {
            if (error?.code !== "sync-conflict" || attempt > 0) throw error;
          }
        }
        ctx.setSyncMeta({ lastPushedAt: snapshotVersion(pushed) || pushedAt });
        if (pendingVersion === pushVersion) setPending(false);
        else queuedPush = true;
        ctx.recordSyncEvent?.("push");
        if (manual) ctx.showToast(mergedRemote ? "Данные устройств объединены и сохранены" : "Данные сохранены в БД");
      } catch (error) {
        lastError = ctx.describeError(error);
        ctx.recordSyncEvent?.("error", lastError);
        if (manual) ctx.showToast("Не удалось сохранить данные в БД");
      } finally {
        finish();
      }
    }

    async function prepareRemotePush() {
      const remoteSnapshot = await ctx.remoteSync.pullState(getOperationConfig());
      const meta = ctx.getSyncMeta();
      const remoteVersion = snapshotVersion(remoteSnapshot);
      if (!remoteSnapshot.found || !remoteSnapshot.state) return { expectMissing: true, expectedUpdatedAt: "", merged: false };
      const shouldMerge = remoteVersion && ctx.isRemoteVersionNewer(remoteVersion, meta.lastPulledAt, meta.lastPushedAt);
      if (shouldMerge) applyMergedSnapshot(remoteSnapshot, "перед отправкой локальных изменений");
      return {
        expectMissing: false,
        expectedUpdatedAt: remoteSnapshot.updatedAt || remoteSnapshot.row?.updated_at || "",
        merged: Boolean(shouldMerge),
      };
    }

    async function check(options = {}) {
      options?.preventDefault?.();
      if (!hasCredentials()) {
        renderStatus();
        ctx.showToast("Заполни настройки удаленной БД");
        return { ok: false, reason: "not-configured" };
      }
      if (inFlight) return { ok: false, reason: "busy" };
      begin();
      try {
        const result = await ctx.remoteSync.checkConnection(getOperationConfig());
        ctx.showToast(result.found ? "Подключение к БД работает" : "Подключение работает, сохранений пока нет");
        return { ...result, ok: true };
      } catch (error) {
        lastError = ctx.describeError(error);
        ctx.showToast("Подключение к БД не прошло проверку");
        return { error, ok: false };
      } finally {
        finish();
      }
    }

    async function pull(options = {}) {
      options?.preventDefault?.();
      if (!hasCredentials()) {
        renderStatus();
        ctx.showToast("Заполни настройки удаленной БД");
        return;
      }
      if (inFlight) return;
      begin();
      let pulled;
      try {
        pulled = await ctx.remoteSync.pullState(getOperationConfig());
      } catch (error) {
        lastError = ctx.describeError(error);
        ctx.showToast("Не удалось загрузить данные из БД");
        finish();
        return;
      }
      finish();
      if (!pulled.found || !pulled.state) {
        ctx.showToast("В БД пока нет сохраненных данных");
        return;
      }
      const remoteVersion = snapshotVersion(pulled);
      const remoteDate = remoteVersion ? ctx.formatDate(remoteVersion) : "неизвестно";
      const localUpdatedAt = ctx.getLocalUpdatedAt();
      const localWarning =
        localUpdatedAt && pulled.clientUpdatedAt && localUpdatedAt > pulled.clientUpdatedAt
          ? ` Локальные данные новее удаленной версии (${ctx.formatDate(localUpdatedAt)}).`
          : "";
      const confirmed = await ctx.confirmAction({
        confirmLabel: "Заменить локальные",
        secondaryLabel: "Объединить",
        message: `Данные из БД от ${remoteDate}.${localWarning} Можно объединить записи с двух устройств или полностью заменить локальное состояние. Перед действием приложение создаст safety backup.`,
        tone: "danger",
        title: "Как загрузить данные из БД?",
      });
      if (!confirmed || inFlight) return;
      begin();
      try {
        const undo = ctx.createUndoSnapshot();
        const safetyBackup = ctx.createImportSafetyBackup({ state: JSON.stringify(ctx.getState()) });
        if (safetyBackup?.ok === false) throw new Error("safety-backup-failed");
        const nextState = confirmed === "secondary" ? ctx.mergeStates(ctx.getState(), pulled.state) : pulled.state;
        ctx.replaceState(nextState);
        const pulledAt = new Date().toISOString();
        ctx.setSyncMeta({ lastPulledAt: remoteVersion || pulledAt });
        setPending(false);
        ctx.saveState({
          localUpdatedAt: ctx.latestIsoDate(localUpdatedAt, pulled.clientUpdatedAt, pulledAt),
          skipBackup: true,
          skipChangeTracking: true,
          skipRemote: true,
        });
        ctx.saveUiState();
        ctx.render();
        ctx.recordSyncEvent?.(confirmed === "secondary" ? "merge" : "pull", `версия от ${remoteDate}`);
        ctx.showToast(confirmed === "secondary" ? "Локальные и удаленные данные объединены" : "Данные загружены из БД", { undo });
      } catch (error) {
        lastError = ctx.describeError(error);
        ctx.recordSyncEvent?.("error", lastError);
        ctx.showToast("Не удалось загрузить данные из БД");
      } finally {
        finish();
      }
    }

    async function syncLatest(options = {}) {
      if (!isReady() || inFlight || global.navigator?.onLine === false) return { changed: false };
      begin();
      try {
        const pulled = await ctx.remoteSync.pullState(getConfig());
        if (!pulled.found || !pulled.state) return { changed: false };
        const meta = ctx.getSyncMeta();
        if (!ctx.isRemoteVersionNewer(snapshotVersion(pulled), meta.lastPulledAt, meta.lastPushedAt)) return { changed: false };
        const undo = applyMergedSnapshot(pulled, "автоматическая синхронизация");
        if (!options.silent) ctx.showToast("Данные с другого устройства объединены", { undo });
        global.setTimeout(() => schedulePush(), 0);
        return { changed: true };
      } catch (error) {
        lastError = ctx.describeError(error);
        ctx.recordSyncEvent?.("error", lastError);
        if (!options.silent) ctx.showToast("Не удалось синхронизировать данные");
        return { changed: false, error };
      } finally {
        finish();
      }
    }

    function applyMergedSnapshot(pulled, detail) {
      const undo = ctx.createUndoSnapshot();
      const safetyBackup = ctx.createImportSafetyBackup(undo);
      if (safetyBackup?.ok === false) throw new Error("safety-backup-failed");
      ctx.replaceState(ctx.mergeStates(ctx.getState(), pulled.state));
      const pulledAt = new Date().toISOString();
      ctx.setSyncMeta({ lastPulledAt: snapshotVersion(pulled) || pulledAt });
      setPending(false);
      ctx.saveState({
        localUpdatedAt: ctx.latestIsoDate(ctx.getLocalUpdatedAt(), pulled.clientUpdatedAt, pulledAt),
        skipBackup: true,
        skipChangeTracking: true,
        skipRemote: true,
      });
      ctx.saveUiState();
      ctx.render();
      ctx.recordSyncEvent?.("merge", detail);
      return undo;
    }

    function snapshotVersion(snapshot) {
      return snapshot?.updatedAt || snapshot?.row?.updated_at || snapshot?.clientUpdatedAt || "";
    }

    async function resumePending() {
      if (!pending || !isReady() || global.navigator?.onLine === false) return { resumed: false };
      const syncResult = await syncLatest({ silent: true });
      if (pending) await push({ silent: true });
      return { resumed: true, syncResult };
    }

    function setPending(value) {
      pending = value === true;
      ctx.setSyncMeta?.({ pending });
      ctx.saveUiState?.();
    }

    function begin() {
      inFlight = true;
      lastError = "";
      renderStatus();
      ctx.renderSaveStatus?.();
    }

    function finish() {
      inFlight = false;
      ctx.syncControls();
      renderStatus();
      ctx.renderSaveStatus?.();
      if (queuedPush && pending && isReady()) {
        queuedPush = false;
        queuePush(0);
      }
    }

    function setStatus(message) {
      ctx.statusElement.textContent = message;
    }

    function syncActionState() {
      const disabled = !hasCredentials() || inFlight;
      [ctx.els?.remoteSyncPushButton, ctx.els?.remoteSyncPullButton, ctx.els?.remoteSyncCheckButton]
        .filter(Boolean)
        .forEach((button) => { button.disabled = disabled; });
    }

    function getStatus() {
      return { inFlight, lastError, pending };
    }

    return { check, clearError, getConfig, getStatus, isReady, pull, push, renderStatus, resetQueue, resumePending, schedulePush, syncLatest };
  }

  const api = { createRemoteSyncWorkflow };
  global.RhythmRemoteSyncController = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
