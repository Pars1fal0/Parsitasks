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
    await page.locator('#studyLessonForm button[type="submit"]').click();
    const lessonId = await page.locator("[data-study-lesson-edit]").getAttribute("data-study-lesson-edit");
    assert.ok(lessonId);

    await page.locator("[data-study-lesson-edit]").click();
    await page.locator('#studyLessonForm [name="endTime"]').fill("10:00");
    await page.locator('#studyLessonForm button[type="submit"]').click();
    assert.equal(await page.locator("[data-study-lesson-edit]").getAttribute("data-study-lesson-edit"), lessonId);
    assert.match(await page.locator("#studyScheduleList").innerText(), /09:00–10:00/);

    await page.locator("#studyNextWeek").click();
    assert.match(await page.locator("#studyWeekLabel").innerText(), /Нечётная неделя/);
    assert.doesNotMatch(await page.locator("#studyScheduleList").innerText(), /09:00–10:00/);
    await page.locator('#studyLessonForm [name="subjectId"]').selectOption(subjectId);
    await page.locator('#studyLessonForm [name="weekday"]').selectOption("1");
    await page.locator('#studyLessonForm [name="weekType"]').selectOption("odd");
    await page.locator('#studyLessonForm [name="startTime"]').fill("11:00");
    await page.locator('#studyLessonForm [name="endTime"]').fill("11:45");
    await page.locator('#studyLessonForm button[type="submit"]').click();
    assert.match(await page.locator("#studyScheduleList").innerText(), /11:00–11:45/);
    await page.locator("#studyPreviousWeek").click();
    assert.match(await page.locator("#studyScheduleList").innerText(), /09:00–10:00/);
    assert.doesNotMatch(await page.locator("#studyScheduleList").innerText(), /11:00–11:45/);
    if (process.env.CAPTURE_STUDY) {
      const desktopPath = path.join(os.tmpdir(), "parsitasks-study-desktop.png");
      const mobilePath = path.join(os.tmpdir(), "parsitasks-study-mobile.png");
      await page.screenshot({ path: desktopPath, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: mobilePath, fullPage: true });
      console.log(`study screenshots: ${desktopPath}, ${mobilePath}`);
    }

    await page.locator('[data-study-tab="homework"]').click();
    await page.locator('#studyHomeworkForm [name="subjectId"]').selectOption(subjectId);
    await page.locator('#studyHomeworkForm [name="title"]').fill("Решить упражнения 4–6");
    await page.locator('#studyHomeworkForm [name="date"]').fill("2026-09-28");
    await page.locator('#studyHomeworkForm button[type="submit"]').click();
    assert.match(await page.locator("#studyHomeworkList").innerText(), /Решить упражнения 4–6/);

    const state = await page.evaluate(() => JSON.parse(localStorage.getItem("rhythm-day-state-v1")));
    assert.equal(state.tasks.find((task) => task.title === "Решить упражнения 4–6").studySubjectId, subjectId);
    await page.locator("#activeDate").fill("2026-09-28");
    await page.locator("#activeDate").dispatchEvent("change");
    await page.locator('.nav-tab[data-view="tasks"]:visible').click();
    assert.match(await page.locator("#tasksView").innerText(), /Решить упражнения 4–6/);
    assert.deepEqual(errors, []);
    console.log("e2e ok - study week parity, lessons, edits, and homework in tasks");
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
