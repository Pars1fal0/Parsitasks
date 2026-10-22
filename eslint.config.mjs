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
    // Classic browser scripts: modules expose themselves on window.Rhythm* and load via <script> tags.
    // Shared modules also run under Node in unit tests, hence module/require.
    files: ["app/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, module: "readonly", require: "readonly" },
    },
  },
  {
    files: ["mcp/oauth-consent-entry.mjs"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["app/sw.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
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
