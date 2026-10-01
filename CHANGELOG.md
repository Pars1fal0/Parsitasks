# Changelog

## 0.33.1

- Подготовлен выключенный по умолчанию защищённый путь веб-публикации: успешный Windows CI создаёт готовый артефакт, deploy job проверяет Git SHA, чистоту исходников, контрольные суммы файлов и отдельно переданную сумму манифеста, затем публикует без пересборки.
- Для публикации нужны настройка `production`, Cloudflare-секреты и явный флаг repository variable; pull request и другие ветки не получают доступ к деплою. Старый автодеплой Cloudflare нужно отключить отдельно.
- Добавлена лёгкая анонимная проверка публичных страниц, релиза, конфигурации и границы MCP, включая таймаут чтения тела ответа. Часовой workflow мониторинга требует отдельного включения и не использует аккаунты.
- Обработчики ошибок Worker и Google OAuth не логируют исходные исключения, URL, токены и тело запроса. Вместо них сохраняется короткое событие с непрозрачным `requestId`; ответ содержит `X-Request-ID`.
- Добавлены регрессионные проверки подмены артефакта и манифеста, смешанной сборки, грязного checkout, отказов мониторинга и приватности OAuth-логов. Описаны включение, границы мониторинга и ручной откат.
- Выпуск, monitoring и изменения панелей production этим этапом не выполнялись.

## 0.33.0

- Пустое пространство предлагает необязательную настройку разделов: задачи и привычки, учёба и дела или сохранение текущей навигации. Пропуск запоминается отдельно для каждого аккаунта на устройстве; записи не создаются и не удаляются.
- В настройках появился отдельный раздел «Помощь»: разбор незавершённых дел, день подготовки и срок сдачи, синхронизация, границы JSON-копий и фоновые напоминания.
- Диагностика доступна для предварительного просмотра и скачивания. Строгий список полей исключает тексты задач и заметок, адреса аккаунтов и проектов, ключи, токены и свободный текст ошибок; автоматической отправки нет.
- При отказе сохранения навигация откатывается к предыдущему набору разделов, окно настройки остаётся открытым для повторной попытки.
- Облачные проверки требуют явной отметки выбора временных тестовых аккаунтов; пример security-проверки больше не включает создание доказательной задачи по умолчанию.
- Добавлены проверки приватности и изоляции отметки первого запуска, изолированный UI-сценарий настройки, реального скачивания диагностики и доступности на экранах 320/390/1440 px.
- Этот этап подготовлен локально; питание и portable не изменяются.

## 0.32.1

- Ответы синхронизации, предпросмотра, восстановления и удаления аккаунта проверяют владельца операции; смена аккаунта и сброс очереди отменяют обработку устаревшего ответа.
- Отправка данных блокируется, пока загружается пространство другого аккаунта. Объединение с облаком сохраняется локально до обновления отметок синхронизации; отказ записи откатывает состояние.
- Ручное объединение не теряет очередь отправки, а замена из облака отменяется, если за время подтверждения пользователь изменил локальные данные.
- Запросы входа и синхронизации имеют ограничение времени, включая чтение ответа. Обновления сессии объединяются в один запрос; временная ошибка сервера не завершает действующую сессию.
- Поздний ответ входа, обновления или проверки сессии не возвращает пользователя в старый аккаунт после выхода или нового входа.
- Локальное восстановление проверяет результат сохранения и откатывается при отказе. Некорректная структура JSON распознаётся как повреждение и восстанавливается из корректной копии.
- Импорт принимает отдельные учебные данные и отклоняет повреждённые учебные коллекции. Подтверждение поясняет, что JSON не содержит бинарные файлы Drive и изображения доски.
- Сообщения различают восстановление облака, локальную запись и обновление списка копий; очищается список облачных версий при смене аккаунта.
- Пустой список «Незавершённые» поясняет, что сегодняшние задачи находятся в «Дне». Диагностика не сообщает «отправлено», когда обмен с облаком ещё не выполнялся.
- Добавлены 22 регрессионные проверки и изолированный UI-сценарий заполненного хранилища, восстановления и повреждения состояния; новый сценарий включён в Windows CI.

## 0.32.0

- Подтверждение закрытия формы отображается поверх мобильной формы; пустая форма в «Позже» закрывается без предупреждения.
- В календаре отдельно обозначены сроки сдачи. На телефоне месяц показывает компактную сетку и подробный список выбранного дня.
- В «Позже» видны категория, приоритет и срок; заголовки и дневные показатели соответствуют выбранному списку.
- Пропуски повторяющихся задач сгруппированы с раскрываемой историей, выбором всей группы и компактным меню действий.
- Общий поиск ранжирует результаты, объединяет историю одной задачи и поддерживает фильтр типов и загрузку следующих результатов.
- Таймлайн открывается у ближайшего полезного времени; переключение даты остаётся доступным при прокрутке.
- Предметы можно объединять в семестры, архивировать и восстанавливать без удаления заданий, файлов и расписания; внутри учёбы доступна история ДЗ.
- Отдельную пару можно отменить, перенести или вернуть к исходному расписанию; изменения учитываются в календаре, таймлайне и подсказках дедлайна ДЗ.
- Материалы получили поиск, изменение названия и предмета без перезагрузки файла и выделение результата общего поиска.
- У заметок есть режим чтения и создание задачи в «Позже» из выделения со ссылкой на источник. Кнопка связанных заметок предлагает весь список.
- Срок цели необязателен; доступны пауза, архив и восстановление.
- Доска поддерживает именованные пространства и список карточек для телефона. Существующие карточки остаются на основной доске.
- Изменения сохраняются в прежнем синхронизируемом пространстве без новой SQL-миграции. Питание и личные данные пользователя не изменены.

