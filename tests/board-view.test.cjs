const assert = require("node:assert/strict");
const { MAX_ZOOM, MIN_ZOOM, resizeGeometry, snapMove } = require("../src/board/board-view.js");

module.exports = [
  {
    name: "allows a near-infinite board zoom range",
    fn() {
      assert.ok(MIN_ZOOM <= 0.02);
      assert.ok(MAX_ZOOM >= 8);
    },
  },
  {
    name: "resizes an image from its north-west corner without changing aspect ratio",
    fn() {
      const result = resizeGeometry(
        { type: "image", x: 100, y: 80, width: 400, height: 200 },
        -200,
        -100,
        "nw",
      );

      assert.equal(result.width / result.height, 2);
      assert.equal(result.x + result.width, 500);
      assert.equal(result.y + result.height, 280);
    },
  },
  {
    name: "resizes text freely from any side",
    fn() {
      assert.deepEqual(
        resizeGeometry(
          { type: "text", x: 100, y: 80, width: 300, height: 120 },
          -80,
          50,
          "sw",
        ),
        { x: 20, y: 80, width: 380, height: 170 },
      );
    },
  },
  {
    name: "snaps a moving selection to nearby object centers",
    fn() {
      assert.deepEqual(
        snapMove(
          [{ x: 10, y: 20, width: 100, height: 80 }],
          [{ x: 200, y: 200, width: 100, height: 80 }],
          91,
          179,
          5,
        ),
        { dx: 90, dy: 180, vertical: 200, horizontal: 200 },
      );
    },
  },
];
