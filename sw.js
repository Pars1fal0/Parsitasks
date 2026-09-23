const CACHE_PREFIX = "rhythm-day-";
const CACHE_NAME = `${CACHE_PREFIX}app-v84-__BUILD_HASH__`;
const APP_SHELL = [
  "./",
  "landing.html",
  "landing.css",
  "src/marketing/landing.js",
  "landing-product.png",
  "auth.html",
  "auth.css",
  "src/auth/auth-page.js",
  "google-g.svg",
  "index.html",
  "src/auth/auth-gate.js",
  "src/platform/shell-version.js",
  "styles.css",
  "disclosure-menus.css",
  "src/core/app-utils.js",
  "src/tasks/quick-input.js",
  "src/tasks/recurrence.js",
  "src/auth/remote-auth.js",
  "src/auth/remote-auth-controller.js",
  "src/integrations/google-calendar-occurrences.js",
  "src/integrations/google-calendar-api.js",
  "src/integrations/google-calendar-controller.js",
  "src/sync/remote-sync.js",
    "src/sync/remote-sync-controller.js",
    "src/sync/remote-data-controller.js",
  "src/sync/sync-history.js",
  "src/sync/sync-diagnostics.js",
    "src/settings/settings-state.js",
    "src/settings/profile-settings.js",
  "src/core/data-normalizers.js",
  "src/sync/sync-metadata.js",
  "src/sync/tombstone-retention.js",
  "src/habits/habit-title-history.js",
  "src/habits/habit-config-history.js",
  "src/integrations/mcp-activity.js",
  "src/integrations/mcp-activity-controller.js",
  "src/platform/pwa-controller.js",
  "src/platform/desktop-update-controller.js",
  "src/core/state-normalizer.js",
  "src/core/state-controller.js",
  "src/core/state-merge.js",
  "src/core/date-rollover.js",
  "src/sync/device-sync-controller.js",
  "src/core/planning-history.js",
  "src/board/board-model.js",
  "src/board/board-assets.js",
  "src/board/board-camera.js",
  "src/journal/journal-model.js",
  "src/journal/journal-editor.js",
  "src/journal/journal-view.js",
  "src/board/board-view.js",
  "src/nutrition/nutrition-model.js",
  "src/nutrition/nutrition-controller.js",
  "src/nutrition/nutrition-view.js",
  "src/ui/global-search.js",
  "src/core/storage.js",
  "src/core/navigation-state.js",
  "src/tasks/archive-view.js",
  "src/ui/disclosure-menus.js",
  "src/core/app-events.js",
  "src/calendar/heatmap-view.js",
  "src/auth/hosted-config.js",
  "src/calendar/calendar-view.js",
  "src/calendar/calendar-drag-controller.js",
  "src/ui/confirm-dialog.js",
  "src/ui/form-dialog.js",
  "src/tasks/categories.js",
  "src/goals/goal-checkpoint-editor.js",
  "src/goals/goals-view.js",
  "src/habits/habit-form.js",
  "src/habits/habits-view.js",
  "src/settings/import-export.js",
  "src/platform/notifications.js",
  "src/tasks/overdue-controller.js",
  "src/tasks/task-form.js",
  "src/tasks/task-schedule.js",
  "src/tasks/tasks-view.js",
  "src/tasks/task-moves.js",
  "src/tasks/task-state.js",
  "src/settings/settings-sync.js",
  "src/settings/settings-transfer.js",
  "src/sync/save-status.js",
  "src/settings/settings-controller.js",
  "src/timeline/timeline-layout.js",
  "src/timeline/timeline-menu.js",
  "src/timeline/timeline-drag.js",
  "src/timeline/timeline-view.js",
  "src/timeline/timeline-controller.js",
  "src/core/daily-pulse.js",
  "src/core/view-renderer.js",
  "src/core/app-shell-controller.js",
  "src/ui/toast.js",
  "src/core/app.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL)),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/app#tasks", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then(async (clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if ("navigate" in existing) await existing.navigate(targetUrl);
        return;
      }
      await self.clients.openWindow(targetUrl);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    const pathname = new URL(event.request.url).pathname.replace(/\/$/, "") || "/";
    const fallback = pathname === "/"
      ? "landing.html"
      : pathname === "/auth"
        ? "auth.html"
        : "index.html";
    event.respondWith(
      fetch(event.request).catch(() => caches.match(fallback, { ignoreSearch: true })),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") return response;

        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
