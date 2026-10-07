const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { collectProjectBackup, inventory } = require("../scripts/collect-project-backup.cjs");
const { unpack } = require("../scripts/backup-bundle.cjs");

function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "parsitasks-project-backup-test-"));
  const root = path.join(temporary, "source"); const directory = path.join(temporary, "copies");
  fs.mkdirSync(path.join(root, "database"), { recursive: true }); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(root, "database", "migration.sql"), "select 1;");
  const providerSettingsFile = path.join(temporary, "provider.json"); fs.writeFileSync(providerSettingsFile, '{"smtp":"configured"}');
  const keyEscrowFile = path.join(temporary, "separate-key.txt"); fs.writeFileSync(keyEscrowFile, "independent-key-".repeat(3));
  const calls = []; const body = Buffer.from("image");
  const client = { storage: { listBuckets: async () => ({ data: [{ id: "board-images" }] }), from: () => ({
    list: async () => ({ data: [{ id: "object", name: "image.png", updated_at: "2026-10-07", metadata: { size: body.length } }] }),
    download: async () => ({ data: new Blob([body]) }),
  }) } };
  const options = { root, directory, providerSettingsFile, keyEscrowFile, client, password: "backup-password-".repeat(3), dbUrl: "postgresql://private:test@example.test/postgres",
    dump: async (args) => { calls.push(args); fs.writeFileSync(args[args.indexOf("--file") + 1], "-- fixture database export"); } };
  return { temporary, calls, options };
}
module.exports = [
  { name: "project backup includes Auth and snapshot data, actual binaries and migration policies but keeps key escrow separate", async fn() {
    const f = fixture(); const result = await collectProjectBackup(f.options);
    assert.equal(result.storageFiles, 1); assert.equal(result.restoreVerified, false);
    assert.ok(f.calls[2].includes("public,parsitasks_ops,auth,storage"));
    assert.ok(f.calls[2].includes("--data-only")); assert.ok(f.calls[2].includes("--use-copy"));
    assert.equal(fs.readdirSync(f.options.directory).length, 1, "authenticated encrypted backup replaces the temporary plaintext export");
    const restored = path.join(f.temporary, "unpacked");
    unpack({ file: result.output, password: f.options.password, directory: restored });
    const storage = JSON.parse(fs.readFileSync(path.join(restored, "storage/inventory.json")));
    assert.equal(fs.readFileSync(path.join(restored, storage.files[0].file), "utf8"), "image");
    assert.equal(fs.existsSync(path.join(restored, "database/migration.sql")), true);
    assert.equal(fs.existsSync(path.join(restored, "separate-key.txt")), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(restored, "coverage.json"))).restoreVerified, false);
    assert.doesNotMatch(fs.readFileSync(result.output).toString(), /private:test/);
  } },
  { name: "backup refuses repository destinations, unsafe names, changing inventories and truncated binary downloads", async fn() {
    const f = fixture();
    await assert.rejects(collectProjectBackup({ ...f.options, directory: f.options.root }), /outside the source repository/);
    const unsafe = { storage: { listBuckets: async () => ({ data: [{ id: "bucket" }] }), from: () => ({ list: async () => ({ data: [{ id: "file", name: "../private" }] }) }) } };
    await assert.rejects(inventory(unsafe), /Unsafe/);
    const corrupt = { storage: { ...f.options.client.storage, from: () => ({ list: async () => ({ data: [{ id: "file", name: "ok.png", metadata: { size: 100 } }] }), download: async () => ({ data: new Blob(["short"]) }) }) } };
    await assert.rejects(collectProjectBackup({ ...f.options, client: corrupt }), /incomplete/);
    let lists = 0;
    const changed = { storage: { ...f.options.client.storage, from: () => ({ list: async () => ({ data: [{ id: "file", name: "ok.png", updated_at: String(++lists) }] }), download: async () => ({ data: new Blob(["image"]) }) }) } };
    await assert.rejects(collectProjectBackup({ ...f.options, client: changed }), /changed during backup/);
  } },
];
