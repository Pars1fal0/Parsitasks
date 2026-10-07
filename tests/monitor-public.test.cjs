const assert = require("node:assert/strict");
const { monitorOnce, sendAlert } = require("../scripts/monitor-public.cjs");
module.exports = [
  { name: "independent monitoring confirms outages and reports only state transitions", async fn() {
    let calls = 0; const alerts = [];
    const down = () => { calls++; throw new Error("private provider details"); };
    const result = await monitorOnce({ check: down, alert: (event) => alerts.push(event) });
    assert.equal(calls, 2); assert.equal(result.healthy, false); assert.deepEqual(alerts, ["outage"]);
    await monitorOnce({ previous: result, check: down, alert: (event) => alerts.push(event) });
    assert.deepEqual(alerts, ["outage"]);
    await monitorOnce({ previous: result, check: async () => {}, alert: (event) => alerts.push(event) });
    assert.deepEqual(alerts, ["outage", "recovered"]);
    assert.doesNotMatch(JSON.stringify(result), /private/);
  } },
  { name: "transient failures do not raise alerts and failed notification delivery remains retryable", async fn() {
    let checks = 0;
    assert.equal((await monitorOnce({ check: () => { if (++checks === 1) throw new Error(); }, alert: () => { throw new Error("must not alert"); } })).healthy, true);
    await assert.rejects(monitorOnce({ check: () => { throw new Error(); }, alert: () => { throw new Error("delivery failed"); } }), /delivery failed/);
  } },
  { name: "webhook alerts contain only constant public status and never follow redirects", async fn() {
    await sendAlert({ webhook: "https://example.test/private-webhook", event: "outage", fetchImpl: async (url, init) => {
      assert.equal(init.redirect, "error"); assert.equal(JSON.parse(init.body).event, "outage");
      assert.doesNotMatch(init.body, /private-webhook/); return new Response(null, { status: 204 });
    } });
    await assert.rejects(sendAlert({ webhook: "http://example.test", event: "test" }), /HTTPS/);
    await assert.rejects(sendAlert({ webhook: "https://example.test/secret", fetchImpl: () => { throw new Error("secret private provider error"); } }), /^Error: Alert delivery failed/);
  } },
];
