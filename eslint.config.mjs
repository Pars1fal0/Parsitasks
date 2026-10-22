import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/", "dist/", "web-dist/", ".web-build-*/", ".wrangler-build/", ".release-candidate/", "docs/", "app/assets/vendor/"],
  },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Sanitizers strip NUL and other control characters on purpose.
      "no-control-regex": "off",
    },
  },
  {
    files: ["app/**/*.js"],
    languageOptions: { sourceType: "module", globals: { ...globals.browser } },
  },
  {
    files: ["mcp/oauth-consent-entry.mjs"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // The service worker stays a classic script.
    files: ["app/sw.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.serviceworker } },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
  },
  {
    files: ["mcp/**/*.mjs", "scripts/**/*.mjs", "*.mjs"],
    languageOptions: { sourceType: "module", globals: { ...globals.node, ...globals.worker } },
  },
  {
    // Playwright page.evaluate callbacks run in the browser.
    files: ["tests/**/*.cjs", "scripts/**/*.cjs"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // page.evaluate callbacks call the app's top-level functions, which ESLint cannot see.
    files: ["tests/**/*-e2e.cjs"],
    rules: { "no-undef": "off" },
  },
];
