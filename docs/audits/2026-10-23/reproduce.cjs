// Read-only audit reproductions: synthetic state and mocked HTTP only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../..');
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);

(async () => {
  const document = await load('app/src/core/document-state.js');
  const write = await load('mcp/write-service.mjs');
  const frontend = await load('app/src/integrations/mcp-activity.js');
  const journal = await load('mcp/journal-service.mjs');
  const calendar = await load('mcp/google-calendar.mjs');
  const occurrences = await load('app/src/integrations/google-calendar-occurrences.js');
  const evidence = [];

  const original = document.normalizeState({ tasks: [{ id: 'task-1', title: 'Before', date: '2026-10-23', repeat: 'none' }] });
  const change = write.updateTaskCommand(original, { requestId: 'audit-task-change', taskId: 'task-1', title: 'MCP title' }, { now: '2026-10-23T09:00:00Z' });
  change.state.tasks[0].completed['2026-10-23'] = true;
  change.state.tasks[0].updatedAt = '2026-10-23T10:00:00Z';
  const backendUndo = write.undoMcpCommand(change.state, { actionId: change.activity.id }, { now: '2026-10-23T11:00:00Z' });
  const frontendUndo = frontend.undoActivity(change.state, change.activity.id, '2026-10-23T11:00:00Z');
  assert.notEqual(backendUndo.state.tasks[0].completed['2026-10-23'], true);
  assert.notEqual(frontendUndo.state.tasks[0].completed['2026-10-23'], true);
  let diary = document.createEmptyState();
  diary = journal.appendJournalEntryCommand(diary, { requestId: 'audit-diary-initial', date: '2026-10-23', text: 'Original diary' }, { now: '2026-10-23T08:00:00Z' }).state;
  const appended = journal.appendJournalEntryCommand(diary, { requestId: 'audit-diary-append', date: '2026-10-23', text: 'MCP paragraph' }, { now: '2026-10-23T09:00:00Z' });
  appended.state.journalEntries[0].text += '\n\nLater user text';
  appended.state.journalEntries[0].updatedAt = '2026-10-23T10:00:00Z';
  const diaryUndo = write.undoMcpCommand(appended.state, { actionId: appended.activity.id }, { now: '2026-10-23T11:00:00Z' });
  assert.ok(!diaryUndo.state.journalEntries[0].text.includes('Later user text'));
  evidence.push({ issue: 'P1: undo overwrites later changes', taskCompletionLostInBackendAndUI: true, laterDiaryTextLost: true });

  const date = '2026-10-23';
  const stamp = '2026-10-22T08:00:00.000Z';
  const state = { categories: [], tasks: [], googleCalendarLinks: {} };
  for (let index = 0; index < 1001; index++) {
    const id = `task-${String(index).padStart(4, '0')}`;
    state.tasks.push({ id, title: id, date, repeat: 'none', scheduleMode: 'block', startTime: '10:00', endTime: '11:00', updatedAt: stamp });
    state.googleCalendarLinks[id] = { eventId: `event-${index}`, localUpdatedAt: stamp, remoteUpdatedAt: stamp, syncedAt: stamp };
  }
  // The already-linked task falls beyond the batch after 1000 earlier tasks are added.
  state.googleCalendarLinks = { 'task-1000': state.googleCalendarLinks['task-1000'] };
  const payload = occurrences.buildCalendarTasks(state, { from: date, to: date });
  assert.equal(payload.tasks.length, 1000);
  assert.deepEqual(payload.staleTaskIds, ['task-1000']);
  const env = { APP_BASE_URL: 'https://example.test', GOOGLE_CALENDAR_CLIENT_ID: 'synthetic-client', GOOGLE_CALENDAR_CLIENT_SECRET: 'synthetic-secret',
    GOOGLE_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef', SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' };
  const encrypted = await calendar.encryptText('synthetic-refresh-token', env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  const calls = [];
  const fetch = async (input, options = {}) => {
    const url = String(input);
    const method = options.method || 'GET';
    calls.push({ url, method });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'synthetic-user' });
    if (url.includes('/rest/v1/google_calendar_connections')) return method === 'GET' ? Response.json([{ encrypted_refresh_token: encrypted, calendar_id: 'primary', direction: 'export' }]) : new Response(null, { status: 204 });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-google-token' });
    if (url.includes('/calendar/v3/')) {
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'PATCH') return Response.json({ id: url.split('/').pop(), updated: stamp });
      if (url.includes('/events?')) return Response.json({ items: state.tasks.map((task, index) => ({ id: `event-${index}`, updated: stamp, status: 'confirmed', extendedProperties: { private: { parsitasksTaskId: task.id } } })) });
    }
    throw new Error(`Unexpected mocked request: ${method} ${url}`);
  };
  const synced = await calendar.handleGoogleCalendarRequest(new Request('https://example.test/api/google-calendar/sync', { method: 'POST',
    headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction: 'export', timeZone: 'UTC', tasks: payload.tasks, links: state.googleCalendarLinks, outOfRangeTaskIds: payload.staleTaskIds }) }), env, { fetch });
  assert.equal(synced.status, 200, await synced.text());
  const deletions = calls.filter((call) => call.method === 'DELETE');
  assert.ok(deletions.some((call) => call.url.endsWith('/events/event-1000')));
  evidence.push({ issue: 'P1: calendar limit deletes a valid linked event', selectedTasks: payload.tasks.length, skippedValidTasks: payload.skipped, wronglyDeleted: deletions });

  const status = await calendar.handleGoogleCalendarRequest(new Request('https://example.test/api/google-calendar/status', { headers: { Origin: 'null', Authorization: 'Bearer synthetic' } }), env, { fetch });
  assert.equal(status.status, 200);
  assert.equal(status.headers.get('Access-Control-Allow-Origin'), null);
  evidence.push({ issue: 'P2: calendar response cannot be read from Electron file origin', status: status.status, accessControlAllowOrigin: status.headers.get('Access-Control-Allow-Origin') });

  const source = fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8');
  const allowFunction = source.match(/function isAllowedExternalUrl\(value\) \{[\s\S]*?\r?\n\}/)[0];
  const allowed = vm.runInNewContext(`(${allowFunction})`, { URL });
  assert.equal(allowed('https://drive.google.com/file/d/synthetic/view'), false);
  assert.equal(allowed('https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic'), false);
  assert.equal(allowed('https://parsitasks.ru/app#study'), true);
  evidence.push({ issue: 'P2: desktop blocks Drive materials and Calendar OAuth', driveLinkAllowed: false, googleOAuthAllowed: false });

  console.log(JSON.stringify(evidence, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
