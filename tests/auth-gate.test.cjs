const assert = require("node:assert/strict");
const authGate = require("../src/auth/auth-gate.js");

function storage(value) {
  return { getItem: () => value };
}

module.exports = [
  {
    name: "recognizes only a usable stored account session",
    fn() {
      assert.equal(authGate.hasStoredSession(storage(JSON.stringify({ access_token: "jwt", user: { id: "user-1" } }))), true);
      assert.equal(authGate.hasStoredSession(storage(JSON.stringify({ access_token: "jwt", user: {} }))), false);
      assert.equal(authGate.hasStoredSession(storage("broken json")), false);
    },
  },
  {
    name: "sends web and desktop guests to the separate auth page",
    fn() {
      assert.equal(
        authGate.authTarget({ hash: "#calendar/week", protocol: "https:" }),
        "/auth?next=%2Fapp%23calendar%2Fweek",
      );
      assert.equal(
        authGate.authTarget({ hash: "#timeline", protocol: "file:" }),
        "auth.html?next=index.html%23timeline",
      );
    },
  },
  {
    name: "keeps recovery tokens in the URL fragment while moving to auth",
    fn() {
      const hash = "#access_token=secret&type=recovery";
      assert.equal(authGate.authTarget({ hash, protocol: "https:" }), `/auth${hash}`);
      assert.equal(authGate.authTarget({ hash, protocol: "file:" }), `auth.html${hash}`);
    },
  },
];
