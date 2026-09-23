const assert = require("node:assert/strict");
const { createBoardAssetStore } = require("../app/src/board/board-assets.js");

module.exports = [
  {
    name: "uploads a new board image to private Supabase Storage before creating metadata",
    async fn() {
      const calls = [];
      const store = createBoardAssetStore({
        fetchFn: async (url, options) => {
          calls.push({ url, options });
          return { ok: true, status: 200 };
        },
        getRemoteConfig: async () => ({
          accessToken: "access-token",
          anonKey: "anon-key",
          enabled: true,
          supabaseUrl: "https://project.supabase.co",
          userId: "user-id",
        }),
      });
      const blob = new Blob(["image"], { type: "image/png" });

      const path = await store.uploadPrepared("asset-id", {
        blob,
        mime: "image/png",
        name: "image.png",
      });

      assert.equal(path, "user-id/asset-id.png");
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].url,
        "https://project.supabase.co/storage/v1/object/board-images/user-id/asset-id.png",
      );
      assert.equal(calls[0].options.headers.Authorization, "Bearer access-token");
      assert.equal(calls[0].options.headers.apikey, "anon-key");
      assert.equal(calls[0].options.body, blob);
    },
  },
  {
    name: "refuses local-only image creation when cloud sync is unavailable",
    async fn() {
      const store = createBoardAssetStore({
        fetchFn: async () => ({ ok: true }),
        getRemoteConfig: async () => ({ enabled: false }),
      });

      await assert.rejects(
        store.uploadPrepared("asset-id", {
          blob: new Blob(["image"], { type: "image/png" }),
          mime: "image/png",
        }),
        /настрой Supabase/i,
      );
    },
  },
  {
    name: "explains that the board image bucket needs the current SQL schema",
    async fn() {
      const store = createBoardAssetStore({
        fetchFn: async () => ({
          ok: false,
          status: 404,
          json: async () => ({ message: "Bucket not found" }),
        }),
        getRemoteConfig: async () => ({
          accessToken: "access-token",
          anonKey: "anon-key",
          enabled: true,
          supabaseUrl: "https://project.supabase.co",
          userId: "user-id",
        }),
      });

      await assert.rejects(
        store.uploadPrepared("asset-id", {
          blob: new Blob(["image"], { type: "image/png" }),
          mime: "image/png",
        }),
        /supabase-schema\.sql/i,
      );
    },
  },
  {
    name: "downloads a private board image with auth headers and preserves its image type",
    async fn() {
      const calls = [];
      const source = new Blob(["remote-image"], { type: "image/png" });
      const store = createBoardAssetStore({
        fetchFn: async (url, options) => {
          calls.push({ url, options });
          return {
            ok: true,
            status: 200,
            headers: { get: () => "image/png" },
            blob: async () => source,
          };
        },
        getRemoteConfig: async () => ({
          accessToken: "access-token",
          anonKey: "anon-key",
          enabled: true,
          supabaseUrl: "https://project.supabase.co",
          userId: "user-id",
        }),
      });

      const blob = await store.resolveBlob({
        assetId: "asset-id",
        remotePath: "user-id/asset-id.png",
        mime: "image/png",
        name: "image.png",
      });

      assert.equal(blob.type, "image/png");
      assert.equal(blob.size, source.size);
      assert.equal(
        calls[0].url,
        "https://project.supabase.co/storage/v1/object/authenticated/board-images/user-id/asset-id.png",
      );
      assert.equal(calls[0].options.headers.Authorization, "Bearer access-token");
    },
  },
  {
    name: "rejects an empty successful response instead of rendering a broken image",
    async fn() {
      const store = createBoardAssetStore({
        fetchFn: async () => ({
          ok: true,
          status: 200,
          headers: { get: () => "image/png" },
          blob: async () => new Blob([], { type: "image/png" }),
        }),
        getRemoteConfig: async () => ({
          accessToken: "access-token",
          anonKey: "anon-key",
          enabled: true,
          supabaseUrl: "https://project.supabase.co",
          userId: "user-id",
        }),
      });

      await assert.rejects(
        store.resolveBlob({
          assetId: "asset-id",
          remotePath: "user-id/asset-id.png",
          mime: "image/png",
        }),
        /пустой файл/i,
      );
    },
  },
];
