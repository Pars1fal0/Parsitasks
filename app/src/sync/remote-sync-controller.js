(function (global) {
  function createRemoteSyncWorkflow(ctx) {
    let inFlight = false;
    let lastError = "";
    let pending = ctx.getSyncMeta?.().pending === true;
    let pendingVersion = pending ? 1 : 0;
    let queuedPush = false;
    let timerId = null;
    let generation = 0;

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
      return ctx.isWorkspaceReady?.() !== false && ctx.remoteSync.isConfigured(getConfig());
    }

    function hasCredentials() {
      return ctx.isWorkspaceReady?.() !== false && ctx.remoteSync.isConfigured({ ...getConfig(), enabled: true });
    }

    function getOperationConfig() {
      return { ...getConfig(), enabled: true };
    }

    function clearError() {
      lastError = "";
    }

    function resetQueue() {
      generation += 1;
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
      if (ctx.isWorkspaceReady?.() === false) return setStatus("Облако: загружаем данные выбранного аккаунта");
      if (!hasCredentials()) return setStatus("Облако: войди в аккаунт для синхронизации");
      if (!settings.enabled) return setStatus("Облако: автоматическая синхронизация выключена");
      if (lastError) return setStatus(`Облако: ошибка · ${lastError}`);
      if (inFlight) return setStatus("Облако: синхронизация...");
      if (pending) return setStatus("Облако: ожидает отправки локальных изменений");
      const meta = ctx.getSyncMeta();
      const latestSync = ctx.latestIsoDate(meta.lastPushedAt, meta.lastPulledAt);
      const latest = latestSync ? ctx.formatDate(latestSync) : "еще не было";
      setStatus(`Облако: последняя синхронизация · ${latest}`);
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
        if (manual) ctx.showToast("Войди в аккаунт и дождись загрузки его данных");
        return;
      }
      if (inFlight) {
        queuedPush = true;
        return { queued: true };
      }
      const pushVersion = pendingVersion;
      const operation = begin();
      try {
        let mergedRemote = false;
        let pushed;
        let pushedAt;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const preparation = await prepareRemotePush(operation);
          assertCurrent(operation);
          mergedRemote ||= preparation.merged;
          pushedAt = new Date().toISOString();
          if (preparation.unchanged) {
            pushed = { skipped: true, row: { updated_at: preparation.expectedUpdatedAt } };
            break;
          }
          try {
            pushed = await ctx.remoteSync.pushState(getOperationConfig(), {
              clientUpdatedAt: pushedAt,
              expectMissing: preparation.expectMissing,
              expectedUpdatedAt: preparation.expectedUpdatedAt,
              schemaVersion: ctx.schemaVersion,
              state: ctx.getState(),
              uiState: ctx.getRemoteUiSettings({ remoteSyncLastPushedAt: pushedAt }),
            });
            assertCurrent(operation);
            break;
          } catch (error) {
            if (error?.code !== "sync-conflict" || attempt > 0) throw error;
          }
        }
        ctx.setSyncMeta({ lastPushedAt: snapshotVersion(pushed) || pushedAt });
        if (pendingVersion === pushVersion) setPending(false);
        else queuedPush = true;
        if (!pushed?.skipped) ctx.recordSyncEvent?.("push");
        if (manual) ctx.showToast(pushed?.skipped ? "Данные уже синхронизированы" : mergedRemote ? "Данные устройств объединены и сохранены" : "Данные сохранены в БД");
      } catch (error) {
        if (!isCurrent(operation)) return { cancelled: true };
        lastError = ctx.describeError(error);
        ctx.recordSyncEvent?.("error", lastError);
        if (manual) ctx.showToast("Не удалось сохранить данные в БД");
      } finally {
        finish();
      }
    }

    async function prepareRemotePush(operation) {
      assertCurrent(operation);
      const remoteSnapshot = await ctx.remoteSync.pullState(getOperationConfig());
      assertCurrent(operation);
      const meta = ctx.getSyncMeta();
      const remoteVersion = snapshotVersion(remoteSnapshot);
      if (!remoteSnapshot.found || !remoteSnapshot.state) return { expectMissing: true, expectedUpdatedAt: "", merged: false };
      const shouldMerge = remoteVersion && ctx.isRemoteVersionNewer(remoteVersion, meta.lastPulledAt, meta.lastPushedAt);
      if (shouldMerge) applyMergedSnapshot(remoteSnapshot, "перед отправкой локальных изменений");
      return {
        expectMissing: false,
        expectedUpdatedAt: remoteSnapshot.updatedAt || remoteSnapshot.row?.updated_at || "",
        merged: Boolean(shouldMerge),
        unchanged: Boolean(ctx.statesEqual?.(ctx.getState(), remoteSnapshot.state)) && Object.keys(remoteSnapshot.uiState || {}).length === 0,
      };
    }

    async function check(options = {}) {
      options?.preventDefault?.();
      if (!hasCredentials()) {
        renderStatus();
        ctx.showToast("Войди в аккаунт и дождись загрузки его данных");
        return { ok: false, reason: "not-configured" };
      }
      if (inFlight) return { ok: false, reason: "busy" };
      const operation = begin();
      try {
        const result = await ctx.remoteSync.checkConnection(getOperationConfig());
        assertCurrent(operation);
        ctx.showToast(result.found ? "Подключение к БД работает" : "Подключение работает, сохранений пока нет");
        return { ...result, ok: true };
      } catch (error) {
        if (!isCurrent(operation)) return { ok: false, cancelled: true };
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
        ctx.showToast("Войди в аккаунт и дождись загрузки его данных");
        return;
      }
      if (inFlight) return;
      const operation = begin();
      try {
        const pulled = await ctx.remoteSync.pullState(getOperationConfig());
        assertCurrent(operation);
        if (!pulled.found || !pulled.state) {
          ctx.showToast("В облаке пока нет сохраненных данных");
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
          message: `Данные из облака от ${remoteDate}.${localWarning} Можно объединить записи с двух устройств или полностью заменить локальное состояние. Перед действием сохранится резервная копия.`,
          tone: "danger",
          title: "Как загрузить данные из облака?",
        });
        assertCurrent(operation);
        if (!confirmed) return;
        if (confirmed !== "secondary" && localUpdatedAt !== ctx.getLocalUpdatedAt()) {
          ctx.showToast("Локальные данные изменились. Открой загрузку заново или выбери объединение");
          return;
        }
        const undo = ctx.createUndoSnapshot();
        const safetyBackup = ctx.createImportSafetyBackup({ state: JSON.stringify(ctx.getState()) });
        if (safetyBackup?.ok === false) throw new Error("safety-backup-failed");
        const nextState = confirmed === "secondary" ? ctx.mergeStates(ctx.getState(), pulled.state) : pulled.state;
        const pulledAt = new Date().toISOString();
        persistReplacement(nextState, {
          localUpdatedAt: ctx.latestIsoDate(localUpdatedAt, pulled.clientUpdatedAt, pulledAt),
          skipBackup: true,
          skipChangeTracking: true,
          skipRemote: true,
        });
        ctx.setSyncMeta({ lastPulledAt: remoteVersion || pulledAt });
        setPending(confirmed === "secondary");
        if (confirmed === "secondary") queuedPush = true;
        ctx.saveUiState();
        ctx.render();
        ctx.recordSyncEvent?.(confirmed === "secondary" ? "merge" : "pull", `версия от ${remoteDate}`);
        ctx.showToast(confirmed === "secondary" ? "Локальные и удаленные данные объединены" : "Данные загружены из БД", { undo });
      } catch (error) {
        if (!isCurrent(operation)) return { cancelled: true };
        lastError = ctx.describeError(error);
        ctx.recordSyncEvent?.("error", lastError);
        ctx.showToast("Не удалось загрузить данные из БД");
      } finally {
        finish();
      }
    }

    async function syncLatest(options = {}) {
      if (!isReady() || inFlight || global.navigator?.onLine === false) return { changed: false };
      const operation = begin();
      try {
        const pulled = await ctx.remoteSync.pullState(getConfig());
        assertCurrent(operation);
        if (!pulled.found || !pulled.state) return { changed: false };
        const meta = ctx.getSyncMeta();
        if (!ctx.isRemoteVersionNewer(snapshotVersion(pulled), meta.lastPulledAt, meta.lastPushedAt)) return { changed: false };
        const undo = applyMergedSnapshot(pulled, "автоматическая синхронизация");
        if (!options.silent) ctx.showToast("Данные с другого устройства объединены", { undo });
        queuedPush = true;
        return { changed: true };
      } catch (error) {
        if (!isCurrent(operation)) return { changed: false, cancelled: true };
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
      const pulledAt = new Date().toISOString();
      persistReplacement(ctx.mergeStates(ctx.getState(), pulled.state), {
        localUpdatedAt: ctx.latestIsoDate(ctx.getLocalUpdatedAt(), pulled.clientUpdatedAt, pulledAt),
        skipBackup: true,
        skipChangeTracking: true,
        skipRemote: true,
      });
      ctx.setSyncMeta({ lastPulledAt: snapshotVersion(pulled) || pulledAt });
      setPending(true);
      ctx.saveUiState();
      ctx.render();
      ctx.recordSyncEvent?.("merge", detail);
      return undo;
    }

    function persistReplacement(nextState, options) {
      const previous = ctx.getState();
      ctx.replaceState(nextState);
      try {
        if (ctx.saveState(options) === false) throw Object.assign(new Error("Не удалось сохранить данные на устройстве"), { code: "local-save-failed" });
      } catch (error) {
        ctx.replaceState(previous);
        ctx.render();
        throw error;
      }
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
      return { generation, config: getOperationConfig() };
    }

    function isCurrent(operation) {
      const current = getOperationConfig();
      return operation.generation === generation && current.userId === operation.config.userId
        && current.supabaseUrl === operation.config.supabaseUrl;
    }

    function assertCurrent(operation) {
      if (!isCurrent(operation)) throw Object.assign(new Error("Аккаунт синхронизации изменился"), { code: "sync-cancelled" });
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
