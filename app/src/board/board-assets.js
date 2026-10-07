(function (global) {
  const DB_NAME = "rhythm-board-assets-v1";
  const STORE_NAME = "assets";
  const BUCKET = "board-images";
  const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
  const MAX_DIMENSION = 2200;
  const MAX_CACHE_BYTES = 64 * 1024 * 1024;
  const MAX_CACHE_ENTRIES = 200;
  const CACHE_RETENTION_MS = 30 * 86400000;
  const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

  function createBoardAssetStore(options = {}) {
    const fetchFn = options.fetchFn || global.fetch?.bind(global);
    const now = options.now || Date.now;
    const cacheOwner = () => String(options.getOwner?.() || "");
    const cacheKey = (id, owner) => owner ? JSON.stringify([owner, String(id)]) : String(id);
    let dbPromise = null;

    function openDb() {
      if (!global.indexedDB) return Promise.reject(new Error("Хранилище изображений недоступно"));
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const request = global.indexedDB.open(DB_NAME, 1);
        let abandoned = false;
        const fail = (error) => { abandoned = true; global.clearTimeout(timer); reject(error); };
        const timer = global.setTimeout(() => fail(new Error("Хранилище изображений не отвечает. Повтори попытку")), 10000);
        request.onupgradeneeded = () => {
          if (abandoned) { request.transaction.abort(); return; }
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
          }
        };
        request.onsuccess = () => {
          global.clearTimeout(timer);
          if (abandoned) { request.result.close(); return; }
          request.result.onversionchange = () => { request.result.close(); dbPromise = null; };
          resolve(request.result);
        };
        request.onerror = () => fail(request.error || new Error("Не удалось открыть хранилище изображений"));
        request.onblocked = () => fail(new Error("Хранилище изображений занято другой вкладкой. Закрой старую вкладку и повтори попытку"));
      });
      const pending = dbPromise;
      pending.catch(() => { if (dbPromise === pending) dbPromise = null; });
      return dbPromise;
    }

    async function put(id, blob, meta = {}, owner = cacheOwner()) {
      const db = await openDb();
      assertOwner(owner);
      if (meta.cacheOnly) await pruneCache({ reserveBytes: blob.size, reserveEntries: 1 });
      assertOwner(owner);
      await transaction(db, "readwrite", (store) => store.put({
        id: cacheKey(id, owner),
        assetId: id,
        owner,
        blob,
        mime: blob.type || meta.mime || "image/jpeg",
        name: String(meta.name || ""),
        remotePath: String(meta.remotePath || ""),
        cacheOnly: meta.cacheOnly === true && Boolean(meta.remotePath),
        updatedAt: new Date(now()).toISOString(),
        lastAccessedAt: now(),
      }));
      if (meta.cacheOnly) await pruneCache();
      return { id, blob };
    }

    async function get(id, owner = cacheOwner()) {
      const db = await openDb();
      const key = cacheKey(id, owner);
      const row = await transaction(db, "readwrite", (store) => {
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result?.cacheOnly) store.put({ ...request.result, lastAccessedAt: now() });
        };
        return request;
      }).catch(() => transaction(db, "readonly", (store) => store.get(key)));
      assertOwner(owner);
      return row;
    }

    async function remove(id, owner = cacheOwner()) {
      const db = await openDb();
      assertOwner(owner);
      await transaction(db, "readwrite", (store) => store.delete(cacheKey(id, owner)));
    }

    async function pruneCache({ reserveBytes = 0, reserveEntries = 0 } = {}) {
      const db = await openDb();
      const byteLimit = Math.max(0, (options.maxCacheBytes ?? MAX_CACHE_BYTES) - reserveBytes);
      const entryLimit = Math.max(0, (options.maxCacheEntries ?? MAX_CACHE_ENTRIES) - reserveEntries);
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const rows = [];
        let bytes = 0, entries = 0, removed = 0;
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const row = cursor.value;
            const size = Number(row.blob?.size) || 0;
            bytes += size; entries++;
            if (row.cacheOnly === true && row.remotePath && typeof row.owner === "string") {
              rows.push({ id: cursor.primaryKey, bytes: size, accessed: Number(row.lastAccessedAt) || Date.parse(row.updatedAt) || 0 });
            }
            cursor.continue();
            return;
          }
          rows.sort((a, b) => a.accessed - b.accessed || String(a.id).localeCompare(String(b.id)));
          for (const row of rows) {
            if (bytes <= byteLimit && entries <= entryLimit && now() - row.accessed < CACHE_RETENTION_MS) continue;
            store.delete(row.id); bytes -= row.bytes; entries--; removed++;
          }
        };
        tx.oncomplete = () => resolve({ bytes, entries, removed });
        tx.onerror = tx.onabort = () => reject(tx.error || new Error("Не удалось очистить кеш изображений"));
      });
    }

    function assertOwner(owner) {
      if (owner !== cacheOwner()) throw new Error("Аккаунт изменился. Открой изображение заново");
    }

    function assertRemotePath(config, path) {
      const parts = String(path || "").split("/");
      if (parts[0] !== config.userId || parts.length < 2 || parts.some((part) => !part || [".", ".."].includes(part) || /[\\\0]/.test(part))) {
        throw new Error("Изображение принадлежит другому аккаунту или содержит неверный путь");
      }
    }

    async function prepareImage(file) {
      if (!file || !ALLOWED_MIME_TYPES.has(String(file.type || "").toLowerCase())) {
        throw new Error("Поддерживаются JPG, PNG, WebP и GIF");
      }
      if (file.size > MAX_SOURCE_BYTES) throw new Error("Изображение больше 12 МБ");
      const decoded = await decodeImage(file);
      const scale = Math.min(1, MAX_DIMENSION / Math.max(decoded.width, decoded.height));
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const shouldCompress = scale < 1 || file.size > 3 * 1024 * 1024;
      if (!shouldCompress) {
        decoded.close?.();
        return { blob: file, width, height, mime: file.type, name: file.name || "Изображение" };
      }

      const canvas = global.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      context.drawImage(decoded, 0, 0, width, height);
      decoded.close?.();
      const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, mime === "image/jpeg" ? 0.86 : undefined));
      if (!blob) throw new Error("Не удалось подготовить изображение");
      return { blob, width, height, mime, name: file.name || "Изображение" };
    }

    async function resolveBlob(item) {
      const owner = cacheOwner();
      const local = await get(item.assetId, owner).catch(() => null);
      assertOwner(owner);
      if (isUsableImageBlob(local?.blob, local?.mime || item.mime) && (!item.remotePath || local.remotePath === item.remotePath)) {
        return normalizeBlobType(local.blob, local?.mime || item.mime);
      }
      if (local && !isUsableImageBlob(local.blob, local.mime)) await remove(item.assetId, owner).catch(() => {});
      if (!item.remotePath) return null;
      const config = await getRemoteConfig();
      assertOwner(owner);
      if (!config || !fetchFn) return null;
      assertRemotePath(config, item.remotePath);
      const response = await fetchFn(storageUrl(config.supabaseUrl, "object/authenticated", item.remotePath), {
        headers: storageHeaders(config),
      });
      if (!response.ok) throw new Error(await storageError(response, response.status));
      const responseType = response.headers?.get?.("content-type") || "";
      const downloaded = await response.blob();
      assertOwner(owner);
      const blob = normalizeBlobType(downloaded, responseType || item.mime);
      if (!isUsableImageBlob(blob, responseType || item.mime)) {
        throw new Error("Supabase вернул повреждённый или пустой файл изображения");
      }
      await put(item.assetId, blob, { mime: blob.type || item.mime, name: item.name, remotePath: item.remotePath, cacheOnly: true }, owner).catch(() => {});
      assertOwner(owner);
      return blob;
    }

    async function upload(item) {
      if (item.remotePath || !fetchFn) return item.remotePath || "";
      const owner = cacheOwner();
      const local = await get(item.assetId, owner).catch(() => null);
      assertOwner(owner);
      if (!local?.blob) return "";
      const config = await requireRemoteConfig();
      assertOwner(owner);
      const path = await uploadBlob(config, item.assetId, local.blob, local.mime || item.mime);
      assertOwner(owner);
      return path;
    }

    async function uploadPrepared(assetId, prepared) {
      const owner = cacheOwner();
      if (!isUsableImageBlob(prepared?.blob, prepared?.mime)) {
        throw new Error("Не удалось подготовить изображение");
      }
      const config = await requireRemoteConfig();
      assertOwner(owner);
      const path = await uploadBlob(config, assetId, prepared.blob, prepared.mime);
      assertOwner(owner);
      await put(assetId, prepared.blob, { ...prepared, remotePath: path, cacheOnly: true }, owner).catch(() => {});
      assertOwner(owner);
      return path;
    }

    async function uploadBlob(config, assetId, blob, mime) {
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(assetId)) throw new Error("Неверный идентификатор изображения");
      const extension = extensionForMime(mime);
      const path = `${config.userId}/${assetId}.${extension}`;
      let response;
      try {
        response = await fetchFn(storageUrl(config.supabaseUrl, "object", path), {
          method: "POST",
          headers: {
            ...storageHeaders(config),
            "Content-Type": mime || "image/jpeg",
            "x-upsert": "true",
          },
          body: blob,
        });
      } catch {
        throw new Error("Нет связи с Supabase — изображение не загружено");
      }
      if (!response.ok) throw new Error(await storageError(response, response.status));
      return path;
    }

    async function getRemoteConfig() {
      const config = await options.getRemoteConfig?.();
      if (!config?.supabaseUrl || !config?.anonKey || !config?.accessToken || !config?.userId) return null;
      return {
        supabaseUrl: String(config.supabaseUrl).replace(/\/+$/, ""),
        anonKey: String(config.anonKey),
        accessToken: String(config.accessToken),
        userId: String(config.userId),
        enabled: config.enabled !== false,
      };
    }

    async function requireRemoteConfig() {
      if (!fetchFn) throw new Error("Сеть недоступна — изображение не загружено");
      const raw = await options.getRemoteConfig?.();
      if (!raw?.supabaseUrl || !raw?.anonKey) {
        throw new Error("Сначала настрой Supabase в разделе «Настройки»");
      }
      if (raw.enabled === false) {
        throw new Error("Включи синхронизацию устройств, чтобы загружать изображения");
      }
      if (!raw?.accessToken || !raw?.userId) {
        throw new Error("Войди в аккаунт синхронизации, чтобы загружать изображения");
      }
      return {
        supabaseUrl: String(raw.supabaseUrl).replace(/\/+$/, ""),
        anonKey: String(raw.anonKey),
        accessToken: String(raw.accessToken),
        userId: String(raw.userId),
        enabled: true,
      };
    }

    return {
      prepareImage,
      getOwner: cacheOwner,
      get,
      pruneCache,
      put,
      remove,
      resolveBlob,
      upload,
      uploadPrepared,
    };
  }

  function transaction(db, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = action(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Ошибка локального хранилища"));
      tx.onerror = () => reject(tx.error || new Error("Ошибка локального хранилища"));
      tx.onabort = () => reject(tx.error || new Error("Операция хранения отменена"));
    });
  }

  async function decodeImage(file) {
    if (global.createImageBitmap) return global.createImageBitmap(file);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function storageUrl(base, route, path) {
    return `${base}/storage/v1/${route}/${BUCKET}/${String(path).split("/").map(encodeURIComponent).join("/")}`;
  }

  function storageHeaders(config) {
    return {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.accessToken}`,
    };
  }

  function extensionForMime(mime) {
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    if (mime === "image/gif") return "gif";
    return "jpg";
  }

  function isUsableImageBlob(blob, fallbackMime = "") {
    const mime = String(blob?.type || fallbackMime || "").toLowerCase();
    return Boolean(blob && Number(blob.size) > 0 && /^image\/(jpeg|png|webp|gif)$/.test(mime));
  }

  function normalizeBlobType(blob, fallbackMime = "") {
    const mime = String(blob?.type || fallbackMime || "").toLowerCase();
    if (!blob || blob.type || !/^image\/(jpeg|png|webp|gif)$/.test(mime) || typeof Blob === "undefined") return blob;
    return new Blob([blob], { type: mime });
  }

  async function storageError(response, status = 0) {
    try {
      const body = await response.json();
      const message = body.message || body.error || "";
      if (status === 404 || /bucket.*not found|not found.*bucket/i.test(message)) {
        return "Хранилище изображений не настроено. Выполни актуальный database/supabase-schema.sql";
      }
      return message || "Не удалось загрузить изображение в Supabase";
    } catch {
      return status === 404
        ? "Хранилище изображений не настроено. Выполни актуальный database/supabase-schema.sql"
        : "Не удалось загрузить изображение в Supabase";
    }
  }

  const api = { createBoardAssetStore };
  global.RhythmBoardAssets = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
