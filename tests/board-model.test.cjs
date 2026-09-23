const assert = require("node:assert/strict");
const model = require("../src/board/board-model.js");

module.exports = [
  {
    name: "normalizes text and image items without embedding image data",
    fn() {
      const items = model.normalizeItems([
        {
          id: "text-1",
          type: "text",
          x: 12,
          y: 20,
          text: "Совет",
          width: 20,
          height: 10,
          fontSize: 96,
          fontWeight: 700,
          color: "#ABCDEF",
        },
        {
          id: "image-1",
          type: "image",
          x: 80,
          y: 40,
          assetId: "asset-1",
          mime: "image/png",
          name: "screen.png",
          dataUrl: "data:image/png;base64,too-large-for-state",
        },
        {
          id: "frame-1",
          type: "frame",
          text: "План",
          width: 100,
          height: 80,
          groupId: "group-1",
          locked: true,
        },
      ]);

      assert.equal(items.length, 3);
      assert.equal(items[0].width, 40);
      assert.equal(items[0].height, 24);
      assert.equal(items[0].fontSize, 96);
      assert.equal(items[0].fontWeight, 700);
      assert.equal(items[0].color, "#abcdef");
      assert.equal(items[1].assetId, "asset-1");
      assert.equal("dataUrl" in items[1], false);
      assert.equal(items[2].type, "frame");
      assert.equal(items[2].text, "План");
      assert.equal(items[2].width, 240);
      assert.equal(items[2].height, 160);
      assert.equal(items[2].groupId, "group-1");
      assert.equal(items[2].locked, true);
    },
  },
  {
    name: "builds bounds for focusing the board content",
    fn() {
      assert.deepEqual(model.bounds([
        { x: -100, y: 20, width: 200, height: 100 },
        { x: 150, y: -30, width: 50, height: 80 },
      ]), {
        left: -100,
        top: -30,
        right: 200,
        bottom: 120,
        width: 300,
        height: 150,
      });
    },
  },
];
