const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const advisoryUrl = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
const landingRevision = "51376b83410e0dc14cbcc68d11124064eeb6ec40";
const releaseMessage = "Release the verified Parsitasks landing page";
const blocks = (severity) => severity === "high" || severity === "critical";
const owns = (obj, name) => Object.hasOwn(obj, name);

function isPicomatch(file) {
  return /(?:^|\/)picomatch(?:\/|$)/.test(file.replaceAll("\\", "/"));
}

function proveAbsent(meta, output, entry) {
  const artifact = Object.entries(meta?.outputs || {}).find(([name]) => path.posix.basename(name.replaceAll("\\", "/")) === output)?.[1];
  if (!artifact?.entryPoint?.replaceAll("\\", "/").endsWith(entry)
    || !Object.keys(artifact.inputs || {}).length || !Object.keys(meta?.inputs || {}).length) {
    throw new Error(`Missing complete bundle metadata for ${output}`);
  }
  const modules = [...Object.keys(meta.inputs), ...Object.keys(artifact.inputs),
    ...Object.values(meta.inputs).flatMap((input) => input.imports || []).map((item) => item.path),
    ...(artifact.imports || []).map((item) => item.path)];
  if (modules.some(isPicomatch)) throw new Error(`picomatch is in the ${output} build graph`);
}

function isApprovedLandingRun(env, readEvent) {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_RUN_ATTEMPT !== "1"
    || env.GITHUB_REF !== "refs/heads/master" || env.GITHUB_REPOSITORY?.toLowerCase() !== "pars1fal0/parsitasks"
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || "")) return false;
  const event = readEvent();
  return event.ref === env.GITHUB_REF && event.after === env.GITHUB_SHA && event.before === landingRevision
    && event.forced === false && event.commits?.length === 1
    && event.commits[0].id === env.GITHUB_SHA && event.commits[0].message?.trimEnd() === releaseMessage;
}

function verifyWebAudit(report, readMetadata, allowLandingException = false) {
  const records = report?.vulnerabilities;
  const counts = report?.metadata?.vulnerabilities;
  if (report?.error || !records || !counts || report.auditReportVersion !== 2) throw new Error("Invalid npm audit report");
  const flagged = Object.entries(records).filter(([, record]) => blocks(record.severity));
  if (flagged.length !== counts.high + counts.critical) throw new Error("Inconsistent npm audit report");
  if (!flagged.length) return false;
  if (!allowLandingException) throw new Error(`Unresolved dependency advisories: ${flagged.map(([name]) => name).join(", ")}`);

  function directCauses(start) {
    const seen = new Set();
    const causes = [];
    const queue = [start];
    while (queue.length) {
      const name = queue.pop();
      if (seen.has(name)) continue;
      seen.add(name);
      if (!owns(records, name) || !Array.isArray(records[name].via)) throw new Error("Incomplete npm audit report");
      for (const issue of records[name].via) {
        if (typeof issue === "string") queue.push(issue);
        else if (blocks(issue.severity)) causes.push({ name, issue });
      }
    }
    return causes;
  }

  for (const [name, record] of flagged) {
    const causes = directCauses(name);
    if (record.severity === "critical" || !causes.length || !causes.every(({ name, issue }) =>
      name === "picomatch" && issue.dependency === "picomatch" && issue.severity === "high" && issue.url === advisoryUrl)) {
      throw new Error(`Unresolved ${record.severity} dependency advisory: ${name}`);
    }
  }

  // The one web-only exception requires fresh metadata from both build steps.
  proveAbsent(readMetadata(".wrangler-build/bundle-meta.json"), "worker.js", "mcp/worker.mjs");
  proveAbsent(readMetadata(".wrangler/web-bundle-meta.json"), "oauth-consent.js", "mcp/oauth-consent-entry.mjs");
  return true;
}

if (require.main === module) {
  try {
    const result = spawnSync(process.execPath, [process.env.npm_execpath, "audit", "--audit-level=high", "--json"], { encoding: "utf8" });
    if (result.error || ![0, 1].includes(result.status)) throw new Error("npm audit could not complete");
    const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
    const allowed = isApprovedLandingRun(process.env, () => readJson(process.env.GITHUB_EVENT_PATH));
    const excepted = verifyWebAudit(JSON.parse(result.stdout), readJson, allowed);
    if (excepted) console.warn(`Web-only exception: ${advisoryUrl}; picomatch is absent from both web bundles. Desktop audit is unchanged.`);
    else if (result.status !== 0) throw new Error("Unexpected npm audit failure");
    console.log("Web dependency audit passed.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { isApprovedLandingRun, verifyWebAudit };
