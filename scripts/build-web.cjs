const fs = require("node:fs");
const crypto = require("node:crypto");
const esbuild = require("esbuild");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = path.join(root, "app");
const output = path.join(root, "web-dist");
function listFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const relative = path.posix.join(prefix, entry.name);
      return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative) : [relative];
    });
}

const files = listFiles(appSource);
if (!files.includes("sw.js")) throw new Error("Missing app/sw.js");

fs.rmSync(output, { force: true, recursive: true });
fs.mkdirSync(output, { recursive: true });

const buildHasher = crypto.createHash("sha256");
files.forEach((file) => {
  buildHasher.update(file);
  buildHasher.update(fs.readFileSync(path.join(appSource, file)));
});
buildHasher.update(fs.readFileSync(path.join(root, "mcp", "oauth-consent-entry.mjs")));
const buildHash = buildHasher.digest("hex").slice(0, 12);

for (const file of files) {
  const source = path.join(appSource, file);
  const destination = path.join(output, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (file === "sw.js") {
    fs.writeFileSync(destination, fs.readFileSync(source, "utf8").replaceAll("__BUILD_HASH__", buildHash), "utf8");
  } else {
    fs.copyFileSync(source, destination);
  }
}

esbuild.buildSync({
  bundle: true,
  entryPoints: [path.join(root, "mcp", "oauth-consent-entry.mjs")],
  format: "iife",
  minify: true,
  outfile: path.join(output, "oauth-consent.js"),
  platform: "browser",
  target: ["es2022"],
});

fs.writeFileSync(path.join(output, ".nojekyll"), "", "utf8");
console.log(`web build ok - ${files.length + 1} files - cache ${buildHash}`);