## 0.31.0

- В задачах появились переключатели «День / Позже / Незавершённые» с количеством дел и сохранением выбранного списка.
- Вчерашние и старые незавершённые задачи разбираются вместе: массовый перенос на дату, в «Позже» или отказ от выбранных дней с отменой действия. «Выбрать все» доступно сразу после включения выбора.
- Календарь начинается с расписания; сводки и цели расположены ниже в сворачиваемом блоке, на телефоне он изначально закрыт.
- Учебные занятия отображаются отдельным отключаемым слоем в неделе, месяце и таймлайне с типом, аудиторией и преподавателем. Они не создают задачи и не меняют статистику выполнения.
- У ДЗ и разовых задач разделены день работы и срок сдачи; перенос подготовки сохраняет дедлайн и напоминание о нём.
- Для связи задачи с целью доступны одно выполнение и заданное число выполнений с выбранной даты, с предпросмотром засчитанной истории. Существующие цели сохраняют прежнее правило.
- Сохранение и статус заметки перенесены к верхнему краю редактора; локальные черновики восстанавливаются после перезагрузки и изолированы по аккаунтам.
- Общий поиск находит текст и области доски, предметы и преподавателей; результат открывает нужный объект.
- Импорт JSON показывает дату копии и состав данных, требует подтверждения замены, делает резервную копию и восстанавливает состояние при ошибке сохранения.
- Выровнены мобильные шапки, уплотнены привычки, убраны пустые контуры даты и лишние заголовки. Раздел питания не изменён.

## 0.30.0

- Новый логотип на страницах приложения, входа и сайта, в PWA, уведомлениях и Windows-сборке; обновлён снимок приложения на сайте.
- Задачи без даты доступны в списке «Позже», сохраняются при перезагрузке и синхронизации и не влияют на дневной прогресс.
- Массовый перенос выбранных задач сохраняет выполнение и пункты чек-листов; перенос можно отменить.
- Уточнены действия с просроченными и повторяющимися задачами, область редактирования серии видна сразу.
- Разделены пустой день, выполненные задачи и отсутствие результатов фильтра; фильтры можно сбросить из пустого состояния.
- Упрощена форма привычки: понятные способы отметки, напоминание в дополнительных настройках, отдельные подписи создания и сохранения.
- Статус сохранения различает локальные данные, синхронизацию и отсутствие связи.

## 0.29.0

- Меню добавления на доске больше не перекрывается панелью выделенной карточки на узком окне.
- Возвращён заметный общий прогресс дня: процент и полоса в боковой панели на компьютере, компактный блок над списком на телефоне. Одновременно виден только один показатель.
- Настройки получили ровные строки без отдельных карточек для каждого параметра, выровненные поля, единые заголовки групп и меньше дублирующих пояснений.
- Уведомления с отменой действия больше не перекрывают открытое мобильное меню «Ещё».
- Убраны конкурирующие показатели дня: один общий процент и количества выполненных задач, привычек и заморозок. Недельная статистика остаётся в календаре.
- Питание начинается с блюд выбранного дня, затем показывает одну сводку и одно предупреждение о неполных данных. Продукты, цели и покупки открываются отдельно, библиотека доступна отдельной кнопкой.
- Настройки собраны в три группы: «Внешний вид», «Напоминания», «Аккаунт и данные». Техническая синхронизация перенесена во вложенную диагностику.
- Уточнены названия действий: «Убрать из активных» и «Вернуть в активные» для привычек, «Шаги задачи», «Этапы цели», понятные команды загрузки данных и восстановления копий.
- По умолчанию доступны задачи, привычки и календарь; дополнительные разделы включаются в настройках навигации без удаления данных. Существующие настройки сохранены.
- Новая задача создаётся через название, дату и кнопку «Создать»; дополнительные настройки всегда свёрнуты при создании, включая сценарий выбранной категории.
- Карточки задач стали компактнее: убраны пустые подписи и дублирующая информация о напоминании, чек-листы раскрываются по нажатию и сохраняют раскрытие при перерисовке. Дублирование доступно в меню.

## 0.28.0

