const assert = require("node:assert/strict");
const { createTaskSchedule } = require("../app/src/tasks/task-schedule.js");

module.exports = [
  {
    name: "switches between no-time, deadline, and block task modes",
    fn() {
      const previousDocument = global.document;
      const buttons = ["", "09:00"].map((preset) => ({
        dataset: { timePreset: preset },
        active: false,
        classList: { toggle(_name, active) { this.owner.active = active; }, owner: null },
      }));
      buttons.forEach((button) => {
        button.classList.owner = button;
      });
      global.document = { querySelectorAll: () => buttons };

      const els = {
        taskBlockTimeFields: { hidden: false },
        taskDate: { focus() {} },
        taskDeadlineTimeField: { hidden: false },
        taskEndTime: { value: "15:00" },
        taskReminder: { value: "15" },
        taskReminderField: { hidden: false },
        taskScheduleBlock: { checked: true },
        taskScheduleDeadline: { checked: false },
        taskScheduleNone: { checked: false },
        taskStartTime: { value: "14:00", focus() {} },
        taskTime: { value: "", focus() {} },
      };

      try {
        const schedule = createTaskSchedule({
          cleanTimeValue: (value) => value,
          els,
          minutesToTime: (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
          timeToMinutes: (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)),
        });

        schedule.applyPreset("");
        assert.equal(schedule.getMode(), "none");
        assert.equal(els.taskStartTime.value, "");
        assert.equal(els.taskReminder.value, "none");
        assert.equal(els.taskDeadlineTimeField.hidden, true);
        assert.equal(els.taskBlockTimeFields.hidden, true);
        assert.equal(els.taskReminderField.hidden, true);
        assert.equal(els.taskTime.disabled, true);
        assert.equal(els.taskStartTime.disabled, true);
        assert.equal(buttons[0].active, true);

        schedule.applyPreset("09:00");
        assert.equal(schedule.getMode(), "deadline");
        assert.equal(els.taskTime.value, "09:00");
        assert.equal(els.taskDeadlineTimeField.hidden, false);
        assert.equal(els.taskTime.disabled, false);
        assert.equal(els.taskTime.required, true);
        assert.equal(els.taskStartTime.disabled, true);
        assert.equal(buttons[1].active, true);
      } finally {
        global.document = previousDocument;
      }
    },
  },
];
