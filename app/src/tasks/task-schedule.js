(function (global) {
  function createTaskSchedule(ctx) {
    function getMode() {
      if (ctx.els.taskScheduleNone?.checked) return "none";
      return ctx.els.taskScheduleBlock?.checked ? "block" : "deadline";
    }

    function setMode(mode = "deadline") {
      const isBlock = mode === "block";
      const isNone = mode === "none";
      if (ctx.els.taskScheduleNone) ctx.els.taskScheduleNone.checked = isNone;
      if (ctx.els.taskScheduleDeadline) ctx.els.taskScheduleDeadline.checked = !isBlock && !isNone;
      if (ctx.els.taskScheduleBlock) ctx.els.taskScheduleBlock.checked = isBlock;
    }

    function syncMode() {
      const mode = getMode();
      const isBlock = mode === "block";
      const isNone = mode === "none";
      if (ctx.els.taskDeadlineTimeField) ctx.els.taskDeadlineTimeField.hidden = isBlock || isNone;
      if (ctx.els.taskBlockTimeFields) ctx.els.taskBlockTimeFields.hidden = !isBlock;
      if (ctx.els.taskReminderField) ctx.els.taskReminderField.hidden = isNone;
      ctx.els.taskTime.disabled = isBlock || isNone;
      ctx.els.taskTime.required = !isBlock && !isNone;
      ctx.els.taskStartTime.disabled = !isBlock;
      ctx.els.taskStartTime.required = isBlock;
      ctx.els.taskEndTime.disabled = !isBlock;
      ctx.els.taskEndTime.required = isBlock;
      ctx.els.taskReminder.disabled = isNone;
      if (isNone) ctx.els.taskReminder.value = "none";
      syncPresets();
    }

    function applyPreset(preset = "") {
      if (!preset) {
        setMode("none");
        ctx.els.taskTime.value = "";
        ctx.els.taskStartTime.value = "";
        ctx.els.taskEndTime.value = "";
        ctx.els.taskReminder.value = "none";
        syncMode();
        ctx.els.taskDate.focus();
        return;
      }

      if (getMode() === "none") setMode("deadline");
      if (getMode() === "block") {
        ctx.els.taskStartTime.value = preset;
        ctx.els.taskEndTime.value = ctx.minutesToTime(Math.min(23 * 60 + 59, ctx.timeToMinutes(preset) + 60));
      } else {
        ctx.els.taskTime.value = preset;
      }
      syncMode();
      (getMode() === "block" ? ctx.els.taskStartTime : ctx.els.taskTime).focus();
    }

    function syncPresets() {
      const mode = getMode();
      const time = mode === "none"
        ? ""
        : mode === "block"
          ? ctx.cleanTimeValue(ctx.els.taskStartTime.value)
          : ctx.cleanTimeValue(ctx.els.taskTime.value);
      document.querySelectorAll("[data-time-preset]").forEach((button) => {
        const preset = button.dataset.timePreset || "";
        button.classList.toggle("is-active", preset === time && (preset !== "" || mode === "none"));
      });
    }

    return { applyPreset, getMode, setMode, syncMode, syncPresets };
  }

  const api = { createTaskSchedule };
  global.RhythmTaskSchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