- В календаре возвращены проценты прогресса; годовые подсказки показывают выполненные задачи и привычки числами.
- Нижняя навигация настраивается: можно закрепить учёбу или заметки и скрыть ненужные разделы.
- Добавлены тихие часы и центр напоминаний с откладыванием отдельного напоминания без переноса задачи или привычки.
- Личная библиотека блюд позволяет сохранять состав, изменять рецепт и добавлять независимые копии на выбранный день.
- Отказ локального сохранения питания откатывает данные и метаданные синхронизации, сохраняет введённый продукт и значения целей в форме и не показывает ложный успех.
- Копия съеденного блюда теперь запланирована; удаление после подтверждения не затрагивает сменившееся рабочее пространство.
- Метаданные синхронизации продуктов, блюд и рецептов больше не теряются при очистке.
- Обновлены совместимые зависимости, добавлены CI-проверки каждого изменения, аудит в Cloudflare-сборке и проверка контрольных сумм опубликованной версии.

## 0.27.0

- Мобильная дата теперь читается целиком; подключение Google Drive перенесено к материалам, а форма домашнего задания получила быстрый переход.
- Таймлайн получил переход к ближайшей задаче по времени; пустая цель больше не называется выполненным планом в календаре.
- В меню таймлайна добавлен перенос незавершённой задачи на следующий день и, при просмотре прошлой даты, на сегодня; перенос можно отменить.
- В недельном календаре появился обзор целей: отметки по связанным задачам и привычкам за выбранную неделю, чекпоинты и переход к цели.
- Связанные карточки доски масштабируют текст и кнопки вместе с размером; для них добавлены цветовые варианты с сохранением выбранного цвета.
- Доска получила карточки-ссылки на задачи, цели, заметки, предметы и материалы; карточки показывают актуальные данные, а пустую доску можно начать с шаблона «Учёба» или «Проект».
- Цели можно связать с существующими задачами и привычками, задать число дней выполнения привычки и отслеживать прогресс без ручного отмечания каждого шага.
- Статус связанных целей обновляется после выполнения или отмены задач и привычек, в том числе через MCP.
- Добавлен раздел важных заметок с поиском, закреплением и связью с учебными предметами и задачами. Существующий дневник доступен рядом и сохраняет все записи.
- Заметки включены в локальное хранение, синхронизацию, JSON-экспорт и глобальный поиск; ссылки на них доступны из связанных задач и домашних заданий.

## 0.26.6

- Обновлены безопасные совместимые версии `js-yaml`, `brace-expansion` и транзитивных build-зависимостей; `npm audit` больше не находит известных уязвимостей.

## 0.26.5

- Проверка popover-меню ждёт завершения асинхронного браузерного события `toggle`, но по-прежнему строго проверяет границы viewport и перекрытие соседних карточек.

## 0.26.4

- Открытое меню позиционируется в пределах экрана сразу в событии `toggle`, без кадра в неверном положении и последующего визуального прыжка.

## 0.26.3

- Меню задач, привычек, целей, просрочек и мобильной навигации учитывают фактическое место в viewport, открываются в подходящую сторону и не прячутся под соседними карточками.

## 0.26.2

- Electron E2E в release pipeline автоматически повторяются один раз при нестабильном запуске Windows runner и публикуют полезный хвост лога при повторной ошибке.

## 0.26.1

- Сборки GitHub Actions и Cloudflare закреплены на Node.js 24.11.1, чтобы чистая установка зависимостей не зависела от устаревшей версии Node 22 в окружении CI.

## 0.26.0

- Повторяющиеся временные блоки синхронизируются с Google Calendar как независимые экземпляры: перенос, исключение или удаление одного дня не повреждает серию.
- Двусторонняя синхронизация умеет превратить изменённый в Google экземпляр повтора в отдельную задачу Parsitasks и сохранить остальные дни серии.
- PWA-уведомления при открытом приложении отправляются через Service Worker и возвращают пользователя к задачам по нажатию.
- Камера доски и расчёт дневного прогресса вынесены в отдельные тестируемые модули; release pipeline теперь проверяет E2E, desktop smoke и hosted build до публикации установщика.

## 0.25.0

- Упрощены основные экраны: фильтры задач больше не занимают место без запроса, настройки стали компактнее, аккаунт и выход доступны сразу, а мобильный календарь начинается с самой доски.
- План питания показывает недельные цели и остаток по калориям и БЖУ, а пустая неделя получила прямое действие для добавления первого блюда.
- Доска автоматически возвращает содержимое в поле зрения после неудачного перемещения камеры; архив и достигнутые цели получили более ясные и спокойные состояния.
- Мобильная страница входа стала заметно короче, а пересекающиеся блоки таймлайна сохраняют читаемость и доступ к меню на узком экране.

