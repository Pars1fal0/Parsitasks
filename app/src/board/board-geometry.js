// Pure board geometry: resizing, image fitting, snapping and bounds. No DOM access.
export function resizeGeometry(item, dx, dy, direction) {
  const minWidth = item.type === "frame" ? 240 : item.type === "link" ? 180 : 40;
  const minHeight = item.type === "frame" ? 160 : item.type === "link" ? 96 : item.type === "image" ? 40 : 24;
  const maxSize = 10000;
  const hasWest = direction.includes("w");
  const hasEast = direction.includes("e");
  const hasNorth = direction.includes("n");
  const hasSouth = direction.includes("s");
  const isCorner = (hasWest || hasEast) && (hasNorth || hasSouth);

  if (item.type === "link") {
    const ratio = item.width / Math.max(item.height, 1);
    const widthFromX = item.width + (hasEast ? dx : hasWest ? -dx : 0);
    const widthFromY = (item.height + (hasSouth ? dy : hasNorth ? -dy : 0)) * ratio;
    const horizontalChange = Math.abs(widthFromX - item.width) / item.width;
    const verticalChange = Math.abs(widthFromY - item.width) / item.width;
    let width = isCorner ? (verticalChange > horizontalChange ? widthFromY : widthFromX)
      : hasEast || hasWest ? widthFromX : widthFromY;
    width = clamp(width, Math.max(minWidth, minHeight * ratio), Math.min(maxSize, maxSize * ratio));
    const height = width / ratio;
    return {
      x: hasWest ? item.x + item.width - width : hasEast ? item.x : item.x + (item.width - width) / 2,
      y: hasNorth ? item.y + item.height - height : hasSouth ? item.y : item.y + (item.height - height) / 2,
      width,
      height,
    };
  }

  if (item.type === "image" && isCorner) {
    const rawWidth = clamp(item.width + (hasEast ? dx : -dx), minWidth, maxSize);
    const rawHeight = clamp(item.height + (hasSouth ? dy : -dy), minHeight, maxSize);
    const ratio = item.width / Math.max(item.height, 1);
    const widthChange = Math.abs(rawWidth - item.width) / Math.max(item.width, 1);
    const heightChange = Math.abs(rawHeight - item.height) / Math.max(item.height, 1);
    let width = rawWidth;
    let height = clamp(width / ratio, minHeight, maxSize);
    if (heightChange > widthChange) {
      height = rawHeight;
      width = clamp(height * ratio, minWidth, maxSize);
    }
    return {
      x: hasWest ? item.x + item.width - width : item.x,
      y: hasNorth ? item.y + item.height - height : item.y,
      width,
      height,
    };
  }

  let left = item.x;
  let top = item.y;
  let right = item.x + item.width;
  let bottom = item.y + item.height;
  if (hasWest) left = Math.min(right - minWidth, left + dx);
  if (hasEast) right = Math.max(left + minWidth, right + dx);
  if (hasNorth) top = Math.min(bottom - minHeight, top + dy);
  if (hasSouth) bottom = Math.max(top + minHeight, bottom + dy);
  return {
    x: left,
    y: top,
    width: clamp(right - left, minWidth, maxSize),
    height: clamp(bottom - top, minHeight, maxSize),
  };
}

export function fitImage(width, height) {
  const scale = Math.min(1, 520 / width, 420 / height);
  return {
    width: Math.max(80, Math.round(width * scale)),
    height: Math.max(80, Math.round(height * scale)),
  };
}

export function snapMove(movingItems, targetItems, dx, dy, threshold = 7) {
  const moving = itemBounds(movingItems);
  if (!moving || !targetItems.length) return { dx, dy, vertical: NaN, horizontal: NaN };
  const movingX = [moving.left + dx, moving.left + moving.width / 2 + dx, moving.right + dx];
  const movingY = [moving.top + dy, moving.top + moving.height / 2 + dy, moving.bottom + dy];
  const targetX = targetItems.flatMap((item) => [item.x, item.x + item.width / 2, item.x + item.width]);
  const targetY = targetItems.flatMap((item) => [item.y, item.y + item.height / 2, item.y + item.height]);
  const xSnap = closestSnap(movingX, targetX, threshold);
  const ySnap = closestSnap(movingY, targetY, threshold);
  return {
    dx: dx + (xSnap?.delta || 0),
    dy: dy + (ySnap?.delta || 0),
    vertical: xSnap?.target ?? NaN,
    horizontal: ySnap?.target ?? NaN,
  };
}

export function closestSnap(sources, targets, threshold) {
  let best = null;
  sources.forEach((source) => {
    targets.forEach((target) => {
      const delta = target - source;
      if (Math.abs(delta) > threshold) return;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, target };
    });
  });
  return best;
}

export function itemBounds(items = []) {
  if (!items.length) return null;
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
