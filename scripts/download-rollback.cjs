const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

async function downloadRollback({ repository, artifactId, digest, token, output, fetchImpl = fetch }) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository || "") || !/^[1-9]\d{0,19}$/.test(String(artifactId))
    || !/^sha256:[a-f0-9]{64}$/.test(digest || "")) throw new Error("Invalid rollback download configuration");
  let response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}/zip`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, redirect: "manual", signal: AbortSignal.timeout(15000) });
  if (response.status === 302) {
    let location;
    try { location = new URL(response.headers.get("location")); } catch { throw new Error("Invalid artifact redirect"); }
    if (location.protocol !== "https:" || location.username || location.password) throw new Error("Unsafe artifact redirect");
    // Do not forward the repository token to the signed blob URL.
    response = await fetchImpl(location.href, { redirect: "error", signal: AbortSignal.timeout(60000) });
  }
  if (!response.ok || !response.body) throw new Error("Verified artifact download failed");
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 100 * 1024 * 1024) throw new Error("Rollback artifact exceeds supported size");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (`sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}` !== digest) throw new Error("Rollback artifact digest mismatch");
  fs.writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
  return { bytes: size };
}
function checkArchive(output) {
  const names = execFileSync("unzip", ["-Z1", output], { encoding: "utf8", maxBuffer: 1024 * 1024 }).trim().split("\n");
  if (!names.length || names.length > 4096 || names.some((name) => !/^[a-zA-Z0-9_./-]+$/.test(name) || name.startsWith("/")
    || name.replace(/\/$/, "").split("/").some((part) => !part || [".", ".."].includes(part)))) throw new Error("Unsafe rollback archive paths");
}
module.exports = { downloadRollback, checkArchive };
if (require.main === module) downloadRollback({ repository: process.env.GITHUB_REPOSITORY, artifactId: process.env.PARSITASKS_ARTIFACT_ID,
  digest: process.env.PARSITASKS_ARTIFACT_DIGEST, token: process.env.GITHUB_TOKEN, output: ".rollback-artifact.zip" })
  .then(() => { checkArchive(".rollback-artifact.zip"); console.log("rollback archive digest and paths verified"); })
  .catch(() => { console.error("Rollback archive verification failed; deployment stopped"); process.exitCode = 1; });