- Перетаскивание задач без времени переведено на плавный pointer-drag с 15-минутной подсказкой, автопрокруткой и сохранением позиции страницы после переноса.
- Таймлайн теперь показывает реальную высоту 15/30-минутного блока прямо во время resize, а дневник получил безопасное форматирование текста, H1 и H2.
- На занятом блоке таймлайна можно сразу создать вторую задачу с тем же интервалом; после сохранения пересекающиеся задачи автоматически располагаются рядом.
- Добавлена защищённая синхронизация временных блоков с Google Calendar: отдельный OAuth, ручной и автоматический запуск, экспортный и двусторонний режимы.
- Refresh token Google шифруется серверным ключом, связь задач с событиями синхронизируется между устройствами, удаления не воскрешают старые задачи.
- Добавлен единый вход и регистрация через Google на странице аккаунта.
- OAuth-возврат Supabase теперь восстанавливает сессию и безопасно возвращает пользователя в приложение.
- Improved account UX with password visibility controls, refresh-safe sign-in/registration modes, keyboard tab navigation, stronger color contrast, and accurate browser titles.
- Fixed legacy backup folders being detected but not opened, declared icon generation dependencies for clean installs, and replaced the outdated local-only product subtitle.
- Rebuilt the landing and account pages around a responsive Parsitasks design system with a real populated product timeline, stronger hierarchy, and zero horizontal overflow at mobile and desktop widths.
- Renamed all user-facing web, PWA, notification, export, backup, tray, and desktop surfaces to Parsitasks while preserving legacy storage keys and old backup discovery.
- Replaced the old Rhythm monogram with a consistent Parsitasks application icon and added reproducible scripts for product screenshots and icon assets.
- Added a dedicated public landing page at `/`, a focused sign-in and registration page at `/auth`, and the authenticated workspace at `/app`.
- Protected the web and Electron application shells with a shared session gate while preserving password recovery fragments and the requested destination after sign-in.
- Simplified Settings account controls to the current account identity and one sign-out button.
- Added server validation for restored sessions plus route, CSP, desktop navigation, and cross-device auth regression coverage.

## 0.24.0

- Connected web and desktop builds to one managed Parsitasks Supabase project, so users only need to register or sign in.
- Enabled synchronization automatically after authentication and protected account changes from cross-account local data uploads.
- Hardened RLS with owner-bound legacy keys, least-privilege grants, and revoked access to internal database functions.
- Prevented settings files from exporting or replacing database endpoints and synchronization identity.
- Hardened Electron with denied browser permissions, validated IPC senders, bounded backup/reminder payloads, and restricted external navigation.
- Rejected accidentally configured Supabase secret/service-role keys, added API security headers and method allowlists, and pinned privileged GitHub Actions.
- Added a production security checklist and automated security regression coverage.

## 0.23.0

- Added explicit Select and Hand modes with keyboard shortcuts and reliable canvas panning over objects.
- Added copy, paste, duplicate, Undo, Redo, grouping, group resizing, locking, and front/back layer commands.
- Added smart edge and center snapping with live alignment guides while objects move.
- Added lightweight editable frames for structuring larger idea boards without introducing a full diagram editor.
- Preserved image aspect ratios, object layer order, group metadata, and locks across local storage and device synchronization.
- Added responsive contextual tools plus model, geometry, synchronization, desktop, mobile, and accessibility coverage.

## 0.22.2

- Fixed private Supabase Storage images rendering as broken immediately after a successful board upload.
- Added reliable double-click editing for existing board text without interfering with drag gestures.
- Added eight text color presets and a full color picker, synchronized across devices with board metadata.
- Added drag-marquee multi-selection, grouped movement, formatting, deletion, keyboard movement, and Undo.
- Applied the selected app accent to board tools, selection outlines, resize handles, and interaction states.
- Added storage, model, normalization, desktop interaction, multi-selection, and text-editing regression coverage.

## 0.22.1

- Rebuilt the freeform board around direct Figma-style object selection, movement, eight-direction resizing, and keyboard-only deletion.
- Replaced note cards with bare editable text, contextual font size and bold controls, automatic text growth, and collision-free object placement.
- Changed board images to cloud-first private Supabase Storage uploads, with IndexedDB used only as a local rendering cache.
- Expanded the camera from 35% minimum zoom to a 2%-800% range and reset legacy board cameras into the new white infinite canvas.
- Added authenticated storage, model, geometry, deletion, formatting, desktop, mobile, and accessibility regression coverage.

## 0.22.0

- Added a focused freeform ideas board with movable and resizable text notes and images.
- Added local IndexedDB image storage, private Supabase Storage synchronization, and authenticated RLS policies.
- Added panning, zooming, fit-to-content, paste/drop image input, deletion, and a board-specific undo history.
- Added responsive camera handling so board content stays in view when the window or device size changes.
- Included board metadata in JSON state, cloud conflict resolution, tombstones, snapshot summaries, PWA caching, and Electron packaging.

## 0.21.1

- Added automatic desktop update checks and background downloads for the installed Windows version.
- Added a desktop update status, manual check, GitHub Releases link, and restart-to-install action in Settings.
- Added a tag-driven GitHub Actions release pipeline that tests the app and publishes NSIS, portable, and updater metadata files.
- Kept portable builds on an explicit manual-update path and disabled network update checks in development and automated tests.

