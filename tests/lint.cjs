const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "src");
const sourceFiles = [path.join(root, "sw.js"), ...fs.readdirSync(sourceRoot, { withFileTypes: true })
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

const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...indexHtml.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1].split("?")[0]);
scriptSources.forEach((scriptSource) => {
  assert.equal(fs.existsSync(path.join(root, scriptSource)), true, `Missing script referenced by index.html: ${scriptSource}`);
});

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packagedFiles = new Set(packageJson.build?.files || []);
assert.equal(packagedFiles.has("src/**/*"), true, "package.json build.files must include client modules");
assert.equal(sourceFiles.length > 80, true, "lint must cover the client source tree");

console.log(`lint ok - ${sourceFiles.length + mcpFiles.length} source files, ${testFiles.length} test files`);
