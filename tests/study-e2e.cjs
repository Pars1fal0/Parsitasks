const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const app = await electron.launch({
    args: [path.resolve(__dirname, ".."), "--e2e-test"],
    executablePath: require("electron"),
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    await page.waitForSelector("#pageTitle");
    await page.locator('.nav-tab[data-view="study"]:visible').click();
    assert.equal(await page.locator("#studyDriveStatus").isVisible(), false);
    await page.locator('[data-study-tab="materials"]').click();
    assert.equal(await page.locator("#studyDriveStatus").isVisible(), true);
    await page.locator('[data-study-tab="homework"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#studyJumpToHomeworkForm").click();
    await page.waitForFunction(() => document.querySelector("#studyHomeworkForm").getBoundingClientRect().top < innerHeight * 0.5);
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.locator('[data-study-tab="schedule"]').click();

    const currentMonday = await page.evaluate(() => {
      const today = new Date();
      const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      return window.RhythmStudyModel.mondayKey(key);
    });
    await page.locator('#studyWeekCycleForm [name="anchorMonday"]').fill(currentMonday);
    await page.locator('#studyWeekCycleForm [name="anchorParity"]').selectOption("even");
    await page.locator('#studyWeekCycleForm button[type="submit"]').click();
    assert.match(await page.locator("#studyWeekLabel").innerText(), /Чётная неделя/);

    await page.locator('#studySubjectForm [name="name"]').fill("Математика");
    await page.locator('#studySubjectForm [name="teacher"]').fill("Иванова");
    await page.locator('#studySubjectForm button[type="submit"]').click();
    const subjectId = await page.locator("[data-study-subject-edit]").getAttribute("data-study-subject-edit");
    assert.ok(subjectId);

    await page.locator("[data-study-subject-edit]").click();
    assert.equal(await page.locator('#studySubjectForm [name="id"]').inputValue(), subjectId);
    await page.locator('#studySubjectForm [name="name"]').fill("Алгебра");
    await page.locator('#studySubjectForm button[type="submit"]').click();
    assert.equal(await page.locator("[data-study-subject-edit]").getAttribute("data-study-subject-edit"), subjectId);
    assert.match(await page.locator("#studySubjectList").innerText(), /Алгебра.*Иванова/s);

    await page.locator('#studyLessonForm [name="subjectId"]').selectOption(subjectId);
    await page.locator('#studyLessonForm [name="weekday"]').selectOption("1");
    await page.locator('#studyLessonForm [name="weekType"]').selectOption("even");
    await page.locator('#studyLessonForm [name="startTime"]').fill("09:00");
    await page.locator('#studyLessonForm [name="endTime"]').fill("09:45");
    await page.locator('#studyLessonForm [name="lessonType"]').selectOption("lecture");
    await page.locator('#studyLessonForm [name="teacher"]').fill("Петров");
    await page.locator('#studyLessonForm button[type="submit"]').click();
    const lessonId = await page.locator("[data-study-lesson-edit]").getAttribute("data-study-lesson-edit");
    assert.ok(lessonId);

    await page.locator("[data-study-lesson-edit]").click();
    await page.locator('#studyLessonForm [name="endTime"]').fill("10:00");
    await page.locator('#studyLessonForm button[type="submit"]').click();
    assert.equal(await page.locator("[data-study-lesson-edit]").getAttribute("data-study-lesson-edit"), lessonId);
    assert.match(await page.locator("#studyScheduleList").innerText(), /09:00–10:00/);
    assert.match(await page.locator("#studyScheduleList").innerText(), /Лекция.*Петров/s);

    await page.locator("#studyNextWeek").click();
    assert.match(await page.locator("#studyWeekLabel").innerText(), /Нечётная неделя/);
    assert.doesNotMatch(await page.locator("#studyScheduleList").innerText(), /09:00–10:00/);
    await page.locator('#studyLessonForm [name="subjectId"]').selectOption(subjectId);
    await page.locator('#studyLessonForm [name="weekday"]').selectOption("1");
    await page.locator('#studyLessonForm [name="weekType"]').selectOption("odd");
    await page.locator('#studyLessonForm [name="startTime"]').fill("11:00");
    await page.locator('#studyLessonForm [name="endTime"]').fill("11:45");
    await page.locator('#studyLessonForm [name="lessonType"]').selectOption("practice");
    await page.locator('#studyLessonForm button[type="submit"]').click();
    assert.match(await page.locator("#studyScheduleList").innerText(), /11:00–11:45/);
    await page.locator("#studyPreviousWeek").click();
    assert.match(await page.locator("#studyScheduleList").innerText(), /09:00–10:00/);
    assert.doesNotMatch(await page.locator("#studyScheduleList").innerText(), /11:00–11:45/);
    await page.locator('[data-study-schedule-mode="day"]').click();
    assert.equal(await page.locator('[data-study-schedule-mode="day"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#studyNextWeek").getAttribute("aria-label"), "Следующий день");
    assert.match(await page.locator("#studyScheduleList").innerText(), /09:00–10:00/);
    if (process.env.CAPTURE_STUDY) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(os.tmpdir(), "parsitasks-study-day-mobile.png"), fullPage: true });
      await page.setViewportSize({ width: 1200, height: 800 });
    }
    await page.locator("#studyNextWeek").click();
    assert.doesNotMatch(await page.locator("#studyScheduleList").innerText(), /09:00–10:00/);
    const selectedDay = await page.locator("#studyWeekLabel").innerText();
    await page.locator('[data-study-schedule-mode="week"]').click();
    assert.equal(await page.locator('[data-study-schedule-mode="week"]').getAttribute("aria-pressed"), "true");
    assert.match(await page.locator("#studyScheduleList").innerText(), /09:00–10:00/);
    await page.locator('[data-study-schedule-mode="day"]').click();
    assert.equal(await page.locator("#studyWeekLabel").innerText(), selectedDay);
    await page.locator('[data-study-schedule-mode="week"]').click();
    if (process.env.CAPTURE_STUDY) {
      const desktopPath = path.join(os.tmpdir(), "parsitasks-study-desktop.png");
      const mobilePath = path.join(os.tmpdir(), "parsitasks-study-mobile.png");
      await page.screenshot({ path: desktopPath, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: mobilePath, fullPage: true });
      console.log(`study screenshots: ${desktopPath}, ${mobilePath}`);
    }

    await page.locator('[data-study-tab="homework"]').click();
    const nextPractice = await page.evaluate((monday) => {
      const date = new Date(`${monday}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + 7);
      return date.toISOString().slice(0, 10);
    }, currentMonday);
    const dueYesterday = await page.evaluate(() => {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    });
    await page.locator('#studyHomeworkForm [name="subjectId"]').selectOption(subjectId);
    assert.equal(await page.locator('#studyHomeworkForm [name="date"]').inputValue(), nextPractice);
    await page.locator('#studyHomeworkForm [name="title"]').fill("Решить упражнения 4–6");
    await page.locator('#studyHomeworkForm [name="date"]').fill(dueYesterday);
    await page.locator('#studyHomeworkForm button[type="submit"]').click();
    assert.match(await page.locator("#studyHomeworkList").innerText(), /Решить упражнения 4–6/);
    await page.locator('#studyHomeworkList [data-study-check]').click();
    assert.doesNotMatch(await page.locator("#studyHomeworkList").innerText(), /Решить упражнения 4–6/);

    const state = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    assert.equal(state.tasks.find((task) => task.title === "Решить упражнения 4–6").studySubjectId, subjectId);
    assert.equal(state.tasks.find((task) => task.title === "Решить упражнения 4–6").completed[dueYesterday], true);
    await page.locator("#activeDate").fill(dueYesterday);
    await page.locator("#activeDate").dispatchEvent("change");
    await page.locator('.nav-tab[data-view="tasks"]:visible').click();
    assert.match(await page.locator("#tasksView").innerText(), /Решить упражнения 4–6/);
    assert.deepEqual(errors, []);
    console.log("e2e ok - study week parity, lessons, edits, and homework in tasks");
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