## 0.20.1

- Added emerald, blue, orange, and violet interface accents with accessible color swatches in Appearance settings.
- Applied the selected accent consistently to buttons, active states, focus rings, shadows, heatmap activity, and ambient highlights in dark and light themes.
- Kept semantic danger and warning colors independent from personalization, persisted the choice locally, and included it in settings import/export and reset.

## 0.20.0

- Added a responsive weekly nutrition planner with meals, ingredients, calories/macros, daily targets, a personal food library, and an aggregated shopping list.
- Included nutrition data in local backups, JSON export, cross-device synchronization, conflict resolution, tombstones, and MCP Undo.
- Added 19 authenticated MCP tools so ChatGPT can inspect and manage meals, products, templates, targets, shopping lists, and plan pause state.
- Added atomic nutrition-plan preview/apply operations so a full week can be reviewed before one reversible write.
- Added nutrition to navigation and workspace search, plus unit, synchronization, Electron, mobile, accessibility, and Cloudflare build coverage.

## 0.19.1

- Removed duplicate completed-task results from workspace search and improved matching journal excerpts.
- Added reliable keyboard selection in workspace search with arrow keys, Enter, and Escape.
- Preserved the current journal text when restoring a revision immediately after an edit.
- Fixed MCP synchronization metadata for journal revision history.

## 0.19.0

- Expanded the daily journal with month navigation, entry markers, text/date search, rotating reflection prompts, and up to 20 restorable revisions per day.
- Added workspace-wide search for tasks, habits, goals, completed work, and journal entries with direct navigation to the result.
- Added independent synchronized permissions for ChatGPT journal reading and writing.
- Added an MCP period reader for on-demand weekly journal summaries while preserving the rule that ChatGPT may not invent personal events.
- Clarified local, pending, syncing, synced, offline, and error save states in the top bar.
- Added module, browser, mobile, Electron, synchronization, and MCP regression coverage for the new workflows.

## 0.18.0

- Added a dedicated daily journal with one automatically saved multiline entry per selected date.
- Journal entries are included in local backups, JSON export, cloud synchronization, conflict resolution, and cloud snapshot summaries.
- Added authenticated MCP tools to read a journal day and append a new paragraph without replacing existing text.
- Journal writes made by ChatGPT are idempotent, visible in the MCP activity log, and undoable.
- Added journal search/fetch support plus desktop, mobile, synchronization, and MCP regression coverage.

## 0.17.2

- Added a compact synchronization diagnostic panel for network, project, account, pending changes, and last exchange state.
- Connection checks now leave a visible, timestamped result instead of relying only on a temporary toast.
- Cloud versions now show their contents and representative item names before restoration.
- Restoring a cloud version now updates synchronization metadata immediately, preventing a misleading follow-up merge.
- Added regression coverage for diagnostic rendering and authenticated snapshot previews.

## 0.17.1

- Hosted deployments now load their Supabase project settings automatically, while local and Electron builds remain manually configurable.
- Cloud recovery now lists all 30 retained versions with task, habit, and goal counts and offers immediate Undo after restoration.
- Account deletion now requires typing the signed-in email and cloud-only controls stay disabled while signed out.
- Browser notification limits are stated explicitly instead of implying closed-tab background delivery.
- Browser and MCP task repeats now use the same normalization implementation.
- The Windows voice assistant now recognizes partial dictation and send phrases without waiting indefinitely for Vosk to finalize an utterance.
- Accessibility E2E now runs against populated tasks, overlapping timeline blocks, habits, goals, and archive data.

## 0.17.0

- Added automatic Supabase state snapshots with retention of the latest 30 versions and a recovery interface in Settings.
- Added authenticated self-service account deletion while preserving local device data.
- Added a synchronized user time zone so the app and ChatGPT agree on today and tomorrow.
- Added atomic MCP task-plan preview/apply tools with one shared undo action.
- Added custom task recurrence to MCP and guided prompts for weekly planning, backlog review, and monthly review.
- Added real Electron accessibility and rendering checks across mobile and desktop views.
- Fixed primary-action, calendar, goal metric, and mobile navigation contrast plus the timeline ARIA hierarchy.
- Updated Electron, Electron Builder, and Wrangler and pinned vulnerable transitive build dependencies to audited versions.

## 0.16.0

- Expanded the authenticated ChatGPT MCP integration from 13 to 26 tools.
- Added calendar-range, backlog, productivity-statistics, and category-list read tools.
- Added habit creation, dated habit editing, pause/restore, goal editing/deletion, task duplication, overdue acknowledgement, and category management.
- Preserved task priority, recurring scope, habit history, synchronization metadata, and cross-device-safe undo for the new commands.
- Made all MCP writes idempotent by request ID, including retries after undo or deletion.
- Added regression coverage for calendar analytics, habit history, goal/category restoration, recurring duplication, and duplicate request delivery.

## 0.15.0

