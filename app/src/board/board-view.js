(function (global) {
  const cameraApi = global.RhythmBoardCamera || (typeof require === "function" ? require("./board-camera.js") : null);
  const CAMERA_KEY = "rhythm-board-camera-v2";
  const MIN_ZOOM = 0.02;
  const MAX_ZOOM = 8;
  const MAX_UNDO = 50;
  const RESIZE_DIRECTIONS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  function createBoardView(ctx) {
    let camera = cameraApi.loadCamera(global.localStorage, CAMERA_KEY, MIN_ZOOM, MAX_ZOOM);
    let cameraReady = false;
    let selectedId = "";
    let selectedIds = new Set();
    let editingId = "";
    let gesture = null;
    let textBeforeEdit = null;
    let saveTextTimer = null;
    let undoStack = [];
    let redoStack = [];
    let clipboardItems = [];
    let pasteOffset = 0;
    let viewportSize = null;
    let imageUploadBusy = false;
    let spacePressed = false;
    let interactionMode = "select";
    let cameraVisibilityChecked = false;
    const objectUrls = new Map();
    const pendingUploadAttempts = new Map();

    function bindEvents() {
      ctx.els.boardAddText?.addEventListener("click", () => addTextAtCenter());
      ctx.els.boardAddFrame?.addEventListener("click", () => addFrameAtCenter());
      ctx.els.boardAddImage?.addEventListener("click", () => {
        if (!imageUploadBusy) ctx.els.boardImageInput?.click();
      });
      ctx.els.boardImageInput?.addEventListener("change", async () => {
        const files = [...(ctx.els.boardImageInput.files || [])];
        ctx.els.boardImageInput.value = "";
        await addImageFiles(files, viewportCenter());
      });
      ctx.els.boardUndo?.addEventListener("click", undo);
      ctx.els.boardRedo?.addEventListener("click", redo);
      ctx.els.boardModeSelect?.addEventListener("click", () => setInteractionMode("select"));
      ctx.els.boardModePan?.addEventListener("click", () => setInteractionMode("pan"));
      ctx.els.boardDuplicate?.addEventListener("click", duplicateSelected);
      ctx.els.boardGroup?.addEventListener("click", toggleGroupSelected);
      ctx.els.boardBringFront?.addEventListener("click", () => moveSelectionLayer("front"));
      ctx.els.boardSendBack?.addEventListener("click", () => moveSelectionLayer("back"));
      ctx.els.boardLock?.addEventListener("click", toggleLockSelected);
      ctx.els.boardZoomIn?.addEventListener("click", () => zoomAt(1.3));
      ctx.els.boardZoomOut?.addEventListener("click", () => zoomAt(1 / 1.3));
      ctx.els.boardFocus?.addEventListener("click", focusContent);
      ctx.els.boardBold?.addEventListener("click", () => {
        toggleBold();
        focusPrimarySelection();
      });
      ctx.els.boardColorPresets?.addEventListener("click", (event) => {
        const swatch = event.target.closest("[data-board-text-color]");
        if (swatch) {
          applyTextColor(swatch.dataset.boardTextColor);
          focusPrimarySelection();
        }
      });
      ctx.els.boardTextColor?.addEventListener("input", () => applyTextColor(ctx.els.boardTextColor.value));
      ctx.els.boardTextColor?.addEventListener("change", focusPrimarySelection);
      ctx.els.boardFontSize?.addEventListener("change", applyFontSize);
      ctx.els.boardFontSize?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          applyFontSize();
          ctx.els.boardFontSize.blur();
        }
      });
      ctx.els.boardViewport?.addEventListener("dblclick", handleCanvasDoubleClick);
      ctx.els.boardViewport?.addEventListener("pointerdown", startPan);
      ctx.els.boardViewport?.addEventListener("wheel", handleWheel, { passive: false });
      ctx.els.boardViewport?.addEventListener("dragover", handleDragOver);
      ctx.els.boardViewport?.addEventListener("dragleave", handleDragLeave);
      ctx.els.boardViewport?.addEventListener("drop", handleDrop);
      global.addEventListener("pointermove", handlePointerMove);
      global.addEventListener("pointerup", finishGesture);
      global.addEventListener("pointercancel", cancelGesture);
      global.addEventListener("keydown", handleKeyDown, true);
      global.addEventListener("keyup", handleKeyUp, true);
      global.addEventListener("paste", handlePaste);
      if (global.ResizeObserver && ctx.els.boardViewport) {
        const resizeObserver = new global.ResizeObserver(handleViewportResize);
        resizeObserver.observe(ctx.els.boardViewport);
      } else {
        global.addEventListener("resize", handleViewportResize);
      }
    }

    function render() {
      if (!ctx.els.boardWorld || !ctx.els.boardViewport) return;
      initializeCamera();
      const items = ctx.getItems();
      const liveIds = new Set(items.map((item) => item.id));
      selectedIds = new Set([...selectedIds].filter((id) => liveIds.has(id)));
      if (selectedId && !liveIds.has(selectedId)) selectedId = [...selectedIds].at(-1) || "";
      if (editingId && !items.some((item) => item.id === editingId)) editingId = "";
      releaseUnusedObjectUrls(items);

      ctx.els.boardWorld.replaceChildren(...items.map(createItemNode), ...createGuideNodes());
      ctx.els.boardEmpty.hidden = items.length > 0;
      syncHistoryControls();
      applyCamera();
      scheduleCameraVisibilityCheck(items);
      syncInteractionMode();
      updateSelection();
      items.filter((item) => item.type === "image").forEach(loadImage);
      syncLegacyImages(items);
    }

    function createItemNode(item) {
      const node = document.createElement("article");
      node.className = `board-item board-${item.type}`;
      node.classList.toggle("is-locked", item.locked);
      node.dataset.id = item.id;
      node.tabIndex = -1;
      node.setAttribute("role", "group");
      node.setAttribute("aria-label", item.type === "text"
        ? "Текст на доске"
        : item.type === "frame" ? `Фрейм: ${item.text}` : "Изображение на доске");
      applyNodeGeometry(node, item);

      if (item.type === "text") {
        node.append(createTextContent(item, node));
      } else if (item.type === "frame") {
        node.append(createFrameContent(item, node));
      } else {
        node.append(...createImageContent(item));
      }
      RESIZE_DIRECTIONS.forEach((direction) => node.append(createResizeHandle(direction)));

      node.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (spacePressed || interactionMode === "pan") return;
        if (
          event.detail >= 2
          && (item.type === "text" || item.type === "frame")
          && event.target.closest(".board-text-content, .board-frame-title")
        ) {
          event.preventDefault();
          event.stopPropagation();
          setSelection([item.id], item.id);
          startTextEdit(item.id, node);
          return;
        }
        const resizeHandle = event.target.closest("[data-board-resize]");
        const remainsSelected = selectItem(item.id, node, { additive: event.shiftKey, toggle: event.shiftKey });
        if (!remainsSelected) return;
        if (item.locked || selectedItems().some((candidate) => candidate.locked)) return;
        if (resizeHandle) {
          startItemGesture(event, item, "resize", node, resizeHandle.dataset.boardResize);
          return;
        }
        if (editingId === item.id && event.target.closest(".board-text-content, .board-frame-title")) return;
        startItemGesture(event, item, "move", node);
      });
      node.addEventListener("focus", () => {
        if (!selectedIds.has(item.id)) selectItem(item.id, node);
      });
      return node;
    }

    function createTextContent(item, node) {
      const content = document.createElement("div");
      content.className = "board-text-content";
      content.textContent = item.text;
      content.spellcheck = true;
      content.dataset.placeholder = "Введите текст";
      content.style.fontSize = `${item.fontSize}px`;
      content.style.fontWeight = String(item.fontWeight);
      content.style.color = item.color;
      content.setAttribute("aria-label", "Текстовый объект");
      content.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startTextEdit(item.id, node);
      });
      content.addEventListener("input", () => scheduleTextSave(item.id, editableText(content)));
      content.addEventListener("blur", () => finishTextEdit(item.id, content));
      content.addEventListener("paste", pastePlainText);
      return content;
    }

    function createFrameContent(item, node) {
      const frame = document.createElement("div");
      frame.className = "board-frame-content";
      const title = document.createElement("div");
      title.className = "board-frame-title";
      title.textContent = item.text;
      title.spellcheck = true;
      title.setAttribute("aria-label", "Название фрейма");
      title.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startTextEdit(item.id, node);
      });
      title.addEventListener("input", () => scheduleTextSave(item.id, editableText(title)));
      title.addEventListener("blur", () => finishTextEdit(item.id, title));
      title.addEventListener("paste", pastePlainText);
      frame.append(title);
      return frame;
    }

    function createImageContent(item) {
      const image = document.createElement("img");
      image.className = "board-image-content";
      image.alt = item.name || "Изображение на доске";
      image.draggable = false;
      image.dataset.assetId = item.assetId;
      const placeholder = document.createElement("div");
      placeholder.className = "board-image-placeholder";
      placeholder.textContent = item.remotePath
        ? "Загружаем изображение из Supabase…"
        : "Переносим старое изображение в Supabase…";
      return [image, placeholder];
    }

    function createResizeHandle(direction) {
      const handle = document.createElement("span");
      handle.className = `board-resize-handle is-${direction}`;
      handle.dataset.boardResize = direction;
      handle.setAttribute("aria-hidden", "true");
      return handle;
    }

    function addTextAtCenter(point = viewportCenter()) {
      const world = screenToWorld(point.x, point.y);
      const viewportWidth = ctx.els.boardViewport.getBoundingClientRect().width / camera.zoom;
      const width = clamp(viewportWidth - 32 / camera.zoom, 180, 360);
      const position = findOpenPosition(world.x - width / 2, world.y - 70, width, 140);
      pushUndo();
      const item = ctx.model.createTextItem({
        x: position.x,
        y: position.y,
        width,
        z: nextZ(),
      }, {
        createId: ctx.createId,
        now: new Date().toISOString(),
      });
      selectedId = item.id;
      selectedIds = new Set([item.id]);
      commit([...ctx.getItems(), item]);
      requestAnimationFrame(() => {
        const node = findItemNode(item.id);
        if (node) startTextEdit(item.id, node);
      });
    }

    function addFrameAtCenter(point = viewportCenter()) {
      const world = screenToWorld(point.x, point.y);
      const viewport = ctx.els.boardViewport.getBoundingClientRect();
      const width = clamp((viewport.width - 64) / camera.zoom, 360, 720);
      const height = clamp((viewport.height - 120) / camera.zoom, 240, 480);
      const item = ctx.model.createFrameItem({
        x: world.x - width / 2,
        y: world.y - height / 2,
        width,
        height,
        z: 0,
      }, {
        createId: ctx.createId,
        now: new Date().toISOString(),
      });
      pushUndo();
      selectedId = item.id;
      selectedIds = new Set([item.id]);
      const items = [item, ...ctx.getItems()].map((candidate, index) => ({ ...candidate, z: index }));
      commit(items);
      requestAnimationFrame(() => {
        const node = findItemNode(item.id);
        if (node) startTextEdit(item.id, node);
      });
    }

    function findOpenPosition(baseX, baseY, width, height) {
      const directions = [
        [0, 0],
        [-1, 0],
        [1, 0],
        [0, 1],
        [0, -1],
        [-1, 1],
        [1, 1],
        [-1, -1],
        [1, -1],
      ];
      const items = ctx.getItems();
      const stepX = width + 40;
      const stepY = height + 40;
      const viewport = ctx.els.boardViewport.getBoundingClientRect();
      const padding = 16 / camera.zoom;
      const visibleBounds = {
        left: -camera.x / camera.zoom + padding,
        top: -camera.y / camera.zoom + padding,
        right: (viewport.width - camera.x) / camera.zoom - padding,
        bottom: (viewport.height - camera.y) / camera.zoom - padding,
      };
      for (const keepVisible of [true, false]) {
        for (let radius = 0; radius <= 20; radius += 1) {
          for (const [directionX, directionY] of directions) {
            if (radius === 0 && (directionX || directionY)) continue;
            if (radius > 0 && !directionX && !directionY) continue;
            const candidate = {
              x: baseX + directionX * stepX * radius,
              y: baseY + directionY * stepY * radius,
            };
            if (keepVisible && (
              candidate.x < visibleBounds.left
              || candidate.y < visibleBounds.top
              || candidate.x + width > visibleBounds.right
              || candidate.y + height > visibleBounds.bottom
            )) continue;
            const overlaps = items.some((item) =>
              candidate.x < item.x + item.width + 24
              && candidate.x + width + 24 > item.x
              && candidate.y < item.y + item.height + 24
              && candidate.y + height + 24 > item.y);
            if (!overlaps) return candidate;
          }
        }
      }
      return { x: baseX, y: baseY + (items.length + 1) * stepY };
    }

    async function addImageFiles(files, point) {
      const images = files
        .filter((file) => String(file.type || "").startsWith("image/"))
        .slice(0, 8);
      if (!images.length || imageUploadBusy) return;
      imageUploadBusy = true;
      ctx.els.boardAddImage.disabled = true;
      const before = cloneItems(ctx.getItems());
      const added = [];
      const anchor = screenToWorld(point.x, point.y);
      try {
        for (let index = 0; index < images.length; index += 1) {
          try {
            setStatus(`Загружаю фото ${index + 1} из ${images.length} в Supabase…`, "loading");
            const prepared = await ctx.assets.prepareImage(images[index]);
            const assetId = ctx.createId();
            const remotePath = await ctx.assets.uploadPrepared(assetId, prepared);
            cacheImageUrl(assetId, prepared.blob);
            const fit = fitImage(prepared.width, prepared.height);
            const item = ctx.model.createImageItem({
              assetId,
              remotePath,
              mime: prepared.mime,
              name: prepared.name,
              width: fit.width,
              height: fit.height,
              x: anchor.x - fit.width / 2 + index * 32,
              y: anchor.y - fit.height / 2 + index * 32,
              z: nextZ() + index,
            }, {
              createId: ctx.createId,
              now: new Date().toISOString(),
            });
            added.push(item);
          } catch (error) {
            showImageError(error);
          }
        }
        if (added.length) {
          recordUndo(before);
          selectedId = added.at(-1).id;
          selectedIds = new Set([selectedId]);
          commit([...before, ...added]);
          setStatus(
            added.length === 1
              ? "Фото сохранено в Supabase Storage"
              : `Фото сохранены в Supabase Storage: ${added.length}`,
            "cloud",
          );
        }
      } finally {
        imageUploadBusy = false;
        ctx.els.boardAddImage.disabled = false;
      }
    }

    function startPan(event) {
      const shouldPan = event.pointerType === "touch"
        || event.button === 1
        || (event.button === 0 && (spacePressed || interactionMode === "pan"));
      if (
        (!shouldPan && event.button !== 0)
        || (!shouldPan && event.target.closest(".board-item"))
        || event.target.closest(".board-toolbar")
        || event.target.closest(".board-selection-toolbar")
        || event.target.closest(".board-zoom-controls")
      ) return;
      event.preventDefault();
      finishActiveTextEdit();
      if (!shouldPan && !event.shiftKey) setSelection([]);
      gesture = {
        type: shouldPan ? "pan" : "marquee",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        extendSelection: event.shiftKey,
        initialSelection: new Set(selectedIds),
        cameraX: camera.x,
        cameraY: camera.y,
      };
      ctx.els.boardViewport.setPointerCapture?.(event.pointerId);
      ctx.els.boardViewport.classList.add(shouldPan ? "is-panning" : "is-selecting");
      if (!shouldPan) updateMarquee(event.clientX, event.clientY);
    }

    function startItemGesture(event, item, type, node, direction = "") {
      if (type === "resize") event.preventDefault();
      event.stopPropagation();
      const movingItems = type === "move"
        ? ctx.getItems().filter((candidate) => selectedIds.has(candidate.id))
        : [item];
      gesture = {
        type,
        direction,
        pointerId: event.pointerId,
        itemId: item.id,
        node,
        startX: event.clientX,
        startY: event.clientY,
        original: { ...item },
        originals: new Map(movingItems.map((candidate) => [candidate.id, { ...candidate }])),
        nodes: movingItems.map((candidate) => findItemNode(candidate.id)).filter(Boolean),
        before: cloneItems(ctx.getItems()),
        moved: false,
      };
      gesture.nodes.forEach((itemNode) => itemNode.classList.add(type === "move" ? "is-dragging" : "is-resizing"));
    }

    function handlePointerMove(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (gesture.type === "pan") {
        camera.x = gesture.cameraX + dx;
        camera.y = gesture.cameraY + dy;
        applyCamera();
        return;
      }
      if (gesture.type === "marquee") {
        gesture.moved ||= Math.abs(dx) + Math.abs(dy) > 3;
        updateMarquee(event.clientX, event.clientY);
        previewMarqueeSelection();
        return;
      }
      const worldDx = dx / camera.zoom;
      const worldDy = dy / camera.zoom;
      gesture.moved ||= Math.abs(dx) + Math.abs(dy) > 3;
      if (!gesture.moved) return;
      event.preventDefault();
      if (!gesture.pointerCaptured) {
        gesture.node?.setPointerCapture?.(gesture.pointerId);
        gesture.pointerCaptured = true;
      }
      if (gesture.type === "move") {
        const snap = snapMove(
          [...gesture.originals.values()],
          ctx.getItems().filter((item) => !gesture.originals.has(item.id)),
          worldDx,
          worldDy,
          7 / camera.zoom,
        );
        showSnapGuides(snap);
        gesture.previews = new Map();
        gesture.originals.forEach((original, id) => {
          const preview = {
            x: original.x + snap.dx,
            y: original.y + snap.dy,
            width: original.width,
            height: original.height,
          };
          gesture.previews.set(id, preview);
          const itemNode = findItemNode(id);
          if (itemNode) applyNodeGeometry(itemNode, { ...original, ...preview });
        });
        return;
      }
      if (gesture.type === "group-resize") {
        const nextBounds = resizeGeometry(
          { ...gesture.groupBounds, type: "image" },
          worldDx,
          worldDy,
          gesture.direction,
        );
        const scaleX = nextBounds.width / Math.max(gesture.groupBounds.width, 1);
        const scaleY = nextBounds.height / Math.max(gesture.groupBounds.height, 1);
        gesture.previews = new Map();
        gesture.originals.forEach((original, id) => {
          const minimumWidth = original.type === "frame" ? 240 : 40;
          const minimumHeight = original.type === "frame" ? 160 : original.type === "image" ? 40 : 24;
          const preview = {
            x: nextBounds.x + (original.x - gesture.groupBounds.x) * scaleX,
            y: nextBounds.y + (original.y - gesture.groupBounds.y) * scaleY,
            width: Math.max(minimumWidth, original.width * scaleX),
            height: Math.max(minimumHeight, original.height * scaleY),
          };
          gesture.previews.set(id, preview);
          const itemNode = findItemNode(id);
          if (itemNode) applyNodeGeometry(itemNode, { ...original, ...preview });
        });
        applyNodeGeometry(gesture.node, { ...nextBounds, z: 1000000000 });
        return;
      }
      gesture.preview = resizeGeometry(gesture.original, worldDx, worldDy, gesture.direction);
      applyNodeGeometry(gesture.node, { ...gesture.original, ...gesture.preview });
    }

    function finishGesture(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const current = gesture;
      gesture = null;
      hideSnapGuides();
      ctx.els.boardViewport.classList.remove("is-panning", "is-selecting");
      current.nodes?.forEach((itemNode) => itemNode.classList.remove("is-dragging", "is-resizing"));
      current.node?.classList.remove("is-dragging", "is-resizing");
      if (current.type === "pan") {
        saveCamera();
        return;
      }
      if (current.type === "marquee") {
        hideMarquee();
        if (!current.moved && !current.extendSelection) setSelection([]);
        return;
      }
      const hasGroupPreviews = current.type === "move" || current.type === "group-resize";
      if (!current.moved || (hasGroupPreviews ? !current.previews : !current.preview)) {
        current.node?.focus({ preventScroll: true });
        return;
      }
      recordUndo(current.before);
      const now = new Date().toISOString();
      const next = ctx.getItems().map((item) => {
        if (hasGroupPreviews && current.previews.has(item.id)) {
          return { ...item, ...current.previews.get(item.id), updatedAt: now };
        }
        if (current.type === "resize" && item.id === current.itemId) {
          return { ...item, ...current.preview, updatedAt: now };
        }
        return item;
      });
      commit(next);
    }

    function cancelGesture() {
      if (!gesture) return;
      gesture.nodes?.forEach((itemNode) => itemNode.classList.remove("is-dragging", "is-resizing"));
      gesture.node?.classList.remove("is-dragging", "is-resizing");
      ctx.els.boardViewport.classList.remove("is-panning", "is-selecting");
      hideMarquee();
      hideSnapGuides();
      gesture = null;
      applyCamera();
      render();
    }

    function updateMarquee(clientX, clientY) {
      if (!gesture || gesture.type !== "marquee" || !ctx.els.boardMarquee) return;
      const viewport = ctx.els.boardViewport.getBoundingClientRect();
      const left = clamp(Math.min(gesture.startX, clientX) - viewport.left, 0, viewport.width);
      const top = clamp(Math.min(gesture.startY, clientY) - viewport.top, 0, viewport.height);
      const right = clamp(Math.max(gesture.startX, clientX) - viewport.left, 0, viewport.width);
      const bottom = clamp(Math.max(gesture.startY, clientY) - viewport.top, 0, viewport.height);
      gesture.marquee = { left, top, right, bottom };
      ctx.els.boardMarquee.hidden = false;
      Object.assign(ctx.els.boardMarquee.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${right - left}px`,
        height: `${bottom - top}px`,
      });
    }

    function previewMarqueeSelection() {
      if (!gesture?.marquee) return;
      const viewport = ctx.els.boardViewport.getBoundingClientRect();
      const marqueeRect = {
        left: viewport.left + gesture.marquee.left,
        top: viewport.top + gesture.marquee.top,
        right: viewport.left + gesture.marquee.right,
        bottom: viewport.top + gesture.marquee.bottom,
      };
      const ids = [...ctx.els.boardWorld.querySelectorAll(".board-item")]
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left < marqueeRect.right
            && rect.right > marqueeRect.left
            && rect.top < marqueeRect.bottom
            && rect.bottom > marqueeRect.top;
        })
        .map((node) => node.dataset.id);
      const next = gesture.extendSelection
        ? [...new Set([...gesture.initialSelection, ...ids])]
        : ids;
      setSelection(next, ids.at(-1) || [...gesture.initialSelection].at(-1) || "");
    }

    function hideMarquee() {
      if (!ctx.els.boardMarquee) return;
      ctx.els.boardMarquee.hidden = true;
      ctx.els.boardMarquee.removeAttribute("style");
    }

    function showSnapGuides(snap) {
      const vertical = ctx.els.boardWorld.querySelector('[data-board-guide="vertical"]');
      const horizontal = ctx.els.boardWorld.querySelector('[data-board-guide="horizontal"]');
      if (vertical) {
        vertical.hidden = !Number.isFinite(snap.vertical);
        if (!vertical.hidden) vertical.style.transform = `translate(${snap.vertical}px, -100000px)`;
      }
      if (horizontal) {
        horizontal.hidden = !Number.isFinite(snap.horizontal);
        if (!horizontal.hidden) horizontal.style.transform = `translate(-100000px, ${snap.horizontal}px)`;
      }
    }

    function hideSnapGuides() {
      ctx.els.boardWorld.querySelectorAll("[data-board-guide]").forEach((guide) => {
        guide.hidden = true;
      });
    }

    function handleWheel(event) {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomAt(factor, { x: event.clientX, y: event.clientY });
    }

    function handleViewportResize() {
      const rect = ctx.els.boardViewport?.getBoundingClientRect();
      if (!rect?.width || !rect?.height) return;
      if (viewportSize && camera) {
        camera.x += (rect.width - viewportSize.width) / 2;
        camera.y += (rect.height - viewportSize.height) / 2;
        applyCamera();
        saveCamera();
      }
      viewportSize = { width: rect.width, height: rect.height };
    }

    function zoomAt(factor, point = viewportCenter()) {
      const rect = ctx.els.boardViewport.getBoundingClientRect();
      camera = cameraApi.zoomCamera(camera, factor, point, rect, MIN_ZOOM, MAX_ZOOM);
      applyCamera();
      saveCamera();
    }

    function focusContent() {
      const content = ctx.model.bounds(ctx.getItems());
      const rect = ctx.els.boardViewport.getBoundingClientRect();
      camera = cameraApi.fitCamera(content, rect, MIN_ZOOM, MAX_ZOOM);
      applyCamera();
      saveCamera();
    }

    function handleCanvasDoubleClick(event) {
      if (
        event.target.closest(".board-item")
        || event.target.closest(".board-toolbar")
        || event.target.closest(".board-selection-toolbar")
        || event.target.closest(".board-zoom-controls")
      ) return;
      addTextAtCenter({ x: event.clientX, y: event.clientY });
    }

    function handleDragOver(event) {
      if (![...(event.dataTransfer?.items || [])].some((item) => item.type.startsWith("image/"))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      ctx.els.boardViewport.classList.add("is-drop-target");
    }

    function handleDragLeave(event) {
      if (event.relatedTarget && ctx.els.boardViewport.contains(event.relatedTarget)) return;
      ctx.els.boardViewport.classList.remove("is-drop-target");
    }

    async function handleDrop(event) {
      ctx.els.boardViewport.classList.remove("is-drop-target");
      const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("image/"));
      if (!files.length) return;
      event.preventDefault();
      await addImageFiles(files, { x: event.clientX, y: event.clientY });
    }

    async function handlePaste(event) {
      if (!isBoardActive() || editingId || event.target.closest?.("input, textarea, [contenteditable]")) return;
      const files = [...(event.clipboardData?.items || [])]
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      await addImageFiles(files, viewportCenter());
    }

    function handleKeyDown(event) {
      if (!isBoardActive()) return;
      const formControl = event.target.closest?.("input, textarea, select, button");
      const commandKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.code === "Space" && !editingId && !formControl) {
        spacePressed = true;
        ctx.els.boardViewport.classList.add("is-space-pan");
        event.preventDefault();
        return;
      }
      const focusedItemId = document.activeElement?.closest?.(".board-item")?.dataset.id;
      if (!editingId && focusedItemId && !selectedIds.has(focusedItemId)) {
        setSelection([focusedItemId], focusedItemId);
      }
      if (commandKey && key === "z" && event.shiftKey && !editingId && !formControl) {
        event.preventDefault();
        redo();
        return;
      }
      if (commandKey && (key === "y") && !editingId && !formControl) {
        event.preventDefault();
        redo();
        return;
      }
      if (commandKey && key === "z" && !editingId && !formControl) {
        event.preventDefault();
        undo();
        return;
      }
      if (commandKey && key === "c" && selectedIds.size && !editingId && !formControl) {
        event.preventDefault();
        copySelected();
        return;
      }
      if (commandKey && key === "v" && clipboardItems.length && !editingId && !formControl) {
        event.preventDefault();
        pasteClipboard();
        return;
      }
      if (commandKey && key === "d" && selectedIds.size && !editingId && !formControl) {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (commandKey && key === "g" && selectedIds.size && !editingId && !formControl) {
        event.preventDefault();
        toggleGroupSelected();
        return;
      }
      if (commandKey && key === "b" && selectedTexts().length && !editingId) {
        event.preventDefault();
        toggleBold();
        return;
      }
      if (!commandKey && !editingId && !formControl && key === "v") {
        setInteractionMode("select");
        return;
      }
      if (!commandKey && !editingId && !formControl && key === "h") {
        setInteractionMode("pan");
        return;
      }
      if (event.key === "Delete" && selectedIds.size && !editingId && !formControl) {
        event.preventDefault();
        event.stopPropagation();
        deleteSelected();
        return;
      }
      if (
        event.key === "Enter"
        && selectedIds.size === 1
        && selectedEditableItem()
        && !editingId
        && !formControl
      ) {
        event.preventDefault();
        const node = findItemNode(selectedId);
        if (node) startTextEdit(selectedId, node);
        return;
      }
      if (event.key.startsWith("Arrow") && selectedIds.size && !editingId && !formControl) {
        event.preventDefault();
        moveSelectedWithKeyboard(event.key, event.shiftKey ? 10 : 1);
        return;
      }
      if (event.key === "Escape") {
        if (editingId) {
          event.preventDefault();
          finishActiveTextEdit();
          findItemNode(selectedId)?.focus({ preventScroll: true });
        } else {
          setSelection([]);
        }
      }
    }

    function handleKeyUp(event) {
      if (event.code !== "Space") return;
      spacePressed = false;
      ctx.els.boardViewport?.classList.remove("is-space-pan");
    }

    function deleteSelected() {
      const ids = new Set(selectedIds);
      if (!ids.size) return;
      if (selectedItems().some((item) => item.locked)) {
        ctx.showToast("Сначала разблокируй объект");
        return;
      }
      pushUndo();
      setSelection([]);
      editingId = "";
      commit(ctx.getItems().filter((item) => !ids.has(item.id)), { deletedIds: [...ids] });
      ctx.showToast("Объект удалён · отмена доступна на панели доски");
    }

    function undo() {
      const snapshot = undoStack.pop();
      if (!snapshot) return;
      redoStack.push(cloneItems(ctx.getItems()));
      setSelection([]);
      editingId = "";
      applyHistorySnapshot(snapshot);
      ctx.showToast("Изменение отменено");
    }

    function redo() {
      const snapshot = redoStack.pop();
      if (!snapshot) return;
      undoStack.push(cloneItems(ctx.getItems()));
      setSelection([]);
      editingId = "";
      applyHistorySnapshot(snapshot);
      ctx.showToast("Изменение повторено");
    }

    function applyHistorySnapshot(snapshot) {
      const nextIds = new Set((snapshot || []).map((item) => item.id));
      const deletedIds = ctx.getItems().filter((item) => !nextIds.has(item.id)).map((item) => item.id);
      ctx.commitItems(snapshot, { deletedIds, restoreDeleted: true });
      render();
    }

    function startTextEdit(id, node) {
      const item = ctx.getItems().find((candidate) => candidate.id === id);
      const content = node?.querySelector(".board-text-content, .board-frame-title");
      if (!item || !content || item.locked) return;
      finishActiveTextEdit();
      setSelection([id], id);
      editingId = id;
      textBeforeEdit = { items: cloneItems(ctx.getItems()), value: item.text };
      node.classList.add("is-selected", "is-editing");
      content.contentEditable = "plaintext-only";
      if (content.contentEditable !== "plaintext-only") content.contentEditable = "true";
      content.focus({ preventScroll: true });
      placeCaretAtEnd(content);
      updateSelection();
    }

    function finishActiveTextEdit() {
      if (!editingId) return;
      const content = findItemNode(editingId)?.querySelector(".board-text-content, .board-frame-title");
      if (content) finishTextEdit(editingId, content);
      else editingId = "";
    }

    function scheduleTextSave(id, value) {
      if (saveTextTimer) clearTimeout(saveTextTimer);
      saveTextTimer = setTimeout(() => saveText(id, value), 350);
    }

    function finishTextEdit(id, content) {
      if (editingId !== id) return;
      if (saveTextTimer) clearTimeout(saveTextTimer);
      saveTextTimer = null;
      const value = editableText(content);
      if (textBeforeEdit && textBeforeEdit.value !== value) {
        recordUndo(textBeforeEdit.items);
      }
      saveText(id, value, Math.ceil(content.scrollHeight));
      textBeforeEdit = null;
      editingId = "";
      content.contentEditable = "false";
      content.closest(".board-item")?.classList.remove("is-editing");
      updateSelection();
    }

    function saveText(id, value, minimumHeight = 0) {
      const current = ctx.getItems().find((item) => item.id === id);
      if (!current) return;
      const height = Math.max(current.height, minimumHeight);
      if (current.text === value && current.height === height) return;
      ctx.commitItems(ctx.getItems().map((item) => item.id === id
        ? {
            ...item,
            text: String(value).slice(0, ctx.model.MAX_TEXT_LENGTH),
            height,
            updatedAt: new Date().toISOString(),
          }
        : item), { render: false });
      const node = findItemNode(id);
      if (node) node.style.height = `${height}px`;
      setStatus("Сохранено · фото хранятся в Supabase Storage", "saved");
    }

    function pastePlainText(event) {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") || "";
      global.document.execCommand("insertText", false, text);
    }

    function selectItem(id, node = findItemNode(id), options = {}) {
      if (editingId && editingId !== id) finishActiveTextEdit();
      const item = ctx.getItems().find((candidate) => candidate.id === id);
      const targetIds = item?.groupId
        ? ctx.getItems().filter((candidate) => candidate.groupId === item.groupId).map((candidate) => candidate.id)
        : [id];
      const preserveGroup = !options.additive && targetIds.every((targetId) => selectedIds.has(targetId));
      const next = new Set(options.additive || preserveGroup ? selectedIds : []);
      if (options.toggle && targetIds.every((targetId) => next.has(targetId))) {
        targetIds.forEach((targetId) => next.delete(targetId));
      } else {
        targetIds.forEach((targetId) => next.add(targetId));
      }
      setSelection([...next], next.has(id) ? id : [...next].at(-1) || "");
      if (next.has(id)) node?.focus({ preventScroll: true });
      return next.has(id);
    }

    function setSelection(ids, primaryId = "") {
      selectedIds = new Set((ids || []).filter(Boolean));
      const selectedGroups = new Set(
        ctx.getItems()
          .filter((item) => selectedIds.has(item.id) && item.groupId)
          .map((item) => item.groupId),
      );
      ctx.getItems().forEach((item) => {
        if (item.groupId && selectedGroups.has(item.groupId)) selectedIds.add(item.id);
      });
      selectedId = selectedIds.has(primaryId) ? primaryId : [...selectedIds].at(-1) || "";
      updateSelection();
    }

    function updateSelection() {
      const selected = ctx.getItems().find((item) => item.id === selectedId);
      const textItems = selectedTexts();
      const items = selectedItems();
      ctx.els.boardWorld.querySelectorAll(".board-item").forEach((node) => {
        const active = selectedIds.has(node.dataset.id);
        node.classList.toggle("is-selected", active);
        node.classList.toggle("is-editing", active && node.dataset.id === editingId);
        node.classList.toggle("is-multi-selected", active && selectedIds.size > 1);
        node.setAttribute("aria-selected", String(active));
      });
      const showTextTools = textItems.length > 0 && !items.some((item) => item.locked);
      if (ctx.els.boardSelectionToolbar) ctx.els.boardSelectionToolbar.hidden = items.length === 0;
      if (ctx.els.boardTextControls) ctx.els.boardTextControls.hidden = !showTextTools;
      ctx.els.boardSelectionToolbar?.querySelector(".board-text-separator")?.toggleAttribute("hidden", !showTextTools);
      const groupId = selectedGroupId(items);
      if (ctx.els.boardGroup) {
        ctx.els.boardGroup.disabled = items.length < 2;
        ctx.els.boardGroup.title = groupId ? "Разгруппировать (Ctrl+G)" : "Сгруппировать (Ctrl+G)";
        ctx.els.boardGroup.setAttribute("aria-label", groupId ? "Разгруппировать" : "Сгруппировать");
        ctx.els.boardGroup.classList.toggle("is-active", Boolean(groupId));
      }
      if (ctx.els.boardLock) {
        const allLocked = items.length > 0 && items.every((item) => item.locked);
        ctx.els.boardLock.setAttribute("aria-pressed", String(allLocked));
        ctx.els.boardLock.setAttribute("aria-label", allLocked ? "Разблокировать" : "Заблокировать");
        ctx.els.boardLock.title = allLocked ? "Разблокировать" : "Заблокировать";
        ctx.els.boardLock.classList.toggle("is-active", allLocked);
      }
      if (showTextTools) {
        const reference = selected?.type === "text" ? selected : textItems[0];
        const allBold = textItems.every((item) => item.fontWeight >= 600);
        ctx.els.boardFontSize.value = String(reference.fontSize);
        ctx.els.boardBold.setAttribute("aria-pressed", String(allBold));
        ctx.els.boardBold.classList.toggle("is-active", allBold);
        ctx.els.boardTextColor.value = reference.color;
        ctx.els.boardColorPresets?.querySelectorAll("[data-board-text-color]").forEach((swatch) => {
          swatch.classList.toggle("is-active", swatch.dataset.boardTextColor === reference.color);
        });
      }
      renderMultiSelectionBounds(items);
    }

    function renderMultiSelectionBounds(items) {
      ctx.els.boardWorld.querySelector(".board-multi-bounds")?.remove();
      if (items.length < 2) return;
      const bounds = itemBounds(items);
      if (!bounds) return;
      const node = document.createElement("div");
      node.className = "board-multi-bounds";
      applyNodeGeometry(node, {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
        z: 1000000000,
      });
      if (!items.some((item) => item.locked)) {
        RESIZE_DIRECTIONS
          .filter((direction) => direction.length === 2)
          .forEach((direction) => {
            const handle = createResizeHandle(direction);
            handle.addEventListener("pointerdown", (event) => startGroupResize(event, direction, node, bounds));
            node.append(handle);
          });
      }
      ctx.els.boardWorld.append(node);
    }

    function startGroupResize(event, direction, node, bounds) {
      event.preventDefault();
      event.stopPropagation();
      const items = selectedItems();
      if (items.length < 2 || items.some((item) => item.locked)) return;
      gesture = {
        type: "group-resize",
        direction,
        pointerId: event.pointerId,
        node,
        nodes: items.map((item) => findItemNode(item.id)).filter(Boolean),
        startX: event.clientX,
        startY: event.clientY,
        groupBounds: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
        originals: new Map(items.map((item) => [item.id, { ...item }])),
        before: cloneItems(ctx.getItems()),
        moved: false,
      };
      node.classList.add("is-resizing");
      gesture.nodes.forEach((itemNode) => itemNode.classList.add("is-resizing"));
    }

    function applyFontSize() {
      const item = selectedText() || selectedTexts()[0];
      if (!item) return;
      const fontSize = clamp(
        Math.round(Number(ctx.els.boardFontSize.value) || item.fontSize),
        ctx.model.MIN_FONT_SIZE,
        ctx.model.MAX_FONT_SIZE,
      );
      updateSelectedText((candidate) => {
        const content = findItemNode(candidate.id)?.querySelector(".board-text-content");
        let height = candidate.height;
        if (content) {
          const previousSize = content.style.fontSize;
          content.style.fontSize = `${fontSize}px`;
          height = Math.max(height, Math.ceil(content.scrollHeight));
          content.style.fontSize = previousSize;
        }
        return { fontSize, height };
      });
    }

    function toggleBold() {
      const items = selectedTexts();
      if (!items.length) return;
      const fontWeight = items.every((item) => item.fontWeight >= 600) ? 400 : 700;
      updateSelectedText({ fontWeight });
    }

    function applyTextColor(color) {
      if (!/^#[0-9a-f]{6}$/i.test(String(color || ""))) return;
      updateSelectedText({ color: String(color).toLowerCase() });
    }

    function updateSelectedText(patch) {
      const ids = new Set(selectedTexts().map((item) => item.id));
      if (!ids.size || selectedItems().some((item) => item.locked)) return;
      pushUndo();
      commit(ctx.getItems().map((candidate) => ids.has(candidate.id)
        ? {
            ...candidate,
            ...(typeof patch === "function" ? patch(candidate) : patch),
            updatedAt: new Date().toISOString(),
          }
        : candidate));
    }

    function selectedText() {
      const item = ctx.getItems().find((candidate) => candidate.id === selectedId);
      return item?.type === "text" ? item : null;
    }

    function selectedTexts() {
      return ctx.getItems().filter((item) => selectedIds.has(item.id) && item.type === "text");
    }

    function selectedItems() {
      return ctx.getItems().filter((item) => selectedIds.has(item.id));
    }

    function selectedEditableItem() {
      const item = ctx.getItems().find((candidate) => candidate.id === selectedId);
      return item && (item.type === "text" || item.type === "frame") ? item : null;
    }

    function selectedGroupId(items = selectedItems()) {
      if (items.length < 2 || !items[0].groupId) return "";
      const groupId = items[0].groupId;
      const members = ctx.getItems().filter((item) => item.groupId === groupId);
      return items.every((item) => item.groupId === groupId) && members.length === items.length ? groupId : "";
    }

    function copySelected(options = {}) {
      clipboardItems = cloneItems(selectedItems());
      pasteOffset = 0;
      if (!options.silent && clipboardItems.length) ctx.showToast("Скопировано");
    }

    function pasteClipboard() {
      if (!clipboardItems.length) return;
      pushUndo();
      pasteOffset += 28;
      const now = new Date().toISOString();
      const idMap = new Map(clipboardItems.map((item) => [item.id, ctx.createId()]));
      const groupMap = new Map();
      clipboardItems.forEach((item) => {
        if (item.groupId && !groupMap.has(item.groupId)) groupMap.set(item.groupId, ctx.createId());
      });
      const baseZ = nextZ();
      const copies = clipboardItems.map((item, index) => ({
        ...item,
        id: idMap.get(item.id),
        groupId: item.groupId ? groupMap.get(item.groupId) : "",
        x: item.x + pasteOffset,
        y: item.y + pasteOffset,
        z: baseZ + index,
        locked: false,
        createdAt: now,
        updatedAt: now,
      }));
      setSelection(copies.map((item) => item.id), copies.at(-1)?.id);
      commit([...ctx.getItems(), ...copies]);
      ctx.showToast(copies.length > 1 ? "Объекты продублированы" : "Объект продублирован");
    }

    function duplicateSelected() {
      if (!selectedIds.size) return;
      copySelected({ silent: true });
      pasteClipboard();
    }

    function toggleGroupSelected() {
      const items = selectedItems();
      if (items.length < 2) return;
      if (items.some((item) => item.locked)) {
        ctx.showToast("Сначала разблокируй объекты");
        return;
      }
      pushUndo();
      const currentGroupId = selectedGroupId(items);
      const nextGroupId = currentGroupId ? "" : ctx.createId();
      const ids = new Set(items.map((item) => item.id));
      const now = new Date().toISOString();
      commit(ctx.getItems().map((item) => ids.has(item.id)
        ? { ...item, groupId: nextGroupId, updatedAt: now }
        : item));
      ctx.showToast(currentGroupId ? "Группа разобрана" : "Объекты сгруппированы");
    }

    function moveSelectionLayer(direction) {
      const items = selectedItems();
      if (!items.length) return;
      if (items.some((item) => item.locked)) {
        ctx.showToast("Сначала разблокируй объекты");
        return;
      }
      pushUndo();
      const ids = new Set(items.map((item) => item.id));
      const ordered = [...ctx.getItems()].sort((left, right) => left.z - right.z);
      const selected = ordered.filter((item) => ids.has(item.id));
      const rest = ordered.filter((item) => !ids.has(item.id));
      const next = (direction === "back" ? [...selected, ...rest] : [...rest, ...selected])
        .map((item, index) => ({ ...item, z: index, updatedAt: ids.has(item.id) ? new Date().toISOString() : item.updatedAt }));
      commit(next);
    }

    function toggleLockSelected() {
      const items = selectedItems();
      if (!items.length) return;
      pushUndo();
      const ids = new Set(items.map((item) => item.id));
      const locked = !items.every((item) => item.locked);
      const now = new Date().toISOString();
      commit(ctx.getItems().map((item) => ids.has(item.id)
        ? { ...item, locked, updatedAt: now }
        : item));
      ctx.showToast(locked ? "Объект заблокирован" : "Объект разблокирован");
    }

    function focusPrimarySelection() {
      findItemNode(selectedId)?.focus({ preventScroll: true });
    }

    function moveSelectedWithKeyboard(key, distance) {
      if (!selectedIds.size || selectedItems().some((item) => item.locked)) return;
      const delta = {
        ArrowLeft: { x: -distance, y: 0 },
        ArrowRight: { x: distance, y: 0 },
        ArrowUp: { x: 0, y: -distance },
        ArrowDown: { x: 0, y: distance },
      }[key];
      if (!delta) return;
      pushUndo();
      commit(ctx.getItems().map((candidate) => selectedIds.has(candidate.id)
        ? {
            ...candidate,
            x: candidate.x + delta.x,
            y: candidate.y + delta.y,
            updatedAt: new Date().toISOString(),
          }
        : candidate));
    }

    function commit(items, options = {}) {
      ctx.commitItems(ctx.model.normalizeItems(items, { createId: ctx.createId }), options);
      render();
    }

    async function loadImage(item) {
      const node = findItemNode(item.id);
      const image = node?.querySelector("img");
      const placeholder = node?.querySelector(".board-image-placeholder");
      if (!image) return;
      let url = objectUrls.get(item.assetId);
      try {
        if (!url) {
          const blob = await ctx.assets.resolveBlob(item);
          if (!blob) throw new Error(item.remotePath
            ? "Не удалось загрузить фото из Supabase"
            : "Фото ещё не перенесено в Supabase");
          if (!image.isConnected) return;
          url = cacheImageUrl(item.assetId, blob);
        }
      } catch (error) {
        showBrokenImage(placeholder, error?.message);
        return;
      }

      image.addEventListener("load", () => {
        if (placeholder) {
          placeholder.hidden = true;
          delete placeholder.dataset.state;
        }
      }, { once: true });
      image.addEventListener("error", () => {
        const cachedUrl = objectUrls.get(item.assetId);
        if (cachedUrl === url) {
          URL.revokeObjectURL(cachedUrl);
          objectUrls.delete(item.assetId);
        }
        showBrokenImage(placeholder, "Файл изображения повреждён или недоступен");
      }, { once: true });
      image.src = url;
    }

    function cacheImageUrl(assetId, blob) {
      const previous = objectUrls.get(assetId);
      if (previous) URL.revokeObjectURL(previous);
      const url = URL.createObjectURL(blob);
      objectUrls.set(assetId, url);
      return url;
    }

    function showBrokenImage(placeholder, message) {
      if (!placeholder) return;
      placeholder.hidden = false;
      placeholder.textContent = message || "Не удалось отобразить изображение";
      placeholder.dataset.state = "error";
    }

    function syncLegacyImages(items) {
      items
        .filter((item) => item.type === "image" && !item.remotePath)
        .forEach((item) => {
          const lastAttempt = pendingUploadAttempts.get(item.assetId) || 0;
          if (Date.now() - lastAttempt < 30000) return;
          pendingUploadAttempts.set(item.assetId, Date.now());
          uploadLegacyImage(item);
        });
    }

    async function uploadLegacyImage(item) {
      try {
        const remotePath = await ctx.assets.upload(item);
        if (!remotePath) return;
        const current = ctx.getItems().find((candidate) => candidate.id === item.id);
        if (!current || current.remotePath) return;
        ctx.commitItems(ctx.getItems().map((candidate) => candidate.id === item.id
          ? { ...candidate, remotePath, updatedAt: new Date().toISOString() }
          : candidate), { render: false });
        pendingUploadAttempts.delete(item.assetId);
        setStatus("Старое фото перенесено в Supabase Storage", "cloud");
      } catch (error) {
        setStatus(error.message || "Не удалось перенести фото в Supabase", "error");
      }
    }

    function releaseUnusedObjectUrls(items) {
      const liveIds = new Set(items.filter((item) => item.type === "image").map((item) => item.assetId));
      objectUrls.forEach((url, assetId) => {
        if (liveIds.has(assetId)) return;
        URL.revokeObjectURL(url);
        objectUrls.delete(assetId);
      });
    }

    function showImageError(error) {
      const message = error?.message || "Не удалось загрузить изображение в Supabase";
      setStatus(message, "error");
      ctx.showToast(message);
    }

    function pushUndo() {
      recordUndo(cloneItems(ctx.getItems()));
    }

    function recordUndo(snapshot) {
      undoStack.push(snapshot);
      redoStack = [];
      trimHistory();
    }

    function trimHistory() {
      if (undoStack.length > MAX_UNDO) undoStack = undoStack.slice(-MAX_UNDO);
      if (redoStack.length > MAX_UNDO) redoStack = redoStack.slice(-MAX_UNDO);
      syncHistoryControls();
    }

    function syncHistoryControls() {
      if (ctx.els.boardUndo) ctx.els.boardUndo.disabled = undoStack.length === 0;
      if (ctx.els.boardRedo) ctx.els.boardRedo.disabled = redoStack.length === 0;
    }

    function nextZ() {
      return Math.max(0, ...ctx.getItems().map((item) => item.z || 0)) + 1;
    }

    function setInteractionMode(mode) {
      interactionMode = mode === "pan" ? "pan" : "select";
      if (interactionMode === "pan") setSelection([]);
      syncInteractionMode();
      ctx.els.boardViewport?.focus({ preventScroll: true });
    }

    function syncInteractionMode() {
      ctx.els.boardViewport.dataset.mode = interactionMode;
      [
        [ctx.els.boardModeSelect, interactionMode === "select"],
        [ctx.els.boardModePan, interactionMode === "pan"],
      ].forEach(([button, active]) => {
        button?.classList.toggle("is-active", active);
        button?.setAttribute("aria-pressed", String(active));
      });
    }

    function createGuideNodes() {
      return ["vertical", "horizontal"].map((direction) => {
        const guide = document.createElement("div");
        guide.className = `board-snap-guide is-${direction}`;
        guide.dataset.boardGuide = direction;
        guide.hidden = true;
        guide.setAttribute("aria-hidden", "true");
        return guide;
      });
    }

    function initializeCamera() {
      if (cameraReady) return;
      cameraReady = true;
      if (!camera) {
        const rect = ctx.els.boardViewport.getBoundingClientRect();
        camera = cameraApi.initialCamera(rect);
      }
    }

    function applyCamera() {
      if (!camera) return;
      ctx.els.boardWorld.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
      ctx.els.boardWorld.style.setProperty("--board-unit", `${1 / camera.zoom}px`);
      ctx.els.boardZoomLabel.textContent = cameraApi.formatZoom(camera.zoom);
      ctx.els.boardViewport.style.setProperty("--board-grid-size", `${Math.max(6, 24 * camera.zoom)}px`);
      ctx.els.boardViewport.style.setProperty("--board-grid-x", `${camera.x}px`);
      ctx.els.boardViewport.style.setProperty("--board-grid-y", `${camera.y}px`);
      ctx.els.boardViewport.classList.toggle("is-grid-hidden", camera.zoom < 0.12);
    }

    function scheduleCameraVisibilityCheck(items) {
      const schedule = global.requestAnimationFrame || ((callback) => global.setTimeout(callback, 0));
      schedule(() => ensureContentVisible(items));
    }

    function ensureContentVisible(items) {
      if (cameraVisibilityChecked || !isBoardActive() || !items.length) return;
      const rect = ctx.els.boardViewport.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const content = ctx.model.bounds(items);
      if (!content) return;
      cameraVisibilityChecked = true;
      const margin = 32;
      const projected = cameraApi.projectBounds(camera, content);
      const isVisible = projected.right >= margin
        && projected.bottom >= margin
        && projected.left <= rect.width - margin
        && projected.top <= rect.height - margin;
      if (!isVisible) focusContent();
    }

    function saveCamera() {
      cameraApi.saveCamera(global.localStorage, CAMERA_KEY, camera);
    }

    function viewportCenter() {
      const rect = ctx.els.boardViewport.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function screenToWorld(clientX, clientY) {
      const rect = ctx.els.boardViewport.getBoundingClientRect();
      return cameraApi.screenToWorld(camera, rect, clientX, clientY);
    }

    function findItemNode(id) {
      return ctx.els.boardWorld.querySelector(`[data-id="${cssEscape(id)}"]`);
    }

    function setStatus(message, state = "") {
      if (!ctx.els.boardStatus) return;
      ctx.els.boardStatus.textContent = message;
      ctx.els.boardStatus.dataset.state = state;
    }

    function isBoardActive() {
      return document.body.dataset.view === "board";
    }

    return {
      bindEvents,
      focusContent,
      render,
    };
  }

  function resizeGeometry(item, dx, dy, direction) {
    const minWidth = item.type === "frame" ? 240 : 40;
    const minHeight = item.type === "frame" ? 160 : item.type === "image" ? 40 : 24;
    const maxSize = 10000;
    const hasWest = direction.includes("w");
    const hasEast = direction.includes("e");
    const hasNorth = direction.includes("n");
    const hasSouth = direction.includes("s");
    const isCorner = (hasWest || hasEast) && (hasNorth || hasSouth);

    if (item.type === "image" && isCorner) {
      const rawWidth = clamp(item.width + (hasEast ? dx : -dx), minWidth, maxSize);
      const rawHeight = clamp(item.height + (hasSouth ? dy : -dy), minHeight, maxSize);
      const ratio = item.width / Math.max(item.height, 1);
      const widthChange = Math.abs(rawWidth - item.width) / Math.max(item.width, 1);
      const heightChange = Math.abs(rawHeight - item.height) / Math.max(item.height, 1);
      let width = rawWidth;
      let height = clamp(width / ratio, minHeight, maxSize);
      if (heightChange > widthChange) {
        height = rawHeight;
        width = clamp(height * ratio, minWidth, maxSize);
      }
      return {
        x: hasWest ? item.x + item.width - width : item.x,
        y: hasNorth ? item.y + item.height - height : item.y,
        width,
        height,
      };
    }

    let left = item.x;
    let top = item.y;
    let right = item.x + item.width;
    let bottom = item.y + item.height;
    if (hasWest) left = Math.min(right - minWidth, left + dx);
    if (hasEast) right = Math.max(left + minWidth, right + dx);
    if (hasNorth) top = Math.min(bottom - minHeight, top + dy);
    if (hasSouth) bottom = Math.max(top + minHeight, bottom + dy);
    return {
      x: left,
      y: top,
      width: clamp(right - left, minWidth, maxSize),
      height: clamp(bottom - top, minHeight, maxSize),
    };
  }

  function fitImage(width, height) {
    const scale = Math.min(1, 520 / width, 420 / height);
    return {
      width: Math.max(80, Math.round(width * scale)),
      height: Math.max(80, Math.round(height * scale)),
    };
  }

  function snapMove(movingItems, targetItems, dx, dy, threshold = 7) {
    const moving = itemBounds(movingItems);
    if (!moving || !targetItems.length) return { dx, dy, vertical: NaN, horizontal: NaN };
    const movingX = [moving.left + dx, moving.left + moving.width / 2 + dx, moving.right + dx];
    const movingY = [moving.top + dy, moving.top + moving.height / 2 + dy, moving.bottom + dy];
    const targetX = targetItems.flatMap((item) => [item.x, item.x + item.width / 2, item.x + item.width]);
    const targetY = targetItems.flatMap((item) => [item.y, item.y + item.height / 2, item.y + item.height]);
    const xSnap = closestSnap(movingX, targetX, threshold);
    const ySnap = closestSnap(movingY, targetY, threshold);
    return {
      dx: dx + (xSnap?.delta || 0),
      dy: dy + (ySnap?.delta || 0),
      vertical: xSnap?.target ?? NaN,
      horizontal: ySnap?.target ?? NaN,
    };
  }

  function closestSnap(sources, targets, threshold) {
    let best = null;
    sources.forEach((source) => {
      targets.forEach((target) => {
        const delta = target - source;
        if (Math.abs(delta) > threshold) return;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, target };
      });
    });
    return best;
  }

  function itemBounds(items = []) {
    if (!items.length) return null;
    const left = Math.min(...items.map((item) => item.x));
    const top = Math.min(...items.map((item) => item.y));
    const right = Math.max(...items.map((item) => item.x + item.width));
    const bottom = Math.max(...items.map((item) => item.y + item.height));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function applyNodeGeometry(node, item) {
    node.style.width = `${item.width}px`;
    node.style.height = `${item.height}px`;
    node.style.transform = `translate(${item.x}px, ${item.y}px)`;
    node.style.zIndex = String(item.z);
  }

  function editableText(node) {
    return String(node.innerText || node.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .slice(0, 20000);
  }

  function placeCaretAtEnd(node) {
    const selection = global.getSelection?.();
    if (!selection) return;
    const range = global.document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function cloneItems(items) {
    return JSON.parse(JSON.stringify(items || []));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function cssEscape(value) {
    return global.CSS?.escape ? global.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }

  const api = {
    MAX_ZOOM,
    MIN_ZOOM,
    createBoardView,
    fitImage,
    resizeGeometry,
    snapMove,
  };
  global.RhythmBoardView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
