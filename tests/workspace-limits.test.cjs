const assert = require("node:assert/strict");
const { MAX_WORKSPACE_BYTES, jsonByteLength, assertWorkspaceSize } = require("../app/src/core/workspace-limits.js");
const { createSaveStatus } = require("../app/src/sync/save-status.js");
const { createMemoryStorage, storageApi } = require("./test-utils.cjs");

module.exports = [
  { name: "workspace limits count UTF-8 bytes and accept the exact inclusive boundary", fn() {
    const state = { tasks: [], text: "" };
    state.text = "x".repeat(MAX_WORKSPACE_BYTES - jsonByteLength(state));
    assert.equal(assertWorkspaceSize(state), MAX_WORKSPACE_BYTES);
    state.text += "я";
    assert.throws(() => assertWorkspaceSize(state), (error) => error.code === "workspace-too-large" && error.bytes === MAX_WORKSPACE_BYTES + 2);
  } },
  { name: "storage diagnostics exclude local owner metadata without counting the document twice", fn() {
    const storage = createMemoryStorage(), adapter = storageApi.createLocalStorageAdapter({ storage });
    const saved = adapter.saveState({ tasks: [{ title: "Привет" }] }, { owner: "владелец", skipBackup: true });
    const diagnostics = adapter.getDiagnostics();
    assert.equal(diagnostics.bytes, jsonByteLength(saved));
    assert.equal(diagnostics.storedBytes, Buffer.byteLength(storage.getItem(adapter.keys.state)));
    assert.ok(diagnostics.storedBytes > diagnostics.bytes);
  } },
  { name: "an oversized local workspace is never described as synchronized", fn() {
    const status = createSaveStatus({});
    const state = { stateBytes: MAX_WORKSPACE_BYTES + 1, remoteEnabled: true, remoteLastPushedAt: "2026-10-22T12:00:00Z" };
    assert.equal(status.getStateCode(state), "error"); assert.match(status.getMessage(state), /синхронизация недоступна/);
    assert.match(status.getMessage({ ...state, localStorageError: "Full" }), /^Full$/);
  } },
];
