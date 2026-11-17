const assert = require("node:assert/strict");
const { isApprovedLandingRun, verifyWebAudit } = require("../scripts/verify-web-audit.cjs");

const advisory = {
  dependency: "picomatch",
  severity: "high",
  url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
};
const records = () => ({
  picomatch: { severity: "high", via: [{ ...advisory }] },
  parent: { severity: "high", via: ["picomatch"] },
});
const report = (vulnerabilities = records()) => ({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: { vulnerabilities: {
    high: Object.values(vulnerabilities).filter((r) => r.severity === "high").length,
    critical: Object.values(vulnerabilities).filter((r) => r.severity === "critical").length,
  } },
});
const worker = ".wrangler-build/bundle-meta.json";
const checkLandingAudit = (audit, readMeta) => verifyWebAudit(audit, readMeta, true);
function metadata(file) {
  const entryPoint = file === worker ? "mcp/worker.mjs" : "mcp/oauth-consent-entry.mjs";
  const output = file === worker ? "worker.js" : "oauth-consent.js";
  return { inputs: { [entryPoint]: { imports: [] } }, outputs: {
    ["out/" + output]: { entryPoint, inputs: { [entryPoint]: { bytesInOutput: 256 } }, imports: [] },
  } };
}

module.exports = [
  { name: "limits the exception to one exact master push on its first run", fn() {
    const head = "a".repeat(40);
    const env = {
      GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push", GITHUB_RUN_ATTEMPT: "1",
      GITHUB_REF: "refs/heads/master", GITHUB_REPOSITORY: "Pars1fal0/Parsitasks", GITHUB_SHA: head,
    };
    const event = {
      ref: env.GITHUB_REF, before: "51376b83410e0dc14cbcc68d11124064eeb6ec40", after: head, forced: false,
      commits: [{ id: head, message: "Release the verified Parsitasks landing page" }],
    };
    assert.equal(isApprovedLandingRun(env, () => event), true);
    for (const other of [{ GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_EVENT_NAME: "workflow_dispatch" },
      { GITHUB_REF: "refs/heads/other" }, { GITHUB_REPOSITORY: "someone/Parsitasks" }]) {
      assert.equal(isApprovedLandingRun({ ...env, ...other }, () => event), false);
    }
    assert.equal(isApprovedLandingRun(env, () => ({ ...event, before: "b".repeat(40) })), false);
    assert.equal(isApprovedLandingRun(env, () => ({ ...event, forced: true })), false);
    assert.throws(() => verifyWebAudit(report(), metadata), /Unresolved dependency advisories/);
  } },
  { name: "allows only the known build-time picomatch advisory in bundles that do not use it", fn() {
    assert.equal(checkLandingAudit(report(), metadata), true);
    assert.equal(verifyWebAudit(report({}), () => assert.fail("Clean audit needs no exception")), false);
  } },
  { name: "fails closed when either build uses picomatch or lacks input metadata", fn() {
    for (const file of [worker, ".wrangler/web-bundle-meta.json"]) {
      assert.throws(() => checkLandingAudit(report(), (name) => {
        const meta = metadata(name);
        if (name === file) meta.inputs["node_modules\\picomatch\\index.js"] = {};
        return meta;
      }), /picomatch is in/);
    }
    assert.throws(() => checkLandingAudit(report(), () => ({})), /Missing complete bundle metadata/);
    assert.throws(() => checkLandingAudit(report(), (name) => {
      const meta = metadata(name);
      Object.values(meta.outputs)[0].imports.push({ path: "picomatch", external: true });
      return meta;
    }), /picomatch is in/);
  } },
  { name: "blocks new, more severe, and incomplete npm advisories", fn() {
    const data = records();
    data.picomatch.via.push({ ...advisory, url: advisory.url + "-different" });
    assert.throws(() => checkLandingAudit(report(data), metadata), /Unresolved high/);
    data.picomatch.via.pop();
    data.parent.severity = "critical";
    assert.throws(() => checkLandingAudit(report(data), metadata), /Unresolved critical/);
    data.parent.via.push("missing");
    assert.throws(() => checkLandingAudit(report(data), metadata), /Incomplete npm audit report/);
    assert.throws(() => verifyWebAudit({ error: {} }, metadata), /Invalid npm audit report/);
  } },
];
