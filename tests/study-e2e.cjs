const assert = require("node:assert/strict");
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
    console.log("e2e ok - study subjects, lessons, edits, and homework in tasks");
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
