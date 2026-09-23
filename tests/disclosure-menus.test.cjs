const assert = require("node:assert/strict");
const {
  calculateMenuMaxHeight,
  calculateMenuShift,
  chooseMenuDirection,
} = require("../src/ui/disclosure-menus.js");

module.exports = [
  {
    name: "opens a disclosure menu down when it fits below the trigger",
    fn() {
      assert.equal(chooseMenuDirection({ top: 100, bottom: 140 }, 180, 800), "down");
    },
  },
  {
    name: "opens a disclosure menu up near the bottom of the viewport",
    fn() {
      assert.equal(chooseMenuDirection({ top: 720, bottom: 760 }, 180, 800), "up");
    },
  },
  {
    name: "uses the side with more room when a menu cannot fully fit",
    fn() {
      assert.equal(chooseMenuDirection({ top: 500, bottom: 540 }, 480, 800), "up");
    },
  },
  {
    name: "shifts a menu back inside a narrow viewport",
    fn() {
      assert.equal(calculateMenuShift({ left: -3, right: 277 }, 320), 11);
      assert.equal(calculateMenuShift({ left: 50, right: 325 }, 320), -13);
      assert.equal(calculateMenuShift({ left: 20, right: 300 }, 320), 0);
    },
  },
  {
    name: "limits a disclosure menu to the room on its chosen side",
    fn() {
      assert.equal(calculateMenuMaxHeight({ top: 610, bottom: 650 }, 720, "up"), 602);
      assert.equal(calculateMenuMaxHeight({ top: 610, bottom: 650 }, 720, "down"), 62);
    },
  },
];