- Added safe MCP editing and rescheduling with explicit recurring scopes for one occurrence, following occurrences, or a whole series.
- Added confirmed task deletion, habit logging, goal creation, checkpoint updates, and morning/evening day briefs.
- Added a synchronized MCP activity log with undo support in both ChatGPT tools and the Settings interface.
- Added optimistic undo patches and tombstones so removed MCP-created records cannot reappear during device synchronization.
- Added per-user burst rate limiting and stricter MCP guidance for confirmation, IDs, and recurring changes.
- Expanded MCP regression coverage for task scopes, deletion safety, habits, goals, timeline conflicts, activity rendering, and undo.

## 0.14.0

- Added an authenticated MCP endpoint for connecting Parsitasks to ChatGPT.
- Added read tools for daily overviews and structured search across tasks, habits, and goals.
- Added idempotent task creation and per-occurrence completion tools without exposing deletion.
- Protected MCP access with Supabase OAuth 2.1 discovery, user validation, RLS, and a dedicated consent screen.
- Applied MCP writes through optimistic concurrency so changes from another device are preserved.
- Integrated the MCP Worker and OAuth bundle into the existing Cloudflare deployment.
- Added setup documentation and regression tests for MCP task operations, authentication, and conflicts.

## 0.13.6

- Preserved historical habit names, settings, values, and streaks across dated edits, pauses, and restorations.
- Prevented stale cloud state from resurrecting locally deleted items by queuing changes made during synchronization.
- Added password-recovery completion to device synchronization and protected remote replacement with a verified safety backup.
- Validated imported JSON before replacing data and kept the previous valid state as the automatic undo backup.
- Made task schedule fields follow the selected mode, kept recurrence edits scoped, and preserved task priority during moves.
- Expanded the timeline to the full day, constrained blocks to 15-minute boundaries, and improved touch drag, resize, and creation.
- Added touch-safe calendar dragging and an explicit recurring-move choice for one occurrence or all following occurrences.
- Prevented accidental form closure with unsaved changes and improved archive filtering, bulk selection, and pagination.
- Improved quick-input date disambiguation, invalid-token feedback, category safety, and year rollover.
- Added content security headers, stricter Electron navigation rules, a skip link, and clearer notification limitations.
- Expanded regression coverage to 145 tests plus Electron smoke, browser E2E, Cloudflare build, and mobile visual checks.

## 0.13.5

- Merge independently edited task, goal, habit, and category fields across devices instead of choosing one entire record.
- Keep cloud delivery queued when a browser storage quota error leaves the newest state only in memory.
- Wait for the Codex window to finish restoring or maximizing before voice input clicks the composer.
- Keep interface preferences explicitly device-local instead of uploading unused remote UI settings.
- Improved the 320px task form, bottom navigation labels, goal cards, timeline menus, and sticky mobile header.
- Added regression coverage for field-level synchronization, storage quota recovery, and narrow schedule controls.

## 0.13.4

- Persisted pending cloud uploads and resume them after reconnect, sign-in, or application restart.
- Recover malformed local state from the latest backup while preserving the damaged source for diagnostics.
- Keep storage quota failures visible and preserve the latest in-memory state for emergency JSON export.
- Removed legacy key synchronization from the UI, REST client, and Supabase anonymous RLS policies.
- Block synchronization when the server exposes a dangerous device clock difference.
- Added a conservative two-year retention policy for local deletion tombstones.
- Extended the live Supabase check with an optional content-preserving write and conflict test.
- Added 320px and 360px browser coverage, touch pointer coverage, and horizontal menu clamping.
- Extracted save and synchronization status formatting from `app.js`.

## 0.13.3

- Fixed task, habit, goal, overdue, navigation, and timeline menus being clipped by cards or viewport edges.
- Added browser-level regression coverage for floating card menus.
- Made the optional voice assistant prefer the largest visible Codex window, ignore cloaked windows, maximize undersized windows, and verify focus before typing.
- Disabled voice auto-send by default so recognition mistakes require an explicit `Отправь` or `Отправить`.
- Added an opt-in read-only live Supabase check for Auth, the `rhythm_states` table, and RLS.
- Extracted settings import, export, and reset behavior from `app.js` into a tested module.
- Updated release metadata and documentation for the current application structure.

## 0.13.2

- Extracted application-shell navigation/rendering and state persistence from `app.js` into focused controllers.
- Kept rendering scoped to the active section and added browser layout containment for large archives.
- Separated touch resize zones on 15-minute timeline blocks so their handles no longer compete for the same area.
- Reworded existing synchronization controls in user-facing language without changing their behavior.
- Added early dependency diagnostics for the optional Windows voice assistant.

## 0.13.1

- Fixed no-time tasks being stored as deadlines after creation, timeline removal, import, synchronization, or reload.
- Kept all three scheduling modes (`none`, `deadline`, and `block`) consistent across forms, quick input, recurring moves, and timeline actions.
- Added regression coverage for no-time quick tasks and schedule-mode normalization.

## 0.13.0

