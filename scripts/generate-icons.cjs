const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const icons = path.join(root, "app", "assets", "icons");
const source = path.join(icons, "icon.svg");

Promise.all([192, 512].map((size) =>
  sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(icons, `icon-${size}.png`)),
)).then(() => {
  console.log("application icons updated");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
