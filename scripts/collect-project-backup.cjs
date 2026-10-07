const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { seal } = require("./backup-bundle.cjs");

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
async function inventory(client) {
  const { data: buckets, error } = await client.storage.listBuckets();
  if (error || !Array.isArray(buckets)) throw new Error("Storage bucket inventory failed");
  const files = [];
  for (const bucket of buckets) {
    const folders = [""];
    for (let index = 0; index < folders.length; index++) {
      if (folders.length > 10000 || files.length > 10000) throw new Error("Storage inventory exceeds backup limits");
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await client.storage.from(bucket.id).list(folders[index], { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
        if (error || !Array.isArray(data) || data.length > 100) throw new Error("Storage file inventory failed");
        for (const item of data) {
          if (typeof item.name !== "string" || !item.name || /[\/\\\0]/.test(item.name) || [".", ".."].includes(item.name)) throw new Error("Unsafe Storage inventory path");
          const name = [folders[index], item.name].filter(Boolean).join("/");
          if (!item.id) folders.push(name);
          else files.push({ bucket: bucket.id, path: name, id: item.id, updatedAt: item.updated_at || "",
            bytes: Number(item.metadata?.size) || 0, mime: item.metadata?.mimetype || "application/octet-stream" });
        }
        if (data.length < 100) break;
      }
    }
  }
  files.sort((a, b) => `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`));
  return { buckets, files };
}

async function collectProjectBackup({ directory, dbUrl, client, password, providerSettingsFile, keyEscrowFile,
  root = path.resolve(__dirname, ".."), dump = (args) => {
    try { execFileSync("supabase", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 300000, windowsHide: true }); }
    catch { throw new Error("Supabase database export failed; inspect the local CLI configuration without sharing credentials"); }
  } }) {
  if (!/^postgres(?:ql)?:\/\//.test(dbUrl || "") || !client || !password || password.length < 32) throw new Error("Configure database access, privileged Storage access and a separate 32-character backup passphrase");
  const destination = fs.realpathSync(directory);
  const repository = fs.realpathSync(root);
  const relative = path.relative(repository, destination);
  if (!relative || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) throw new Error("Backup destination must be outside the source repository");
  for (const file of [providerSettingsFile, keyEscrowFile]) {
    if (!file || fs.lstatSync(file).isSymbolicLink() || !fs.lstatSync(file).isFile()) throw new Error("Provide provider settings and independent Google-key escrow files");
  }
  const providerSettings = fs.readFileSync(providerSettingsFile);
  JSON.parse(providerSettings.toString("utf8"));
  const escrow = fs.readFileSync(keyEscrowFile);
  if (escrow.toString("utf8").trim().length < 32) throw new Error("Google encryption key escrow is incomplete");
  const exportRoot = fs.mkdtempSync(path.join(destination, "parsitasks-export-"));
  const output = path.join(destination, `parsitasks-${crypto.randomUUID()}.parsibak`);
  const write = (name, value) => {
    const target = path.join(exportRoot, name); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, value, { flag: "wx", mode: 0o600 });
  };
  let bytes = providerSettings.length;
  const before = await inventory(client);
  if (before.files.reduce((sum, item) => sum + item.bytes, bytes) > MAX_SOURCE_BYTES) throw new Error("Storage exceeds the supported encrypted-bundle budget; use an external backup service");
  for (const [file, flags] of [
    ["roles.sql", ["--role-only"]],
    ["schema.sql", ["--schema", "public,parsitasks_ops"]],
    ["data.sql", ["--data-only", "--use-copy", "--schema", "public,parsitasks_ops,auth,storage"]],
  ]) {
    await dump(["db", "dump", "--db-url", dbUrl, "--file", path.join(exportRoot, file), ...flags]);
    const stat = fs.lstatSync(path.join(exportRoot, file));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error("Database export is missing or empty");
    bytes += stat.size;
    if (bytes > MAX_SOURCE_BYTES) throw new Error("Database export exceeds backup budget");
  }
  const storageFiles = [];
  for (const item of before.files) {
    const { data, error } = await client.storage.from(item.bucket).download(item.path);
    if (error || !data) throw new Error("Storage binary download failed");
    const body = Buffer.from(await data.arrayBuffer()); bytes += body.length;
    if (bytes > MAX_SOURCE_BYTES || (item.bytes && body.length !== item.bytes)) throw new Error("Storage binary is incomplete or exceeds backup budget");
    const file = `storage/${sha(`${item.bucket}/${item.path}`)}.bin`;
    write(file, body); storageFiles.push({ ...item, file, bytes: body.length, sha256: sha(body) });
  }
  const after = await inventory(client);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Storage changed during backup; repeat during a maintenance window");
  write("storage/inventory.json", JSON.stringify({ buckets: before.buckets, files: storageFiles }));
  write("provider-settings.json", providerSettings);
  for (const file of fs.readdirSync(path.join(root, "database")).filter((name) => name.endsWith(".sql"))) {
    write(`database/${file}`, fs.readFileSync(path.join(root, "database", file)));
  }
  write("coverage.json", JSON.stringify({ format: "parsitasks-project-export-v1", createdAt: new Date().toISOString(),
    databaseSchemas: ["public", "parsitasks_ops", "auth", "storage"], storageFiles: storageFiles.length,
    googleKeyEscrowSha256: sha(escrow), restoreVerified: false,
    notes: "Managed schema customizations must be reapplied from the included migrations. Keep key escrow and the encrypted copy off-site. Restore into a separate project before marking recovery verified." }));
  const result = seal({ directory: exportRoot, output, password, scope: "Database roles, application schema, public/auth/storage data, Storage binaries, migration SQL and provider settings. Google token key retained separately. No restore drill performed." });
  // Remove only this invocation's newly created export after authenticating the encrypted bundle.
  if (fs.realpathSync(exportRoot) !== exportRoot || path.dirname(exportRoot) !== destination) throw new Error("Backup cleanup path changed; plaintext export was preserved");
  fs.rmSync(exportRoot, { recursive: true });
  return { ...result, output, storageFiles: storageFiles.length, restoreVerified: false };
}

module.exports = { collectProjectBackup, inventory };
if (require.main === module) {
  const { createClient } = require("@supabase/supabase-js");
  const url = process.env.PARSITASKS_BACKUP_SUPABASE_URL;
  const key = process.env.PARSITASKS_BACKUP_SERVICE_KEY;
  if (!/^https:\/\/[^/]+\.supabase\.co$/.test(url || "") || !key) {
    console.error("Configure a Supabase URL and privileged read credentials locally, never in chat or Git."); process.exitCode = 1;
  } else collectProjectBackup({ directory: process.env.PARSITASKS_BACKUP_DIRECTORY,
    dbUrl: process.env.PARSITASKS_BACKUP_DB_URL, password: process.env.PARSITASKS_BACKUP_PASSPHRASE,
    providerSettingsFile: process.env.PARSITASKS_BACKUP_PROVIDER_SETTINGS_FILE,
    keyEscrowFile: process.env.PARSITASKS_GOOGLE_KEY_ESCROW_FILE,
    client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  }).then((result) => console.log(JSON.stringify(result))).catch(() => {
    console.error("Project backup failed. Check local configuration and the new export directory for partial plaintext exports. No credentials or provider responses are logged."); process.exitCode = 1;
  });
}
