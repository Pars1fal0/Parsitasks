const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appRoot = path.join(root, "app");
const sourceRoot = path.join(appRoot, "src");
const sourceFiles = [path.join(appRoot, "sw.js"), ...fs.readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => fs.readdirSync(path.join(sourceRoot, entry.name))
    .filter((file) => file.endsWith(".js"))
    .map((file) => path.join(sourceRoot, entry.name, file)))];
const testFiles = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith(".cjs"))
  .map((file) => path.join(__dirname, file));
const scriptFiles = fs
  .readdirSync(path.join(root, "scripts"))
  .filter((file) => file.endsWith(".cjs"))
  .map((file) => path.join(root, "scripts", file));
const mcpFiles = fs
  .readdirSync(path.join(root, "mcp"))
  .filter((file) => file.endsWith(".mjs"))
  .map((file) => path.join(root, "mcp", file));

const forbidden = [
  { pattern: /\binnerHTML\b/, label: "innerHTML" },
  { pattern: /\bwindow\.confirm\b/, label: "window.confirm" },
  { pattern: /\balert\s*\(/, label: "alert()" },
  { pattern: /\bprompt\s*\(/, label: "prompt()" },
];

[...sourceFiles, ...mcpFiles].forEach((filePath) => {
  const source = fs.readFileSync(filePath, "utf8");
  forbidden.forEach((rule) => {
    assert.equal(rule.pattern.test(source), false, `${path.basename(filePath)} contains forbidden ${rule.label}`);
  });
});

[...sourceFiles, ...testFiles, ...scriptFiles].forEach((filePath) => {
  const source = fs.readFileSync(filePath, "utf8");
  assert.doesNotThrow(() => new Function(source), `${path.relative(root, filePath)} has invalid JavaScript syntax`);
});

mcpFiles.forEach((filePath) => {
  const result = require("node:child_process").spawnSync(process.execPath, ["--check", filePath], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${path.relative(root, filePath)} has invalid JavaScript syntax\n${result.stderr}`);
});

const pageFiles = ["index.html", "auth.html", "landing.html", "oauth-consent.html"];
pageFiles.forEach((pageFile) => {
  const page = fs.readFileSync(path.join(appRoot, pageFile), "utf8");
  const references = [...page.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1].split("?")[0])
    .filter((reference) => reference && !/^(?:data:|https?:|#)/.test(reference) && reference !== "/oauth-consent.js");
  references.forEach((reference) => {
    assert.equal(fs.existsSync(path.join(appRoot, reference.replace(/^\//, ""))), true,
      `Missing asset referenced by ${pageFile}: ${reference}`);
  });
});

fs.readdirSync(path.join(appRoot, "assets", "styles"))
  .filter((file) => file.endsWith(".css"))
  .forEach((file) => {
    const directory = path.join(appRoot, "assets", "styles");
    const css = fs.readFileSync(path.join(directory, file), "utf8");
    [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)]
      .map((match) => match[1])
      .filter((reference) => !/^(?:data:|https?:)/.test(reference))
      .forEach((reference) => assert.equal(fs.existsSync(path.resolve(directory, reference)), true,
        `Missing asset referenced by ${file}: ${reference}`));
  });

const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, "manifest.webmanifest"), "utf8"));
manifest.icons.forEach(({ src }) => {
  assert.equal(fs.existsSync(path.join(appRoot, src)), true, `Missing PWA icon: ${src}`);
});

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packagedFiles = new Set(packageJson.build?.files || []);
assert.equal(packagedFiles.has("app/**/*"), true, "package.json build.files must include the client application");
assert.equal(sourceFiles.length > 80, true, "lint must cover the client source tree");

console.log(`lint ok - ${sourceFiles.length + mcpFiles.length} source files, ${testFiles.length} test files`);
