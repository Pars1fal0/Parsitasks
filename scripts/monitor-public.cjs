const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { checkAvailability } = require("./check-availability.cjs");

async function sendAlert({ webhook, event, fetchImpl = fetch }) {
  const url = new URL(webhook);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Alert webhook must be an HTTPS URL without embedded credentials");
  const text = event === "recovered" ? "Parsitasks: public service recovered"
    : event === "test" ? "Parsitasks: monitoring test notification" : "Parsitasks: public availability checks failed twice";
  try {
    const response = await fetchImpl(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text, event }) });
    if (!response.ok) throw new Error("delivery failed");
    await response.body?.cancel();
  } catch { throw new Error("Alert delivery failed; check the configured webhook"); }
}

async function monitorOnce({ previous = null, check = checkAvailability, alert, now = () => new Date().toISOString() } = {}) {
  let healthy = false;
  try { await check(); healthy = true; }
  catch { try { await check(); healthy = true; } catch { /* Confirm the outage before notifying. */ } }
  const event = !healthy && previous?.healthy !== false ? "outage" : healthy && previous?.healthy === false ? "recovered" : "none";
  if (event !== "none") await alert(event);
  return { healthy, checkedAt: now(), event };
}

async function main() {
  const webhook = process.env.PARSITASKS_INCIDENT_WEBHOOK;
  if (!webhook) throw new Error("Configure PARSITASKS_INCIDENT_WEBHOOK on an independent monitoring host");
  if (process.argv.includes("--test-alert")) { await sendAlert({ webhook, event: "test" }); console.log("Test alert delivered"); return; }
  const target = process.env.PARSITASKS_MONITOR_STATE_FILE;
  if (!target) throw new Error("Configure PARSITASKS_MONITOR_STATE_FILE outside the source repository");
  const root = path.resolve(__dirname, "..");
  const file = path.join(fs.realpathSync(path.dirname(path.resolve(target))), path.basename(target));
  const relative = path.relative(root, file);
  if (relative === "" || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) throw new Error("Keep monitor state outside the source repository");
  let previous = null;
  if (fs.existsSync(file)) {
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error("Invalid monitor state file");
    previous = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof previous?.healthy !== "boolean") throw new Error("Invalid monitor state");
  }
  const result = await monitorOnce({ previous, alert: (event) => sendAlert({ webhook, event }) });
  // Persist only after successful alert delivery, so a failed notification is retried next run.
  const temporary = file + `.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(result), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  console.log(`Public monitor: ${result.healthy ? "healthy" : "outage"}; notification ${result.event}`);
  if (!result.healthy) process.exitCode = 1;
}
module.exports = { monitorOnce, sendAlert };
if (require.main === module) main().catch(() => { console.error("Public monitoring failed. Verify state-file access and webhook delivery; no provider errors or credentials are logged."); process.exitCode = 1; });
