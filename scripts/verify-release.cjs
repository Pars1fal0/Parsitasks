const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const yaml = require("yaml");

function releaseChecks(root = path.resolve(__dirname, "..")) {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, ".github/workflows/verification.yml"), "utf8"));
  const checks = workflow.jobs.verify.steps.flatMap((step) => {
    if (step.run === "npm test") return [{ name: step.name, args: ["test"] }];
    const match = /^npm run ([a-z0-9:-]+)$/.exec(step.run || "");
    return match ? [{ name: step.name, args: ["run", match[1]] }] : [];
  });
  for (const script of ["test:dependencies", "test:sql-isolation", "test:e2e", "test:save-failures", "test:reliability", "build:web", "build:worker"]) {
    if (!checks.some((check) => check.args[1] === script)) throw new Error(`Missing release check: ${script}`);
  }
  return checks;
}

if (require.main === module) {
  try {
    const npm = process.env.npm_execpath;
    if (!npm || !fs.existsSync(npm)) throw new Error("Run this command through npm run verify:release");
    for (const check of releaseChecks()) {
      console.log(`Release check: ${check.name}`);
      const result = spawnSync(process.execPath, [npm, ...check.args], { cwd: path.resolve(__dirname, ".."), stdio: "inherit" });
      if (result.error || result.status !== 0) throw new Error(`Release check failed: ${check.name}`);
    }
    console.log("All release checks passed. Prepare and deploy only the sealed candidate.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { releaseChecks };
