const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const MAGIC = Buffer.from("PARSIBAK1");
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_FILES = 10000;
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function safeName(name) {
  return typeof name === "string" && name.length <= 1024 && !name.includes("\\")
    && name.split("/").every((part) => part && ![".", ".."].includes(part)
      && !/[\x00-\x1f:<>"|?*]/.test(part) && !/[. ]$/.test(part)
      && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
function keyFor(password, salt) {
  if (typeof password !== "string" || password.length < 32) throw new Error("Backup passphrase must have at least 32 characters");
  return crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
function collect(directory, prefix = "", result = [], total = { bytes: 0 }) {
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("Backup symlinks are not allowed");
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    if (!safeName(name) || entry.isSymbolicLink()) throw new Error("Unsafe backup input path");
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file, name + "/", result, total);
    else {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || total.bytes + stat.size > MAX_BYTES || result.length >= MAX_FILES) throw new Error("Backup input exceeds supported limits");
      const bytes = fs.readFileSync(file);
      total.bytes += bytes.length;
      if (total.bytes > MAX_BYTES) throw new Error("Backup input changed beyond supported limits");
      result.push({ name, bytes: bytes.length, sha256: sha(bytes), data: bytes.toString("base64") });
    }
  }
  return result;
}
function seal({ directory, output, password, scope }) {
  const input = fs.realpathSync(directory);
  const target = path.resolve(output);
  const parent = fs.realpathSync(path.dirname(target));
  const relative = path.relative(input, path.join(parent, path.basename(target)));
  if (!relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Backup output must be outside its input directory");
  if (typeof scope !== "string" || !scope.trim() || scope.length > 1000) throw new Error("Declare the backup scope and exclusions");
  const files = collect(input);
  if (!files.length) throw new Error("Backup input is empty");
  const payload = Buffer.from(JSON.stringify({ format: "parsitasks-backup-v1", createdAt: new Date().toISOString(), scope, files }));
  if (payload.length > MAX_BYTES) throw new Error("Encoded backup exceeds 128 MiB");
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const key = keyFor(password, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const header = Buffer.concat([MAGIC, salt, iv]); cipher.setAAD(header);
  let encrypted;
  try { encrypted = Buffer.concat([header, cipher.update(zlib.gzipSync(payload)), cipher.final(), cipher.getAuthTag()]); }
  finally { key.fill(0); }
  fs.writeFileSync(path.join(parent, path.basename(target)), encrypted, { flag: "wx", mode: 0o600 });
  const result = verify({ file: target, password });
  return { ...result, encryptedSha256: sha(encrypted) };
}
function open({ file, password }) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_BYTES + 1024 * 1024 || stat.size < 54) throw new Error("Invalid backup file");
  const bytes = fs.readFileSync(file);
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Unsupported backup format");
  const headerEnd = MAGIC.length + 28;
  const key = keyFor(password, bytes.subarray(MAGIC.length, MAGIC.length + 16));
  let payload;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(MAGIC.length + 16, headerEnd));
    decipher.setAAD(bytes.subarray(0, headerEnd)); decipher.setAuthTag(bytes.subarray(-16));
    const compressed = Buffer.concat([decipher.update(bytes.subarray(headerEnd, -16)), decipher.final()]);
    payload = JSON.parse(zlib.gunzipSync(compressed, { maxOutputLength: MAX_BYTES }).toString("utf8"));
  } catch { throw new Error("Backup cannot be authenticated or decoded"); }
  finally { key.fill(0); }
  if (payload?.format !== "parsitasks-backup-v1" || typeof payload.scope !== "string" || !payload.scope.trim()
    || !Array.isArray(payload.files) || !payload.files.length || payload.files.length > MAX_FILES) throw new Error("Invalid backup manifest");
  const names = new Set(); let total = 0;
  for (const item of payload.files) {
    if (!safeName(item.name) || names.has(item.name.toLowerCase()) || typeof item.data !== "string"
      || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error("Invalid backup entry");
    const body = Buffer.from(item.data, "base64");
    total += body.length;
    if (total > MAX_BYTES || body.length !== item.bytes || sha(body) !== item.sha256 || body.toString("base64") !== item.data) throw new Error("Backup file integrity failed");
    names.add(item.name.toLowerCase());
  }
  return payload;
}
function verify(options) {
  const payload = open(options);
  return { format: payload.format, createdAt: payload.createdAt, scope: payload.scope,
    files: payload.files.length, bytes: payload.files.reduce((sum, item) => sum + item.bytes, 0) };
}
function unpack({ file, password, directory }) {
  const payload = open({ file, password });
  const output = path.resolve(directory);
  const parent = fs.realpathSync(path.dirname(output));
  const target = path.join(parent, path.basename(output));
  if (fs.existsSync(target)) throw new Error("Restore output must be a new directory");
  // Only extract into a newly created local directory; never connect to a database.
  fs.mkdirSync(target, { mode: 0o700 });
  for (const item of payload.files) {
    const destination = path.resolve(target, ...item.name.split("/"));
    if (!destination.startsWith(target + path.sep)) throw new Error("Unsafe restore path");
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, Buffer.from(item.data, "base64"), { flag: "wx", mode: 0o600 });
  }
  return { files: payload.files.length, databaseRestored: false };
}
function main() {
  const [command, ...args] = process.argv.slice(2);
  const option = (name) => { const index = args.indexOf(name); if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`); return args[index + 1]; };
  const password = process.env.PARSITASKS_BACKUP_PASSPHRASE;
  const result = command === "seal" ? seal({ directory: option("--input"), output: option("--output"), scope: option("--scope"), password })
    : command === "verify" ? verify({ file: option("--file"), password })
    : command === "unpack" ? unpack({ file: option("--file"), directory: option("--output"), password })
    : (() => { throw new Error("Use seal, verify or unpack"); })();
  console.log(`backup ${command} ok - ${JSON.stringify(result)}`);
}
module.exports = { seal, verify, unpack, safeName };
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
