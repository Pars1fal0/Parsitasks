(function (global) {
  const PRESETS = {
    basic: ["tasks", "habits", "overview"],
    study: ["tasks", "habits", "overview", "study"],
  };
  const CONTENT_KEYS = ["tasks", "habits", "goals", "notes", "journalEntries", "boardItems", "studySubjects", "studyLessons", "studyFiles", "nutritionMeals", "nutritionFoods", "nutritionTemplates"];
  const COMPLETED_KEY = "workspace-setup-v1";

  function hasWorkspaceContent(state = {}) {
    state ||= {};
    return CONTENT_KEYS.some((key) => Array.isArray(state[key]) && state[key].length > 0);
  }

  function presetPreferences(preset, labels, current) {
    if (!Object.hasOwn(PRESETS, preset)) return current;
    const visible = PRESETS[preset];
    return { hidden: Object.keys(labels).filter((view) => view !== "settings" && !visible.includes(view)), mobile: [...visible] };
  }

  function buildSupportReport(snapshot = {}) {
    snapshot ||= {};
    const sync = snapshot.sync || {};
    const timestamp = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)
      && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
    // Explicit allowlist: account identifiers, free-text errors and workspace data never enter the report.
    return {
      format: "parsitasks-support-v1",
      version: /^\d+\.\d+\.\d+$/.test(snapshot.version || "") ? snapshot.version : "unknown",
      schemaVersion: Number.isInteger(snapshot.schemaVersion) && snapshot.schemaVersion > 0 && snapshot.schemaVersion < 10000 ? snapshot.schemaVersion : null,
      platform: snapshot.desktop === true ? "desktop" : "web",
      online: snapshot.online === true,
      localSaveError: snapshot.localSaveError === true,
      storage: {
        bytes: Number.isSafeInteger(snapshot.storage?.bytes) && snapshot.storage.bytes >= 0 ? snapshot.storage.bytes : null,
        durationMs: typeof snapshot.storage?.durationMs === "number" && Number.isFinite(snapshot.storage.durationMs) && snapshot.storage.durationMs >= 0 ? snapshot.storage.durationMs : null,
      },
      sync: {
        projectConfigured: sync.projectConfigured === true,
        authenticated: sync.authenticated === true,
        enabled: sync.enabled === true,
        pending: sync.pending === true,
        inFlight: sync.inFlight === true,
        hasError: Boolean(sync.lastError),
        lastPulledAt: timestamp(sync.lastPulledAt),
        lastPushedAt: timestamp(sync.lastPushedAt),
      },
    };
  }

  function createWorkspaceGuide(ctx) {
    const doc = global.document;
    const banner = doc.querySelector("#workspaceSetupBanner");
    const dialog = doc.querySelector("#workspaceSetupDialog");
    const form = doc.querySelector("#workspaceSetupForm");
    const error = doc.querySelector("#workspaceSetupError");
    const local = global.RhythmWorkspaceLocal.createWorkspaceLocal({ getUserId: ctx.getUserId });
    doc.querySelector("#tasksView .quick-task-disclosure")?.after(banner);
    let openedOwner = "";
    let returnFocus = null;

    function render() {
      banner.hidden = hasWorkspaceContent(ctx.getState()) || local.read(COMPLETED_KEY) === true;
      if (dialog.open && openedOwner !== local.owner()) {
        dialog.close();
        ctx.showToast("Аккаунт изменился. Открой настройку заново");
      }
    }

    function open() {
      if (dialog.open) return;
      openedOwner = local.owner();
      returnFocus = doc.activeElement;
      error.textContent = "";
      form.querySelector('[value="current"]').checked = true;
      dialog.showModal();
    }

    function complete() {
      const saved = local.write(COMPLETED_KEY, true);
      render();
      if (!saved) ctx.showToast("Не удалось сохранить отметку настройки. Проверь свободное место в браузере");
      return saved;
    }

    function previewReport() {
      const report = JSON.stringify(buildSupportReport(ctx.getSupportSnapshot()), null, 2);
      const preview = doc.querySelector("#supportReportPreview");
      preview.value = report;
      const details = doc.querySelector("#supportReportDetails");
      details.hidden = false;
      details.open = true;
      return report;
    }

    function bindEvents() {
      doc.querySelectorAll("[data-workspace-setup]").forEach((button) => button.addEventListener("click", open));
      doc.querySelector("#workspaceSetupDismiss").addEventListener("click", complete);
      doc.querySelector("#workspaceSetupClose").addEventListener("click", () => dialog.close());
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); dialog.close(); });
      dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dialog.close(); }
      });
      dialog.addEventListener("close", () => {
        if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
        else doc.querySelector('#tasksView #quickTaskInput')?.focus({ preventScroll: true });
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (openedOwner !== local.owner()) { render(); return; }
        const preset = new FormData(form).get("workspacePreset");
        const prefs = presetPreferences(preset, global.RhythmNavigationPreferences.LABELS, ctx.getPreferences());
        if (preset !== "current" && ctx.applyPreferences(prefs) === false) {
          error.textContent = "Не удалось сохранить настройки. Текущие разделы оставлены без изменений.";
          return;
        }
        complete();
        dialog.close();
      });
      doc.querySelector("#supportPreviewButton").addEventListener("click", previewReport);
      doc.querySelector("#supportDownloadButton").addEventListener("click", () => {
        const report = previewReport();
        const blob = new Blob([report], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = doc.createElement("a");
        anchor.href = url; anchor.download = "parsitasks-diagnostics.json";
        doc.body.append(anchor); anchor.click(); anchor.remove();
        global.setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      doc.querySelector("#helpSyncButton").addEventListener("click", () => {
        const heading = doc.querySelector("#syncSettingsHeading");
        heading.closest("details").open = true;
        heading.closest(".settings-primary-group").open = true;
        heading.scrollIntoView({ block: "start", behavior: "auto" });
        doc.querySelector("#remoteSyncCheckButton").focus({ preventScroll: true });
      });
      doc.querySelector("#helpNavigationButton").addEventListener("click", () => {
        const heading = doc.querySelector("#navigationSettingsHeading");
        heading.closest("details").open = true;
        heading.closest(".settings-primary-group").open = true;
        heading.scrollIntoView({ block: "start", behavior: "auto" });
        doc.querySelector("#navigationPreferences input")?.focus({ preventScroll: true });
      });
      render();
    }

    return { bindEvents, open, render };
  }

  const api = { buildSupportReport, createWorkspaceGuide, hasWorkspaceContent, presetPreferences };
  global.RhythmWorkspaceGuide = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