- Added stable URL routes for every section and calendar mode, including browser back/forward navigation and direct links.
- Reworked mobile navigation spacing, date controls, task cards, timeline blocks, forms, archive filters, and week-board scrolling.
- Kept task form actions visible while scrolling and made new tasks default to the clearer no-time mode without an automatic reminder.
- Removed duplicate weekly overview blocks and empty hourly timeline labels to reduce visual noise.
- Simplified goal progress cards and clarified overdue and archive bulk actions, restore destinations, and recurring-task semantics.
- Added confirmation before bulk archive restoration and expanded browser-level regression coverage.

## 0.12.11

- Reloading now preserves the active section, selected calendar period, browsed date, task filter, and archive period.
- A view left on today still follows the calendar when the app is reopened on a later day.
- Increased small timeline, calendar, and synchronization controls to mobile-friendly touch targets.

## 0.12.10

- Voice submission now accepts `Отправь`, `Отправить`, and `Отправляй` while remaining compatible with custom phrases.

## 0.12.9

- Removed the weekly summary panel and its unused rendering code.

## 0.12.8

- Redesigned the weekly summary as a compact responsive panel and removed empty zero-value metrics.
- Added a one-time PWA shell refresh to recover clients that combined new markup with stale assets.
- Static application assets now prefer the current network version and use the cache only as an offline fallback.

## 0.12.7

- Habit type, target, unit, and recurrence changes now apply from the selected date without rewriting earlier statistics.
- Numeric and check habit logs survive later type changes.
- Archived habits remain visible when browsing dates before their archive date.
- Added a compact weekly summary with completed totals and the strongest day.
- Added a user-controlled PWA update banner instead of switching versions mid-session.

## 0.12.6

- Habit renames now take effect from the selected date without rewriting names on earlier days.
- Habit title history is normalized and merged safely between devices.

## 0.12.5

- Dated task flags and habit logs now keep per-date revision metadata, including explicit resets.
- Task, habit, and goal checkpoint ordering now converges between devices.
- Goal checkpoints merge independently instead of replacing the whole goal checklist.
- Supabase writes use optimistic concurrency and retry after merging a conflicting revision.
- Deleting every category no longer restores the default categories on reload.
- Cloudflare builds generate a content-based service worker cache version.
- Added PNG PWA icons for Windows and Android installation.
- Extracted shared data normalizers, synchronization metadata, and PWA registration from `app.js`.

## 0.12.4

- Added an isolated low-load Windows voice assistant with offline Russian wake-word recognition and Win32-based Codex prompt submission.
- Removed the ineffective simple/advanced interface mode and its obsolete persisted setting.
- Automatically merge duplicate categories by normalized name and preserve task-category links across devices.
- Fixed deleted records reappearing during two-device synchronization when device clocks or migrated timestamps differ.
- Made deletion markers authoritative during state merges and remove deleted task IDs from synchronized ordering.
- Prepared automatic Cloudflare Workers Static Assets deployment from the private GitHub repository and `master` branch.
- Added a clean static web build containing only the PWA application shell.
- Added live cross-device synchronization every 30 seconds and whenever the app regains focus, visibility, or network access.
- Merge newer remote changes before automatic pushes so two active devices do not silently overwrite each other.
- Reworked remote storage copy around a same-account multi-device setup while keeping offline-first local data.
- Renamed Overview to Calendar and made its week, month, and year metrics match the visible period.
- Moved archive period filtering into Archive and added safe single-entry deletion for completed recurring occurrences.
- Simplified mobile tasks, timeline, and habit cards with collapsible secondary controls and compact action menus.
- Added accessible task, habit, and goal dialogs with focus trapping, Escape handling, and focus restoration.
- Moved category management into Settings and removed duplicated data actions from the sidebar.
- Added Supabase password recovery and clearer disabled and ready states for manual remote sync actions.
- Clarified the sidebar progress metric with separate task and habit percentages.
- Removed the completed recurring-series manager from the task screen.
- Added Supabase email/password authentication with local-only session storage and authenticated RLS policies.
- Added a compact local sync history for push, pull, merge, and error events.
- Added archive period filters and a backlog of older unfinished one-off and recurring occurrences.
- Added compact, regular, and touch-friendly timeline scales with persisted preference.
- Extracted shared application utilities and planning-history logic from `app.js`.
- Added a real Electron browser test for the mobile habit form and timeline scale controls.

## 0.9.0 - 2026-07-13

- Fixed time-block reminders so offsets are calculated from the block start, while overdue state still uses its end.
- Added safety backup and undo when restoring local data, plus import access from mobile Settings.
- Made custom task and habit repeat editors available whenever “Настроить” is selected in simple mode.
- Added automatic merge-on-start for newer remote state and surfaced sync failures in the global save status.
- Improved narrow-screen forms, task actions, touch and keyboard ordering, timeline deadline markers, and mobile toast placement.
- Added a collapsed backlog for old unfinished one-off tasks and explicit restore destinations in the archive.
- Added pausing, restoring, and safe permanent deletion for habits, with target-aware numeric steppers.
- Added category editing, human-readable goal dates, and week/month/year modes in Overview.

