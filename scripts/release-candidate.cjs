const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const FORMAT = "parsitasks-release-candidate-v1";
const SEAL = "candidate.json";
const sha = (body) => crypto.createHash("sha256").update(body).digest("hex");
const validFile = (name) => typeof name === "string" && /^[a-zA-Z0-9_./-]+$/.test(name)
  && !name.startsWith("/") && !name.split("/").some((part) => !part || part === "." || part === "..")
  && !name.split("/").some((part) => [".env", ".dev.vars", ".security-test.env", "node_modules", ".git"].includes(part)
    || part.startsWith(".env.") || part.startsWith(".dev.vars."));

function listFiles(directory, prefix = "") {
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("Release directories must not be symbolic links");
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error("Release files must not be symbolic links");
    const name = path.posix.join(prefix, entry.name);
    if (!validFile(name)) throw new Error("Invalid candidate path");
    if (entry.isDirectory()) return listFiles(path.join(directory, entry.name), name);
    if (!entry.isFile()) throw new Error("Candidate contains a non-file entry");
    return [name];
  });
}

function validateManifest(release, expectedRevision) {
  if (!/^[a-f0-9]{40}$/.test(expectedRevision || "")) throw new Error("A full expected Git revision is required");
  if (release?.sourceRevision !== expectedRevision) throw new Error("Web build revision does not match the verified commit");
  if (!/^\d+\.\d+\.\d+$/.test(release.version || "") || !/^[a-f0-9]{12}$/.test(release.buildHash || "")) throw new Error("Invalid web build manifest");
  const assets = Object.entries(release.assets || {});
  if (!assets.length || assets.length > 2000) throw new Error("Invalid web asset list");
  for (const [file, hash] of assets) {
    if (!file.startsWith("/") || !validFile(file.slice(1)) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid web asset fingerprint");
  }
  for (const file of ["/index.html", "/auth.html", "/landing.html", "/sw.js"]) {
    if (!Object.hasOwn(release.assets, file)) throw new Error("Required web shell asset is missing");
  }
}

function prepareCandidate({ root, expectedRevision, sourceDirty }) {
  root = fs.realpathSync(root);
  if (typeof sourceDirty !== "boolean") throw new Error("Working-tree status must be provided");
  const web = path.join(root, "web-dist");
  const files = listFiles(web);
  const release = JSON.parse(fs.readFileSync(path.join(web, "release.json"), "utf8"));
  validateManifest(release, expectedRevision);
  for (const [file, hash] of Object.entries(release.assets)) {
    if (sha(fs.readFileSync(path.join(web, file.slice(1)))) !== hash) throw new Error("Web asset changed after the build");
  }
  const controls = ["release.json", "_headers", "_redirects", ".nojekyll"];
  if (files.some((file) => !Object.hasOwn(release.assets, `/${file}`) && !controls.includes(file))) throw new Error("Unlisted file in the web build");
  const bundle = path.join(root, ".wrangler-build", "worker.js");
  if (fs.lstatSync(bundle).isSymbolicLink()) throw new Error("Worker bundle must not be a symbolic link");
  const config = JSON.parse(fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8"));
  if (config.name !== "tasks-and-habits" || !config.assets) throw new Error("Unexpected Worker configuration");
  const { $schema, build, env, ...deployConfig } = config;
  Object.assign(deployConfig, { main: "./worker.js", no_bundle: true, find_additional_modules: false, keep_vars: true,
    assets: { ...config.assets, directory: "./assets" } });

  // Only replace the known child directory, never a caller-provided deletion target.
  const output = path.resolve(root, ".release-candidate");
  if (path.dirname(output) !== root || (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink())) throw new Error("Unsafe candidate output directory");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const file of files) {
    const destination = path.join(output, "assets", file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(web, file), destination);
  }
  fs.copyFileSync(bundle, path.join(output, "worker.js"));
  fs.writeFileSync(path.join(output, "wrangler.json"), JSON.stringify(deployConfig, null, 2));
  const fingerprints = Object.fromEntries(listFiles(output).map((file) => [file, sha(fs.readFileSync(path.join(output, file)))]));
  const candidate = { format: FORMAT, sourceRevision: expectedRevision, sourceDirty, version: release.version, buildHash: release.buildHash, files: fingerprints };
  fs.writeFileSync(path.join(output, SEAL), JSON.stringify(candidate, null, 2));
  return candidate;
}

function verifyCandidate({ directory, expectedRevision, expectedSeal = null, allowDirty = false }) {
  const files = listFiles(directory);
  const sealBody = fs.readFileSync(path.join(directory, SEAL));
  const sealDigest = sha(sealBody);
  if (expectedSeal !== null && (!/^[a-f0-9]{64}$/.test(expectedSeal || "") || sealDigest !== expectedSeal)) throw new Error("Candidate seal does not match the verification job");
  const candidate = JSON.parse(sealBody.toString("utf8"));
  if (candidate.format !== FORMAT || candidate.sourceRevision !== expectedRevision) throw new Error("Candidate is not from the verified commit");
  if (typeof candidate.sourceDirty !== "boolean" || (candidate.sourceDirty && !allowDirty)) throw new Error("A dirty working-tree candidate cannot be deployed");
  const expectedFiles = Object.keys(candidate.files || {});
  if (expectedFiles.length < 7 || expectedFiles.length > 4096 || expectedFiles.includes(SEAL)) throw new Error("Invalid candidate file list");
  for (const file of ["worker.js", "wrangler.json", "assets/release.json"]) {
    if (!Object.hasOwn(candidate.files, file)) throw new Error("Required deployment file is missing");
  }
  if (JSON.stringify(files.filter((file) => file !== SEAL).sort()) !== JSON.stringify(expectedFiles.sort())) throw new Error("Candidate files are missing or unexpected");
  for (const [file, hash] of Object.entries(candidate.files)) {
    if (!validFile(file) || !/^[a-f0-9]{64}$/.test(hash) || sha(fs.readFileSync(path.join(directory, file))) !== hash) throw new Error("Candidate fingerprint does not match");
  }
  const release = JSON.parse(fs.readFileSync(path.join(directory, "assets", "release.json"), "utf8"));
  validateManifest(release, expectedRevision);
  if (release.version !== candidate.version || release.buildHash !== candidate.buildHash) throw new Error("Candidate and web release metadata disagree");
  for (const [file, hash] of Object.entries(release.assets)) {
    if (candidate.files[`assets${file}`] !== hash) throw new Error("Candidate does not contain the verified web release");
  }
  const config = JSON.parse(fs.readFileSync(path.join(directory, "wrangler.json"), "utf8"));
  if (config.name !== "tasks-and-habits" || config.main !== "./worker.js" || config.assets?.directory !== "./assets"
    || config.no_bundle !== true || config.find_additional_modules !== false || config.keep_vars !== true || config.build || config.env) throw new Error("Candidate must deploy its prebuilt Worker and assets");
  return { sourceRevision: candidate.sourceRevision, version: candidate.version, buildHash: candidate.buildHash, verifiedFiles: expectedFiles.length, sourceDirty: candidate.sourceDirty, sealDigest };
}

function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const root = path.resolve(__dirname, "..");
  const expectedRevision = option("--revision", process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
  if (args[0] === "prepare") {
    const sourceDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim());
    if (sourceDirty && !args.includes("--allow-dirty")) throw new Error("Commit the changes before preparing a deployable candidate; --allow-dirty is for local dry-runs only");
    prepareCandidate({ root, expectedRevision, sourceDirty });
  } else if (args[0] !== "verify") throw new Error("Use prepare or verify");
  const result = verifyCandidate({ directory: path.join(root, ".release-candidate"), expectedRevision,
    expectedSeal: option("--seal", null), allowDirty: args.includes("--allow-dirty") });
  if (args[0] === "prepare" && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `candidate_seal_sha256=${result.sealDigest}\n`);
  console.log(`candidate verified - ${JSON.stringify(result)}`);
}

module.exports = { prepareCandidate, verifyCandidate };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
