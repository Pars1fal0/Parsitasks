const TITLE = "[Monitoring] Parsitasks availability incident";
async function updateIncident({ token, repository, runId, healthy, fetchImpl = fetch }) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository || "") || !/^\d+$/.test(String(runId))) throw new Error("Invalid incident configuration");
  const base = `https://api.github.com/repos/${repository}`;
  async function request(route, method = "GET", body) {
    const response = await fetchImpl(base + route, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!response.ok) throw new Error(`Incident API failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  }
  let issue = null;
  for (let page = 1; page <= 10; page += 1) {
    const list = await request(`/issues?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(list)) throw new Error("Invalid incident response");
    issue = list.find((item) => !item.pull_request && item.title === TITLE && item.user?.login === "github-actions[bot]");
    if (issue || list.length < 100) break;
    if (page === 10) throw new Error("Too many open issues to safely deduplicate alerts");
  }
  const runUrl = `https://github.com/${repository}/actions/runs/${runId}`;
  if (healthy) {
    if (!issue) return { action: "none" };
    await request(`/issues/${issue.number}/comments`, "POST", { body: `Public checks have recovered. [Verification run](${runUrl}). This does not confirm authenticated sync or email delivery.` });
    await request(`/issues/${issue.number}`, "PATCH", { state: "closed", state_reason: "completed" });
    return { action: "resolved" };
  }
  if (issue) return { action: "already-open" };
  await request("/issues", "POST", { title: TITLE, body: `Public availability checks failed twice. [Review the workflow run](${runUrl}).\n\nNo user content, account identifiers, credentials or raw provider errors are included. Investigate before rolling back; keep database security migrations in place.` });
  return { action: "opened" };
}
module.exports = { updateIncident };
if (require.main === module) updateIncident({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY,
  runId: process.env.GITHUB_RUN_ID, healthy: process.env.PARSITASKS_HEALTHY === "true" })
  .then((result) => console.log(`incident ${result.action}`)).catch((error) => { console.error(error.message); process.exitCode = 1; });
