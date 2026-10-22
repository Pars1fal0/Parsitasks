// Application entry: wires the app modules in dependency order, then starts the app.
import "./ui/disclosure-menus.js";
import * as boardAssets from "./board/board-assets.js";
import * as boardModel from "./board/board-model.js";
import * as desktopUpdateController from "./platform/desktop-update-controller.js";
import * as recurrence from "./tasks/recurrence.js";
import * as stateMerge from "./core/state-merge.js";
import * as studyModel from "./study/study-model.js";
import { exposeModules, exposePageGlobals } from "./core/page-globals.js";
import { app } from "./app/store.js";
import * as state from "./app/state.js";
import * as dom from "./app/dom.js";
import * as services from "./app/services.js";
import * as views from "./app/views.js";
import * as editors from "./app/editors.js";
import * as sync from "./app/sync.js";
import * as shell from "./app/shell.js";
import * as lifecycle from "./app/lifecycle.js";
import * as taskActions from "./app/task-actions.js";
import * as forms from "./app/forms.js";
import * as queries from "./app/queries.js";
import * as platform from "./app/platform.js";
import * as settings from "./app/settings.js";
import * as persistence from "./app/persistence.js";

state.setupState();
services.wireServices();
views.wireViews();
editors.wireEditors();
sync.wireSync();
shell.wireShell();

persistence.seedIfEmpty();
lifecycle.init();

exposeModules(
  [state, dom, services, views, editors, sync, shell, lifecycle, taskActions, forms, queries, platform, settings, persistence],
  [app],
);
// Module namespaces that UI tests and the desktop smoke check inspect directly.
exposePageGlobals({
  RhythmBoardAssets: [() => boardAssets],
  RhythmBoardModel: [() => boardModel],
  RhythmDesktopUpdateController: [() => desktopUpdateController],
  RhythmRecurrence: [() => recurrence],
  RhythmStateMerge: [() => stateMerge],
  RhythmStudyModel: [() => studyModel],
});
