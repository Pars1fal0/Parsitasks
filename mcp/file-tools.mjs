import { z } from "zod";
import { command, entity } from "./workspace-service.mjs";
import boardModel from "../app/src/board/board-model.js";
import { decodeBoardImage } from "./board-image-service.mjs";

const requestId = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);
const session = z.string().min(10).max(4096);

export function registerFileTools(server, context, helpers) {
  const safe = async (operation) => {
    try { return await operation(); }
    catch (error) { return { isError: true, content: [{ type: "text", text: error.message || "Ошибка файлового инструмента" }] }; }
  };
  const result = (data) => ({ structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] });
  const call = async (path, method = "GET", body, headers = {}) => {
    if (!context.integrationRequest) throw new Error("Интеграции доступны только на настроенном сервере Parsitasks");
    const response = await context.integrationRequest(path, { method, body, headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "Не удалось выполнить запрос к Google Drive");
    return data;
  };
  const saveFile = async (data, input) => {
    if (!data.complete) return result(data);
    const file = { ...data.file, googleId: data.file?.id };
    if (!file.googleId || !/^[A-Za-z0-9_-]+$/.test(file.googleId)) throw new Error("Google Drive не вернул корректный файл");
    const response = await helpers.writeTool(context, (state) => command(state, input, "upload_study_material", (next, now, id) => {
      if (input.subjectId) entity(next, "studySubjects", input.subjectId);
      const existing = next.studyFiles.find((item) => item.googleId === file.googleId);
      const material = existing || { id, googleId: file.googleId, name: file.name, mime: file.mime || "", size: file.size || 0,
        subjectId: input.subjectId || "", url: `https://drive.google.com/file/d/${file.googleId}/view`, createdAt: now, updatedAt: now };
      if (!existing) next.studyFiles.push(material);
      return { file: material, summary: "Материал загружен в Drive и добавлен в Parsitasks. Undo убирает запись, но не удаляет оригинал из Drive." };
    }));
    // If saving metadata fails after upload, retain the opaque session for upload-status recovery.
    if (response.isError) return { ...response, content: [...response.content, { type: "text", text: "Файл уже загружен. Повторите finish_material_upload с той же session и requestId, не загружайте файл заново." }] };
    return response;
  };
  const checkSubject = async (input) => {
    const snapshot = await context.store.read();
    if (input.subjectId) entity(snapshot.state, "studySubjects", input.subjectId);
  };
  const config = (title, description, inputSchema, read = false) => ({ title, description, inputSchema,
    securitySchemes: helpers.security, annotations: { readOnlyHint: read, destructiveHint: false, openWorldHint: true } });

  server.registerTool("get_integration_status", config("Проверить подключения Google", "Проверяет состояние Google Drive и Google Calendar без выдачи токенов. Подключение и согласие OAuth выполняет сам пользователь в приложении.", {} , true),
    async () => safe(async () => result({ drive: await call("/api/google-drive/status"), calendar: await call("/api/google-calendar/status") })));

  server.registerTool("read_study_material", config("Прочитать учебный материал", "Возвращает содержимое TXT/Markdown/CSV/JSON до 256 КиБ из папки Parsitasks вашего подключённого Drive. Для PDF, Office и больших файлов возвращает ссылку и объяснение ограничения, не выдаёт их метаданные за прочитанный текст.",
    { fileId: z.string().min(1).max(160) }, true), async (input) => safe(async () => {
      const snapshot = await context.store.read();
      const file = entity(snapshot.state, "studyFiles", input.fileId);
      if (!context.readMaterial) throw new Error("Чтение материалов доступно на настроенном сервере");
      return result(await context.readMaterial(file));
    }));

  server.registerTool("start_material_upload", config("Начать загрузку материала", "Только по запросу пользователя и после confirm. Создаёт resumable-сессию в уже подключённом Drive. Не передавай внешние URL; содержимое загружается через upload_material_chunk. Не обещай сохранение до finish_material_upload.",
    { name: z.string().trim().min(1).max(240), mime: z.string().min(1).max(120), size: z.number().int().min(1).max(5 * 1024 ** 3), confirm: z.boolean() }),
    async (input) => safe(async () => {
      await checkSubject(input);
      if (input.confirm !== true) throw new Error("Подтвердите загрузку файла");
      return result(await call("/api/google-drive/upload-start", "POST", JSON.stringify(input)));
    }));

  server.registerTool("upload_material_chunk", config("Загрузить фрагмент материала", "Загружает base64-фрагмент до 256 КиБ в выданную сервером сессию. Все промежуточные фрагменты — ровно 256 КиБ. По завершении сохраняет метаданные; requestId и subjectId сохраняй одинаковыми для всех вызовов этой загрузки. Не выдумывай session.",
    { requestId, session, subjectId: z.string().max(160).optional(), offset: z.number().int().min(0).max(5 * 1024 ** 3), total: z.number().int().min(1).max(5 * 1024 ** 3), base64: z.string().min(4).max(349528).regex(/^[A-Za-z0-9+/]+={0,2}$/) }),
    async (input) => safe(async () => {
      await checkSubject(input);
      const binary = atob(input.base64);
      if (binary.length > 256 * 1024 || input.offset + binary.length > input.total || input.offset % (256 * 1024) !== 0
        || (input.offset + binary.length < input.total && binary.length !== 256 * 1024)) throw new Error("Некорректный размер или смещение фрагмента");
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const data = await call("/api/google-drive/upload-chunk", "PUT", bytes, { "X-Upload-Session": input.session,
        "Content-Range": `bytes ${input.offset}-${input.offset + bytes.length - 1}/${input.total}`, "Content-Type": "application/octet-stream" });
      return saveFile(data, input);
    }));

  server.registerTool("finish_material_upload", config("Проверить и сохранить загрузку", "Проверяет уже начатую сессию и сохраняет завершённый файл в материалах. Восстанавливает запись после ошибки сохранения без новой загрузки. Подключение Drive и файлы другого пользователя недоступны.",
    { requestId, session, subjectId: z.string().max(160).optional() }),
    async (input) => safe(async () => {
      await checkSubject(input);
      return saveFile(await call("/api/google-drive/upload-status", "POST", JSON.stringify({ session: input.session })), input);
    }));

  server.registerTool("upload_board_image", config("Загрузить изображение на доску", "Загружает предоставленный пользователем PNG/JPEG/WebP/GIF до 1 МиБ в приватное хранилище и создаёт карточку. Только после подтверждения. Не скачивает внешние URL. При ошибке записи повтори тот же requestId и те же байты. Отмена удаляет карточку, не бинарный оригинал.",
    { requestId, confirm: z.boolean(), base64: z.string().min(16).max(1398104), mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
      name: z.string().trim().min(1).max(240), boardId: z.string().max(160).optional(), x: z.number().optional(), y: z.number().optional(),
      width: z.number().min(40).max(10000).optional(), height: z.number().min(40).max(10000).optional() }),
    async (input) => safe(async () => {
      if (!input.confirm) throw new Error("Подтвердите загрузку изображения");
      const snapshot = await context.store.read();
      const previous = snapshot.state.mcpActivity?.find((item) => item.requestId === input.requestId);
      if (previous) {
        if (previous.type !== "upload_board_image") throw new Error("requestId уже использован для другого действия");
        return result({ saved: false, replayed: true, actionId: previous.id, status: previous.status });
      }
      if (input.boardId && entity(snapshot.state, "boardItems", input.boardId).type !== "board") throw new Error("boardId должен указывать на доску");
      if (!context.uploadBoardImage) throw new Error("Загрузка изображений доступна на настроенном сервере");
      const bytes = decodeBoardImage(input.base64, input.mime);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
      const assetId = `mcp-image-${input.requestId}-${hash.slice(0, 16)}`;
      const stored = await context.uploadBoardImage(assetId, bytes, input.mime);
      return helpers.writeTool(context, (state) => command(state, input, "upload_board_image", (next, now, id) => {
        if (input.boardId && entity(next, "boardItems", input.boardId).type !== "board") throw new Error("Доска больше недоступна");
        const item = boardModel.normalizeItem({ type: "image", id, ...stored, name: input.name, boardId: input.boardId || "",
          x: input.x, y: input.y, width: input.width, height: input.height, createdAt: now, updatedAt: now }, { now });
        next.boardItems.push(item);
        return { item, summary: "Изображение загружено и добавлено на доску" };
      }));
    }));
}
