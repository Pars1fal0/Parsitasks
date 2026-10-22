// Runs the UI suites (tests/*-e2e.cjs) in parallel. Each suite launches its own isolated
// Electron or Chrome profile, so suites do not share state.
//
//   node tests/run-e2e.cjs                 all suites
//   node tests/run-e2e.cjs board calendar  suites whose file name contains any filter
//   node tests/run-e2e.cjs --jobs 2        limit parallel suites (or E2E_JOBS=2)
//   node tests/run-e2e.cjs --shard 1/3     run every third suite, starting with the first (CI sharding)
//   node tests/run-e2e.cjs --retries 0     do not retry a failed suite (default: one retry, reported as FLAKY)
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const [value] = args.splice(index, 2).slice(1);
  return value;
};
const jobs = Math.max(1, Number(option("--jobs") || process.env.E2E_JOBS) || Math.min(4, Math.max(1, Math.floor(os.availableParallelism() / 2))));
const shard = option("--shard");
const retries = Math.max(0, Number(option("--retries") ?? process.env.E2E_RETRIES ?? 1) || 0);
const timeoutMs = Number(process.env.E2E_SUITE_TIMEOUT_MS) || 15 * 60 * 1000;
const filters = args;

let suites = fs.readdirSync(__dirname).filter((file) => file.endsWith("-e2e.cjs") && file !== path.basename(__filename)).sort();
if (filters.length) suites = suites.filter((file) => filters.some((filter) => file.includes(filter)));
if (shard) {
  const [index, total] = shard.split("/").map(Number);
  if (!(index >= 1 && index <= total)) throw new Error(`Invalid --shard ${shard}; expected N/TOTAL`);
  suites = suites.filter((_, position) => position % total === index - 1);
}
if (!suites.length) {
  console.error(`No UI suites match: ${filters.join(", ")}`);
  process.exit(1);
}

function runSuite(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, file)], { cwd: path.resolve(__dirname, ".."), env: process.env });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const timer = setTimeout(() => {
      output += `\nTimed out after ${timeoutMs / 1000}s`;
      child.kill();
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ file, ok: code === 0, seconds: Math.round((Date.now() - started) / 1000), output });
    });
  });
}

(async () => {
  // Electron installs its binary lazily. Resolve it once before parallel workers use it.
  if (suites.some((file) => /require\("electron"\)/.test(fs.readFileSync(path.join(__dirname, file), "utf8")))) {
    const executable = require("electron");
    if (!fs.existsSync(executable)) throw new Error("Electron executable is missing");
  }
  console.log(`Running ${suites.length} UI suite(s), ${jobs} at a time`);
  const started = Date.now();
  const queue = [...suites];
  const results = [];
  const flaky = [];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) {
      const file = queue.shift();
      let result = await runSuite(file);
      // Layout checks occasionally lose a race under parallel load; retry once and report it.
      for (let attempt = 0; !result.ok && attempt < retries; attempt += 1) {
        const retry = await runSuite(file);
        if (retry.ok) flaky.push({ ...result, retrySeconds: retry.seconds });
        result = retry.ok ? { ...retry, flaky: true } : retry;
      }
      results.push(result);
      console.log(`${result.ok ? (result.flaky ? "FLAKY " : "ok    ") : "FAILED"} ${result.file} (${result.seconds}s)`);
    }
  }));
  const failed = results.filter((result) => !result.ok);
  for (const result of flaky) console.error(`\n--- ${result.file} failed once, passed on retry ---\n${result.output.trim()}`);
  for (const result of failed) console.error(`\n--- ${result.file} ---\n${result.output.trim()}`);
  console.log(`\n${results.length - failed.length}/${results.length} UI suites passed in ${Math.round((Date.now() - started) / 1000)}s`);
  if (failed.length) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
