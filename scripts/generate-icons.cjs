const path = require("node:path");
const fs = require("node:fs/promises");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const icons = path.join(root, "app", "assets", "icons");
const source = path.join(icons, "logo.png");

Promise.all([32, 64, 192, 256, 512].map((size) =>
  sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(icons, `icon-${size}.png`)),
)).then(async () => {
  const sizes = [32, 64, 256];
  const images = await Promise.all(sizes.map((size) => fs.readFile(path.join(icons, `icon-${size}.png`))));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index] === 256 ? 0 : sizes[index];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  await fs.writeFile(path.join(icons, "icon.ico"), Buffer.concat([header, ...images]));
  console.log("application icons updated");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
