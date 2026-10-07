const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext();
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    const url = pathToFileURL(path.resolve(__dirname, "../app/index.html"));
    url.search = "automation=1"; url.hash = "board";
    await page.goto(url.href);
    await page.waitForSelector("#boardWorld");
    const results = await page.evaluate(async () => {
      const checks = [];
      const check = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("rhythm-board-assets-v1", 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const clear = () => new Promise((resolve, reject) => {
        const tx = db.transaction("assets", "readwrite"); tx.objectStore("assets").clear();
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      });
      await clear();
      let owner = "first", clock = Date.parse("2026-10-07T10:00:00Z"), fetches = 0;
      const config = () => ({ userId: owner, supabaseUrl: "https://synthetic.supabase.co", anonKey: "test", accessToken: "test" });
      const store = RhythmBoardAssets.createBoardAssetStore({
        getOwner: () => owner, now: () => clock, maxCacheBytes: 12, maxCacheEntries: 2,
        getRemoteConfig: async () => config(),
        fetchFn: async () => { fetches++; return new Response(new Blob(["BBBB"], { type: "image/png" })); },
      });
      const cache = (id, text) => store.put(id, new Blob([text], { type: "image/png" }), { remotePath: `${owner}/${id}.png`, cacheOnly: true });
      await cache("one", "1111"); clock++;
      await cache("two", "2222"); clock++;
      await store.get("one"); clock++;
      await cache("three", "3333");
      check("LRU removes the least recently used downloaded image", !(await store.get("two")) && Boolean(await store.get("one")) && Boolean(await store.get("three")));
      const usage = await store.pruneCache();
      check("download cache stays within its byte and entry limits", usage.bytes <= 12 && usage.entries <= 2);
      owner = "second";
      check("an asset id from another account is not a cache hit", !(await store.get("one")));
      let rejected = false;
      try { await store.resolveBlob({ assetId: "one", remotePath: "first/one.png", mime: "image/png" }); } catch { rejected = true; }
      check("foreign remote paths fail before network access", rejected && fetches === 0);
      const blob = await store.resolveBlob({ assetId: "one", remotePath: "second/one.png", mime: "image/png" });
      check("the same asset id downloads the current account's own image", await blob.text() === "BBBB" && fetches === 1);
      await clear();
      owner = "";
      await store.put("legacy", new Blob(["ONLYCOPY"], { type: "image/png" }));
      owner = "first";
      await cache("old", "old");
      clock += 31 * 86400000;
      const aged = await store.pruneCache();
      check("cache retention removes old downloads", aged.removed === 1 && !(await store.get("old")));
      check("unknown-owner legacy images are not assigned to signed-in accounts", !(await store.get("legacy")));
      owner = "";
      check("cleanup preserves the only local copy of a legacy image", await (await store.get("legacy")).blob.text() === "ONLYCOPY");
      owner = "first";
      const delayed = RhythmBoardAssets.createBoardAssetStore({
        getOwner: () => owner, getRemoteConfig: async () => config(),
        fetchFn: async () => { owner = "second"; return new Response(new Blob(["LATE"], { type: "image/png" })); },
      });
      rejected = false;
      try { await delayed.resolveBlob({ assetId: "late", remotePath: "first/late.png", mime: "image/png" }); } catch { rejected = true; }
      check("an account switch rejects a late image download and cannot cache it for the new account", rejected && !(await delayed.get("late")));
      owner = "first";
      rejected = false;
      try { await delayed.uploadPrepared("late-upload", { blob: new Blob(["image"], { type: "image/png" }), mime: "image/png" }); } catch { rejected = true; }
      check("an account switch rejects a late upload result", rejected && !(await delayed.get("late-upload")));
      owner = "first";
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = originalPut.apply(this, args);
        request.addEventListener("success", () => this.transaction.abort());
        return request;
      };
      rejected = false;
      try { await store.put("aborted", new Blob(["image"], { type: "image/png" })); } catch { rejected = true; }
      finally { IDBObjectStore.prototype.put = originalPut; }
      check("a successful request followed by transaction abort is not reported as saved", rejected && !(await store.get("aborted")));
      db.close();
      return checks;
    });
    assert.equal(results.length, 11);
    console.log(`Board cache checks passed: ${results.length}; real IndexedDB, isolated profile, no provider requests.`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
