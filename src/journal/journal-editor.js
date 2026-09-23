(function (global) {
  function readText(editor) {
    if (!editor) return "";
    if (isPlainControl(editor)) return String(editor.value || "");
    return serializeBlocks(editor).replace(/\n{3,}/g, "\n\n").trim();
  }

  function writeText(editor, value) {
    if (!editor) return;
    const text = String(value || "").replace(/\r\n?/g, "\n");
    if (isPlainControl(editor)) {
      editor.value = text;
      return;
    }
    editor.replaceChildren(...createBlocks(text, editor.ownerDocument || document));
  }

  function setPlaceholder(editor, value) {
    if (!editor) return;
    if (isPlainControl(editor)) editor.placeholder = value;
    else editor.dataset.placeholder = value;
  }

  function applyFormat(editor, format, doc = document) {
    if (!editor || isPlainControl(editor)) return false;
    editor.focus();
    if (format === "bold") {
      doc.execCommand?.("styleWithCSS", false, false);
      return Boolean(doc.execCommand?.("bold", false, null));
    }
    const tag = { body: "p", h1: "h1", h2: "h2" }[format];
    return tag ? Boolean(doc.execCommand?.("formatBlock", false, tag)) : false;
  }

  function insertPlainText(editor, text, doc = document) {
    if (!editor || isPlainControl(editor)) return false;
    return Boolean(doc.execCommand?.("insertText", false, String(text || "")));
  }

  function createBlocks(text, doc) {
    if (!text) return [];
    return text.split("\n").map((line) => {
      const heading = /^(#{1,2})\s+(.+)$/.exec(line);
      const tagName = heading?.[1].length === 1 ? "h1" : heading?.[1].length === 2 ? "h2" : "p";
      const block = doc.createElement(tagName);
      appendInline(block, heading ? heading[2] : line, doc);
      if (!block.childNodes.length) block.appendChild(doc.createElement("br"));
      return block;
    });
  }

  function appendInline(parent, text, doc) {
    const pattern = /\*\*([^*\n]+)\*\*/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) parent.appendChild(doc.createTextNode(text.slice(cursor, match.index)));
      const strong = doc.createElement("strong");
      strong.textContent = match[1];
      parent.appendChild(strong);
      cursor = pattern.lastIndex;
    }
    if (cursor < text.length) parent.appendChild(doc.createTextNode(text.slice(cursor)));
  }

  function serializeBlocks(editor) {
    return [...(editor.childNodes || [])].map((node) => serializeBlock(node)).join("\n");
  }

  function serializeBlock(node) {
    if (node.nodeType === 3) return node.textContent || "";
    const tag = String(node.tagName || "").toUpperCase();
    const content = serializeInline(node).replace(/\n+$/g, "");
    if (tag === "H1") return content ? `# ${content}` : "# ";
    if (tag === "H2") return content ? `## ${content}` : "## ";
    return content;
  }

  function serializeInline(node) {
    return [...(node.childNodes || [])].map((child) => {
      if (child.nodeType === 3) return String(child.textContent || "").replace(/\u00a0/g, " ");
      const tag = String(child.tagName || "").toUpperCase();
      if (tag === "BR") return "\n";
      const content = serializeInline(child);
      return tag === "STRONG" || tag === "B" ? `**${content}**` : content;
    }).join("");
  }

  function isPlainControl(editor) {
    return ["INPUT", "TEXTAREA"].includes(String(editor?.tagName || "").toUpperCase());
  }

  const api = { applyFormat, createBlocks, insertPlainText, readText, setPlaceholder, writeText };
  global.RhythmJournalEditor = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
