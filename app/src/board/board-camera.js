(function (global) {
  function loadCamera(storage, key, minZoom, maxZoom) {
    try {
      const value = JSON.parse(storage?.getItem(key));
      if (!validCamera(value)) return null;
      return { x: value.x, y: value.y, zoom: clamp(value.zoom, minZoom, maxZoom) };
    } catch {
      return null;
    }
  }

  function saveCamera(storage, key, camera) {
    try {
      storage?.setItem(key, JSON.stringify(camera));
      return true;
    } catch {
      return false;
    }
  }

  function initialCamera(rect = {}) {
    return { x: Number(rect.width || 0) / 2 - 180, y: Math.max(100, Number(rect.height || 0) / 3), zoom: 1 };
  }

  function fitCamera(content, rect = {}, minZoom, maxZoom) {
    if (!content) return initialCamera(rect);
    const width = Number(rect.width || 0);
    const height = Number(rect.height || 0);
    const padding = Math.min(120, Math.max(36, width * 0.08));
    const zoom = clamp(Math.min(
      (width - padding * 2) / Math.max(content.width, 1),
      (height - padding * 2) / Math.max(content.height, 1),
      1.5,
    ), minZoom, maxZoom);
    return {
      zoom,
      x: width / 2 - (content.left + content.width / 2) * zoom,
      y: height / 2 - (content.top + content.height / 2) * zoom,
    };
  }

  function zoomCamera(camera, factor, point, rect, minZoom, maxZoom) {
    const localX = point.x - rect.left;
    const localY = point.y - rect.top;
    const worldX = (localX - camera.x) / camera.zoom;
    const worldY = (localY - camera.y) / camera.zoom;
    const zoom = clamp(camera.zoom * factor, minZoom, maxZoom);
    return {
      x: localX - worldX * zoom,
      y: localY - worldY * zoom,
      zoom,
    };
  }

  function screenToWorld(camera, rect, clientX, clientY) {
    return {
      x: (clientX - rect.left - camera.x) / camera.zoom,
      y: (clientY - rect.top - camera.y) / camera.zoom,
    };
  }

  function projectBounds(camera, content) {
    return {
      left: camera.x + content.left * camera.zoom,
      top: camera.y + content.top * camera.zoom,
      right: camera.x + (content.left + content.width) * camera.zoom,
      bottom: camera.y + (content.top + content.height) * camera.zoom,
    };
  }

  function formatZoom(zoom) {
    const percent = zoom * 100;
    return percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
  }

  function validCamera(value) {
    return Number.isFinite(value?.x) && Number.isFinite(value?.y) && Number.isFinite(value?.zoom);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  const api = { fitCamera, formatZoom, initialCamera, loadCamera, projectBounds, saveCamera, screenToWorld, zoomCamera };
  global.RhythmBoardCamera = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
