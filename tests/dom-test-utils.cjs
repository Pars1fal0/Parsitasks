class FakeNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(typeof node === "string" ? new FakeText(node) : node));
  }

  appendChild(node) {
    if (!node) return node;
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.childNodes.forEach((node) => {
      node.parentNode = null;
    });
    this.childNodes = [];
    this.append(...nodes);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter((node) => node !== this);
    this.parentNode = null;
  }

  after(...nodes) {
    if (!this.parentNode) return;
    const index = this.parentNode.childNodes.indexOf(this);
    nodes.forEach((node, offset) => { node.parentNode = this.parentNode; this.parentNode.childNodes.splice(index + offset + 1, 0, node); });
  }

  contains(node) {
    if (node === this) return true;
    return this.childNodes.some((child) => child === node || child.contains?.(node));
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof FakeElement);
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  set textContent(value) {
    this.childNodes = value == null || value === "" ? [] : [new FakeText(String(value))];
  }
}

class FakeText extends FakeNode {
  constructor(text) {
    super();
    this.nodeType = 3;
    this.value = String(text);
  }

  get textContent() {
    return this.value;
  }

  set textContent(value) {
    this.value = String(value ?? "");
  }

  cloneNode() {
    return new FakeText(this.value);
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.dataset = {};
    this.eventListeners = {};
    this.hidden = false;
    this.style = {
      values: {},
      removeProperty: (name) => delete this.style.values[name],
      setProperty: (name, value) => {
        this.style.values[name] = String(value);
      },
    };
    Object.defineProperty(this.style, "width", {
      get: () => this.style.values.width,
      set: (value) => {
        this.style.values.width = String(value);
      },
    });
    this.classList = {
      add: (...names) => names.forEach((name) => this.#classes.add(name)),
      contains: (name) => this.#classes.has(name),
      remove: (...names) => names.forEach((name) => this.#classes.delete(name)),
      toggle: (name, force) => {
        const next = force ?? !this.#classes.has(name);
        if (next) this.#classes.add(name);
        else this.#classes.delete(name);
        return next;
      },
    };
  }

  #classes = new Set();

  get className() {
    return [...this.#classes].join(" ");
  }

  set className(value) {
    this.#classes = new Set(String(value || "").split(/\s+/).filter(Boolean));
  }

  set innerHTML(_value) {
    throw new Error("innerHTML is not allowed in DOM render tests");
  }

  get innerHTML() {
    return this.textContent;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = value;
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, handler) {
    this.eventListeners[type] ||= [];
    this.eventListeners[type].push(handler);
  }

  dispatchEvent(event) {
    const nextEvent = { ...event, currentTarget: this, target: event?.target || this };
    (this.eventListeners[nextEvent.type] || []).forEach((handler) => handler(nextEvent));
    return true;
  }

  closest(selector) {
    let node = this;
    while (node instanceof FakeElement) {
      if (matchesSelectorList(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  cloneNode(deep = false) {
    const clone = new FakeElement(this.tagName);
    clone.className = this.className;
    clone.hidden = this.hidden;
    clone.value = this.value;
    clone.type = this.type;
    clone.draggable = this.draggable;
    clone.textContent = this.textContent;
    this.attributes.forEach((value, key) => clone.setAttribute(key, value));
    Object.assign(clone.dataset, this.dataset);
    Object.assign(clone.style.values, this.style.values);
    if (deep) {
      clone.replaceChildren(...this.childNodes.map((node) => node.cloneNode(true)));
    }
    return clone;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const normalized = selector.replace(":scope > ", "");
    const visit = (node) => {
      if (node instanceof FakeElement && matchesSelector(node, normalized)) results.push(node);
      node.childNodes.forEach(visit);
    };
    this.childNodes.forEach(visit);
    return results;
  }
}

class FakeTemplate extends FakeElement {
  constructor() {
    super("template");
    this.content = new FakeElement("fragment");
  }
}

function matchesSelector(element, selector) {
  if (selector.includes(",")) return matchesSelectorList(element, selector);
  if (selector.startsWith(".")) {
    return selector
      .slice(1)
      .split(".")
      .every((className) => element.classList.contains(className));
  }
  if (selector.startsWith("#")) return element.getAttribute("id") === selector.slice(1);
  return element.tagName.toLowerCase() === selector.toLowerCase();
}

function matchesSelectorList(element, selector) {
  return String(selector)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .some((item) => matchesSelector(element, item));
}

function createElement(tagName) {
  return tagName === "template" ? new FakeTemplate() : new FakeElement(tagName);
}

function installDom() {
  const document = {
    body: createElement("body"),
    addEventListener: (...args) => document.body.addEventListener(...args),
    createElement,
    createElementNS: (_namespace, tagName) => createElement(tagName),
    createTextNode: (text) => new FakeText(text),
    querySelectorAll: (...args) => document.body.querySelectorAll(...args),
    querySelector: (...args) => document.body.querySelector(...args),
  };
  global.document = document;
  global.window = global;
  global.Node = FakeNode;
  return document;
}

module.exports = { FakeElement, FakeNode, FakeTemplate, installDom };
