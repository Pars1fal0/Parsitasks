async function resolveRollback({ token, repository, runId, fetchImpl = fetch }) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository || "") || !/^[1-9]\d{0,19}$/.test(String(runId))) throw new Error("Invalid rollback configuration");
  const base = `https://api.github.com/repos/${repository}`;
  const get = async (route) => {
    const response = await fetchImpl(base + route, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!response.ok) throw new Error(`Rollback metadata unavailable (${response.status})`);
    return response.json();
  };
  const run = await get(`/actions/runs/${runId}`);
  if (run.status !== "completed" || run.conclusion !== "success" || run.head_branch !== "master"
    || run.path !== ".github/workflows/verification.yml" || !["push", "workflow_dispatch"].includes(run.event)
    || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository
    || !/^[a-f0-9]{40}$/.test(run.head_sha || "")) throw new Error("Rollback requires a successful trusted master verification run");
  const list = await get(`/actions/runs/${runId}/artifacts?per_page=100`);
  if (!Array.isArray(list.artifacts) || list.total_count > 100) throw new Error("Invalid rollback artifact list");
  const artifacts = list.artifacts.filter((item) => item.name === `verified-web-${run.head_sha}` && !item.expired);
  if (artifacts.length !== 1 || !Number.isSafeInteger(artifacts[0].id) || artifacts[0].id <= 0
    || !/^sha256:[a-f0-9]{64}$/.test(artifacts[0].digest || "")) throw new Error("No unique retained verified rollback artifact");
  return { revision: run.head_sha, artifactId: artifacts[0].id, digest: artifacts[0].digest };
}
module.exports = { resolveRollback };
if (require.main === module) resolveRollback({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY, runId: process.env.PARSITASKS_ROLLBACK_RUN_ID })
  .then((result) => {
    require("node:fs").appendFileSync(process.env.GITHUB_OUTPUT, `revision=${result.revision}\nartifact_id=${result.artifactId}\nartifact_digest=${result.digest}\n`);
    console.log(`rollback candidate selected - ${result.revision}`);
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
