(function (global) {
  function createSettingsSync(ctx) {
    function bindEvents() {
      ctx.els.remoteSyncPushButton?.addEventListener("click", ctx.pushRemoteState);
      ctx.els.remoteSyncPullButton?.addEventListener("click", ctx.pullRemoteState);
      ctx.els.remoteSyncCheckButton?.addEventListener("click", ctx.checkRemoteConnection);
      ctx.els.remoteSyncEnabled?.addEventListener("change", () => ctx.updateSetting("remoteSyncEnabled", ctx.els.remoteSyncEnabled.value));
      ctx.els.remoteSyncUrl?.addEventListener("change", () => ctx.updateSetting("remoteSyncUrl", ctx.els.remoteSyncUrl.value));
      ctx.els.remoteSyncAnonKey?.addEventListener("change", () => ctx.updateSetting("remoteSyncAnonKey", ctx.els.remoteSyncAnonKey.value));
    }

    function syncControls(settings = ctx.getSettings()) {
      setValue(ctx.els.remoteSyncEnabled, settings.remoteSyncEnabled);
      setValue(ctx.els.remoteSyncUrl, settings.remoteSyncUrl);
      setValue(ctx.els.remoteSyncAnonKey, settings.remoteSyncAnonKey);
      ctx.renderRemoteSyncStatus?.();
    }

    function setValue(element, value) {
      if (element) element.value = value;
    }

    return { bindEvents, syncControls };
  }

  global.RhythmSettingsSync = { createSettingsSync };
  if (typeof module !== "undefined" && module.exports) module.exports = { createSettingsSync };
})(typeof window !== "undefined" ? window : globalThis);
