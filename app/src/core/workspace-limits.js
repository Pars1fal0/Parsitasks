export const MAX_WORKSPACE_BYTES = 4 * 1024 * 1024;
export const WORKSPACE_WARNING_BYTES = 3 * 1024 * 1024;
export const MAX_REMOTE_UI_BYTES = 256 * 1024;
export const MAX_IMPORT_FILE_BYTES = 16 * 1024 * 1024;

export function jsonByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertWorkspaceSize(state) {
  const bytes = jsonByteLength(state);
  if (bytes > MAX_WORKSPACE_BYTES) {
    throw Object.assign(new Error("Документ превышает лимит синхронизации (4 МиБ)."), {
      code: "workspace-too-large", bytes, limit: MAX_WORKSPACE_BYTES,
    });
  }
  return bytes;
}
