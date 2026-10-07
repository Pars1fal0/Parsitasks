const fs = require("node:fs");
const crypto = require("node:crypto");
const esbuild = require("esbuild");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
function listFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const relative = path.posix.join(prefix, entry.name);
      return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative) : [relative];
    });
}

function stampAssetUrls(html, version) {
  if (!/^[a-f0-9]{12}$/.test(version)) throw new Error("Invalid asset version");
  return html.replace(/<link\b[^>]*>|<script\b[^>]*>/g, (tag) => {
    const stylesheet = tag.startsWith("<link") && /\brel="stylesheet"/.test(tag);
    const script = tag.startsWith("<script") && /\bsrc="/.test(tag);
    if (!stylesheet && !script) return tag;
    return tag.replace(/\b(href|src)="([^"]+)"/, (attribute, name, url) => {
      if (/^(?:data:|https?:|#)/.test(url)) return attribute;
      const asset = url.split("?")[0];
      if (!/\.(?:js|css)$/.test(asset)) return attribute;
      return `${name}="${asset}?v=${version}"`;
    });
  });
}

function buildWeb({ directory = root } = {}) {
  const workspace = fs.realpathSync(directory);
  const appSource = path.join(workspace, "app");
  const output = path.join(workspace, "web-dist");
  const files = listFiles(appSource);
  if (!files.includes("sw.js")) throw new Error("Missing app/sw.js");
  const staging = fs.mkdtempSync(path.join(workspace, ".web-build-"));
  const previous = path.join(workspace, `.web-build-old-${crypto.randomUUID()}`);
  let oldMoved = false;
  let installed = false;
  const validate = (target) => {
    if (path.dirname(target) !== workspace || !/^(?:web-dist|\.web-build-[A-Za-z0-9-]+)$/.test(path.basename(target))) throw new Error("Unsafe generated build directory");
    if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target)) throw new Error("Build directory must not be a link");
  };
  try {
    const contents = new Map(files.map((file) => [file, fs.readFileSync(path.join(appSource, file))]));
    const buildHasher = crypto.createHash("sha256");
    contents.forEach((body, file) => { buildHasher.update(file); buildHasher.update(body); });
    buildHasher.update(fs.readFileSync(path.join(workspace, "mcp", "oauth-consent-entry.mjs")));
    const buildHash = buildHasher.digest("hex").slice(0, 12);
    for (const [file, body] of contents) {
      const destination = path.join(staging, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const value = file === "sw.js" ? body.toString("utf8").replaceAll("__BUILD_HASH__", buildHash)
        : file.endsWith(".html") ? stampAssetUrls(body.toString("utf8"), buildHash) : body;
      fs.writeFileSync(destination, value);
    }
    esbuild.buildSync({
      bundle: true,
      entryPoints: [path.join(workspace, "mcp", "oauth-consent-entry.mjs")],
      format: "iife", minify: true, logLevel: "silent",
      outfile: path.join(staging, "oauth-consent.js"), platform: "browser", target: ["es2022"],
    });
    fs.writeFileSync(path.join(staging, ".nojekyll"), "");
    let sourceRevision = process.env.GITHUB_SHA || null;
    if (!sourceRevision) {
      try { sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
    }
    // Cloudflare consumes routing/header configuration; these are not public assets.
    const assets = Object.fromEntries([...files.filter((file) => !["_headers", "_redirects"].includes(file)), "oauth-consent.js"].map((file) => [
      `/${file}`, crypto.createHash("sha256").update(fs.readFileSync(path.join(staging, file))).digest("hex"),
    ]));
    fs.writeFileSync(path.join(staging, "release.json"), JSON.stringify({
      version: JSON.parse(fs.readFileSync(path.join(workspace, "package.json"))).version,
      buildHash, sourceRevision, assets,
    }, null, 2));
    validate(output); validate(previous); validate(staging);
    if (fs.existsSync(output)) {
      try { fs.renameSync(output, previous); oldMoved = true; }
      catch { throw new Error("Build output is in use. Stop the local dev server and retry; the previous build was preserved"); }
    }
    try { fs.renameSync(staging, output); installed = true; }
    catch (error) {
      if (oldMoved) { validate(previous); validate(output); fs.renameSync(previous, output); oldMoved = false; }
      throw error;
    }
    if (oldMoved) {
      validate(previous);
      try { fs.rmSync(previous, { recursive: true }); }
      catch { console.warn(`New build installed; previous generated build retained at ${previous}`); }
    }
    console.log(`web build ok - ${files.length + 2} files - cache ${buildHash}`);
    return { buildHash, output };
  } finally {
    if (!installed && fs.existsSync(staging)) { validate(staging); fs.rmSync(staging, { recursive: true }); }
  }
}

module.exports = { stampAssetUrls, buildWeb };

if (require.main === module) buildWeb();
