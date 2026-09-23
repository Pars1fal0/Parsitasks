const assert = require("node:assert/strict");
const camera = require("../src/board/board-camera.js");

module.exports = [
  {
    name: "fits distant board content into the visible viewport",
    fn() {
      const fitted = camera.fitCamera(
        { left: 5000, top: 3000, width: 800, height: 400 },
        { width: 1200, height: 800 },
        0.02,
        8,
      );
      const projected = camera.projectBounds(fitted, { left: 5000, top: 3000, width: 800, height: 400 });
      assert.ok(projected.left >= 0);
      assert.ok(projected.right <= 1200);
      assert.ok(projected.top >= 0);
      assert.ok(projected.bottom <= 800);
    },
  },
  {
    name: "keeps the world point under the cursor stable while zooming",
    fn() {
      const rect = { left: 10, top: 20 };
      const before = { x: 100, y: 80, zoom: 1 };
      const point = { x: 410, y: 320 };
      const worldBefore = camera.screenToWorld(before, rect, point.x, point.y);
      const after = camera.zoomCamera(before, 2, point, rect, 0.02, 8);
      const worldAfter = camera.screenToWorld(after, rect, point.x, point.y);
      assert.deepEqual(worldAfter, worldBefore);
    },
  },
  {
    name: "loads only valid persisted cameras and clamps legacy zoom",
    fn() {
      const storage = { getItem: () => JSON.stringify({ x: 1, y: 2, zoom: 99 }) };
      assert.deepEqual(camera.loadCamera(storage, "camera", 0.02, 8), { x: 1, y: 2, zoom: 8 });
      assert.equal(camera.loadCamera({ getItem: () => "bad" }, "camera", 0.02, 8), null);
    },
  },
];
