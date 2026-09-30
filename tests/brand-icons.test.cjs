const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const root = path.resolve(__dirname, "..");
const icons = path.join(root, "app", "assets", "icons");

module.exports = [
  { name: "all brand pages use the supplied bitmap and generated favicon", fn() {
    for (const file of ["index.html", "auth.html", "landing.html", "oauth-consent.html"]) {
      const html = fs.readFileSync(path.join(root, "app", file), "utf8");
      assert.doesNotMatch(html, /icons\/icon\.svg/);
      assert.match(html, /class="brand-mark" src="\/?assets\/icons\/logo\.png"/);
      assert.match(html, /rel="icon" href="\/?assets\/icons\/icon-32\.png" type="image\/png"/);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "app", "manifest.webmanifest")));
    manifest.icons.forEach((icon) => assert.ok(fs.existsSync(path.join(root, "app", icon.src))));
    assert.equal(require("../package.json").build.win.icon, "app/assets/icons/icon.ico");
  } },
  { name: "generated application icons retain transparency and valid Windows entries", async fn() {
    for (const size of [32, 64, 192, 256, 512]) {
      const metadata = await sharp(path.join(icons, `icon-${size}.png`)).metadata();
      assert.equal(metadata.width, size);
      assert.equal(metadata.height, size);
      assert.equal(metadata.hasAlpha, true);
    }
    const ico = fs.readFileSync(path.join(icons, "icon.ico"));
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 3);
    for (let index = 0; index < 3; index += 1) {
      const entry = 6 + index * 16;
      const size = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      assert.ok(offset + size <= ico.length);
      assert.equal((await sharp(ico.subarray(offset, offset + size)).metadata()).format, "png");
    }
  } },
];
