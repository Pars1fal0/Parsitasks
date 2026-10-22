// The desktop smoke check and UI tests drive the app through page globals, as they
// did when app.js was a classic script. Expose app bindings as window accessors.
export function exposePageGlobals(bindings) {
  for (const [name, [get, set]] of Object.entries(bindings)) {
    const existing = Object.getOwnPropertyDescriptor(globalThis, name);
    if (existing && !existing.configurable) continue;
    Object.defineProperty(globalThis, name, { configurable: true, enumerable: false, get, set });
  }
}

// Expose every export of the given module namespaces, plus the mutable fields of stores.
export function exposeModules(namespaces = [], stores = []) {
  const bindings = {};
  namespaces.forEach((namespace) => {
    Object.keys(namespace).filter((name) => name !== "default").forEach((name) => {
      bindings[name] = [() => namespace[name]];
    });
  });
  stores.forEach((store) => {
    Object.keys(store).forEach((name) => {
      bindings[name] = [() => store[name], (value) => { store[name] = value; }];
    });
  });
  exposePageGlobals(bindings);
}