## 0.8.0 - 2026-07-13

- Added recurring-task edit scopes for one occurrence, this and following occurrences, or the whole series.
- Preserved historical completion and notification flags when splitting a recurring series from the edited date.
- Replaced the goal checkpoint textarea with an inline editor for adding, renaming, deleting, and reordering checkpoints.
- Added keyboard-accessible checkpoint ordering and focused regression coverage for recurring edits.

## 0.7.0 - 2026-07-12

- Added an explicit no-time mode for task creation and editing.
- Added drag-to-unschedule for timeline tasks with a visible drop target.
- Added an "Убрать время" timeline menu action as a touch and keyboard-friendly alternative.
- Preserved recurring-task scope selection when removing timeline time.
- Extracted task schedule mode and preset handling into `task-schedule.js`.

## 0.6.0 - 2026-07-12

- Replaced goal-to-task links with independent deadline-free checkpoints and automatic progress.
- Added automatic goal completion, achieved-goal sorting, compact action menus, and a completion celebration.
- Migrated existing linked goal tasks into checkpoints without discarding their completion state.
- Added timeline scope selection for recurring tasks: one occurrence or the selected occurrence and all following ones.
- Split recurring series at the selected date so past timeline history keeps its original schedule.

## 0.5.0 - 2026-07-12

- Added one-click acknowledgement for all previous-day overdue tasks, with undo and per-task restore.
- Added entity update timestamps and deletion tombstones so stale remote state cannot overwrite newer edits or restore deleted records.
- Bumped the local data schema to version 8 and the application release to 0.5.0.
- Added safe deletion for moved recurring replacements and scoped duplication for recurring timeline tasks.
- Added cached overdue history with a persistent hide/show control.
- Limited the overdue block to the previous calendar day and made hiding remove the entire block.
- Calculate the one-day overdue window relative to the currently selected date.
- Added per-occurrence "Пометить просмотренной" without completing, deleting, or moving the task.
- Added ended-series management with resume-from-today behavior.
- Added goal-link deletion warnings and direct navigation from goals to linked tasks.
- Added offline, pending-sync, and synchronized status states plus local/remote state merging.
- Extracted application event binding and calendar drag behavior into dedicated controllers.
- Added visible repeat end dates with resume support and preserved timed recurring replacements without exposing false exclusions.
- Replaced the silent overdue history cap with complete history and incremental "show more" controls.
- Automatically removes deleted task links from goals and repairs orphaned links during normalization.
- Added secure sync-key generation, legacy-key warnings, and complete offline app-shell caching.
- Extracted overdue calculations, task-state mutations, and sync-key policy into dedicated modules.
- Fixed clipped overdue task action menus and made them open above the trigger.
- Fixed moving overdue recurring occurrences to today without creating an excluded duplicate occurrence.
- Added recurring-task deletion scope: one occurrence or the selected day and all future occurrences.
- Exposed both recurring deletion scopes directly in the overdue task menu without a second confirmation step.
- Linked goals to existing tasks and calculate goal progress from their real completion state.
- Added archive bulk selection, restore, deletion, and date-grouped history.
- Added a guided Supabase connection flow with private key generation.
- Converted unscheduled timeline drops into resizable one-hour blocks while preserving priority.
- Improved coarse-pointer resize targets for 15-minute timeline blocks.
- Added touch and keyboard reordering controls for habits.
- Added quick-input hint chips and automatic active-day rollover after midnight.
- Added `view-renderer.js` to avoid rebuilding every hidden view after each state change.
- Fixed mobile More navigation, active states, and view scroll reset.
- Moved task, habit, and goal lists before collapsed editing forms on narrow layouts.
- Fixed mutually exclusive deadline and time-block fields in the task form.
- Removed automatic demo task and habit creation from an empty profile.
- Added a two-row mobile year heatmap and compact month task markers.
- Increased mobile action targets, made the desktop sidebar scrollable, and reduced settings density.
- Extracted task rendering into `tasks-view.js`.
- Extracted habit rendering into `habits-view.js`.
- Extracted calendar rendering into `calendar-view.js`.
- Extracted archive rendering into `archive-view.js`.
- Extracted task and habit form handling into `task-form.js` and `habit-form.js`.
- Extracted categories, notifications, and import/export backup logic into separate modules.
- Removed unreachable legacy render code from `app.js`.
- Added `state-normalizer.js` for import/save normalization.
- Added unit tests for quick input, recurrence rules, storage, task moves, and state normalization.
- Added Electron file backups to the application documents folder.
- Added sidebar UI for file backup status and opening the backup folder.

## 0.4.0

- Added monthly and weekly calendar views.
- Added drag-and-drop task rescheduling in calendar views.
- Added quick task input with date, time, category, and priority parsing.
- Added undo actions in toast messages.
- Added overdue tasks, task postponing, recurring exclusions, archive filters, and local JSON backup/restore.
