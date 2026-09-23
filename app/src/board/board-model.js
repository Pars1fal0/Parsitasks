(function (global) {
  const ITEM_TYPES = new Set(["text", "image", "frame"]);
  const MAX_TEXT_LENGTH = 20000;
  const MIN_FONT_SIZE = 8;
  const MAX_FONT_SIZE = 512;

  function normalizeItems(value, options = {}) {
    const createId = options.createId || (() => `board-${Date.now().toString(36)}`);
    const seen = new Set();
    return (Array.isArray(value) ? value : [])
      .map((item, index) => normalizeItem(item, { createId, index }))
      .filter(Boolean)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .sort((left, right) => left.z - right.z || left.createdAt.localeCompare(right.createdAt));
  }

  function normalizeItem(value, options = {}) {
    if (!value || !ITEM_TYPES.has(value.type)) return null;
    const now = options.now || new Date().toISOString();
    const type = value.type;
    const assetId = cleanText(value.assetId, 160);
    if (type === "image" && !assetId) return null;
    const minimumWidth = type === "frame" ? 240 : 40;
    const minimumHeight = type === "frame" ? 160 : type === "image" ? 40 : 24;
    const defaultWidth = type === "frame" ? 720 : type === "image" ? 400 : 360;
    const defaultHeight = type === "frame" ? 480 : type === "image" ? 280 : 140;
    return {
      id: cleanText(value.id, 160) || options.createId?.() || `board-${Date.now().toString(36)}`,
      type,
      x: finiteNumber(value.x, -1000000000, 1000000000, 0),
      y: finiteNumber(value.y, -1000000000, 1000000000, 0),
      width: finiteNumber(value.width, minimumWidth, 10000, defaultWidth),
      height: finiteNumber(value.height, minimumHeight, 10000, defaultHeight),
      z: Math.round(finiteNumber(value.z, 0, 1000000000, options.index || 0)),
      text: type === "text" || type === "frame"
        ? cleanText(value.text || (type === "frame" ? "Новый фрейм" : ""), MAX_TEXT_LENGTH, true)
        : "",
      fontSize: type === "text" ? Math.round(finiteNumber(value.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, 32)) : 0,
      fontWeight: type === "text" && Number(value.fontWeight) >= 600 ? 700 : 400,
      color: type === "text" ? normalizeColor(value.color) : "",
      groupId: cleanText(value.groupId, 160),
      locked: value.locked === true,
      assetId: type === "image" ? assetId : "",
      remotePath: type === "image" ? cleanText(value.remotePath, 500) : "",
      mime: type === "image" && /^image\/[a-z0-9.+-]+$/i.test(String(value.mime || "")) ? String(value.mime) : "",
      name: type === "image" ? cleanText(value.name, 240) : "",
      createdAt: validTimestamp(value.createdAt) || now,
      updatedAt: validTimestamp(value.updatedAt) || validTimestamp(value.createdAt) || now,
    };
  }

  function createTextItem(input = {}, options = {}) {
    return normalizeItem({
      id: options.createId?.(),
      type: "text",
      x: input.x,
      y: input.y,
      width: input.width || 360,
      height: input.height || 140,
      z: input.z,
      text: input.text || "",
      fontSize: input.fontSize || 32,
      fontWeight: input.fontWeight || 400,
      color: input.color || "#17191d",
      createdAt: options.now,
      updatedAt: options.now,
    }, options);
  }

  function createImageItem(input = {}, options = {}) {
    return normalizeItem({
      id: options.createId?.(),
      type: "image",
      x: input.x,
      y: input.y,
      width: input.width || 360,
      height: input.height || 240,
      z: input.z,
      assetId: input.assetId,
      remotePath: input.remotePath,
      mime: input.mime,
      name: input.name,
      createdAt: options.now,
      updatedAt: options.now,
    }, options);
  }

  function createFrameItem(input = {}, options = {}) {
    return normalizeItem({
      id: options.createId?.(),
      type: "frame",
      x: input.x,
      y: input.y,
      width: input.width || 720,
      height: input.height || 480,
      z: input.z,
      text: input.text || "Новый фрейм",
      createdAt: options.now,
      updatedAt: options.now,
    }, options);
  }

  function bounds(items = []) {
    if (!items.length) return null;
    const left = Math.min(...items.map((item) => item.x));
    const top = Math.min(...items.map((item) => item.y));
    const right = Math.max(...items.map((item) => item.x + item.width));
    const bottom = Math.max(...items.map((item) => item.y + item.height));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function cleanText(value, maxLength, preserveWhitespace = false) {
    const text = String(value || "").replace(/\u0000/g, "");
    return (preserveWhitespace ? text : text.trim()).slice(0, maxLength);
  }

  function finiteNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function normalizeColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#17191d";
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
  }

  const api = {
    MAX_TEXT_LENGTH,
    MAX_FONT_SIZE,
    MIN_FONT_SIZE,
    bounds,
    createFrameItem,
    createImageItem,
    createTextItem,
    normalizeItem,
    normalizeItems,
  };
  global.RhythmBoardModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
