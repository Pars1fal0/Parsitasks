const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { buildWeb } = require("../scripts/build-web.cjs");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-build-test-"));
  const write = (name, body) => {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body);
  };
  write("app/sw.js", 'const version = "__BUILD_HASH__";');
  write("app/index.html", '<script src="src/app.js"></script>');
  write("app/src/app.js", "globalThis.test = true;");
  write("mcp/oauth-consent-entry.mjs", "console.log('consent');");
  write("package.json", JSON.stringify({ version: "0.0.0" }));
  write("web-dist/old.txt", "previous valid build");
  return { root, write, build: () => buildWeb({ directory: root }) };
}

module.exports = [
  { name: "a successful web build replaces stale assets and fingerprints the installed files", fn() {
    const f = fixture();
    try {
      f.build();
      const output = path.join(f.root, "web-dist");
      const release = JSON.parse(fs.readFileSync(path.join(output, "release.json")));
      assert.equal(fs.existsSync(path.join(output, "old.txt")), false);
      for (const [file, hash] of Object.entries(release.assets)) {
        assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(output, file))).digest("hex"), hash);
      }
      assert.ok(fs.readFileSync(path.join(output, "sw.js"), "utf8").includes(release.buildHash));
      assert.ok(fs.readFileSync(path.join(output, "index.html"), "utf8").includes(`src/app.js?v=${release.buildHash}`));
      assert.equal(fs.readdirSync(f.root).some((file) => file.startsWith(".web-build-")), false);
    } finally { fs.rmSync(f.root, { recursive: true }); }
  } },
  { name: "a compilation failure leaves the previous web build byte-identical", fn() {
    const f = fixture();
    try {
      f.write("mcp/oauth-consent-entry.mjs", "not valid javascript @");
      assert.throws(f.build, /Build failed/);
      assert.equal(fs.readFileSync(path.join(f.root, "web-dist/old.txt"), "utf8"), "previous valid build");
      assert.equal(fs.readdirSync(f.root).some((file) => file.startsWith(".web-build-")), false);
    } finally { fs.rmSync(f.root, { recursive: true }); }
  } },
  { name: "a locked output or failed installation cannot delete the previous web build", fn() {
    for (const stage of ["old", "new"]) {
      const f = fixture(); const rename = fs.renameSync;
      try {
        fs.renameSync = (from, to) => {
          if ((stage === "old" && path.basename(from) === "web-dist") || (stage === "new" && path.basename(from).startsWith(".web-build-") && !path.basename(from).startsWith(".web-build-old-"))) {
            throw Object.assign(new Error("Synthetic file lock"), { code: "EPERM" });
          }
          return rename(from, to);
        };
        assert.throws(f.build, stage === "old" ? /previous build was preserved/ : /Synthetic file lock/);
        assert.equal(fs.readFileSync(path.join(f.root, "web-dist/old.txt"), "utf8"), "previous valid build");
        assert.equal(fs.readdirSync(f.root).some((file) => file.startsWith(".web-build-")), false);
      } finally { fs.renameSync = rename; fs.rmSync(f.root, { recursive: true }); }
    }
  } },
];
