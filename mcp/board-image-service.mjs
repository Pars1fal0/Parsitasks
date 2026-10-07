const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function decodeBoardImage(base64, mime) {
  if (!TYPES[mime] || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64 || "")) throw new Error("Поддерживаются PNG, JPEG, WebP и GIF в base64");
  const binary = atob(base64);
  if (binary.length < 12 || binary.length > 1024 * 1024) throw new Error("Изображение MCP: от 12 байт до 1 МиБ; большие файлы загружайте через приложение");
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  const valid = mime === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    : mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mime === "image/gif" ? ["GIF87a", "GIF89a"].includes(ascii(0, 6)) : ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (!valid) throw new Error("Содержимое изображения не соответствует MIME-типу");
  return bytes;
}

export function createBoardImageUploader({ supabaseUrl, anonKey, accessToken, userId, fetchFn = fetch }) {
  return async (assetId, bytes, mime) => {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(assetId) || !TYPES[mime]) throw new Error("Некорректный идентификатор изображения");
    const path = `${userId}/${assetId}.${TYPES[mime]}`;
    const response = await fetchFn(`${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/board-images/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, "Content-Type": mime, "x-upsert": "false" }, body: bytes,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      // The asset ID contains a content hash, so a duplicate on retry cannot replace other bytes.
      if (!(response.status === 409 || String(error.statusCode) === "409") || !/duplicate|already exists/i.test(String(error.message || error.error || ""))) {
        throw new Error("Не удалось загрузить изображение в приватное хранилище; карточка не создана");
      }
    }
    return { assetId, remotePath: path, mime };
  };
}
