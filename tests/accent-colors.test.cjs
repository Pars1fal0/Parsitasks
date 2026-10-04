const assert = require("node:assert/strict");
const colors = require("../app/src/settings/accent-colors.js");
const settings = require("../app/src/settings/settings-state.js").createSettingsState();
const profile = require("../app/src/settings/profile-settings.js");
module.exports = [
  { name: "accent presets and hex values normalize safely through settings and account preferences", fn() {
    for (const value of Object.keys(colors.presets)) assert.equal(settings.normalizeAccentPreference(value), value);
    assert.equal(settings.normalizeAccentPreference(" #ABC "), "#aabbcc");
    assert.equal(settings.normalizeAccentPreference("#F12ABC"), "#f12abc");
    for (const value of [null, {}, ["blue"], "url(x)", "#12345678", "#xxx", "custom", "__proto__"]) assert.equal(colors.normalize(value), "emerald");
    const entry = { accentPreference: { value: "#ABC", updatedAt: "2026-10-04T10:00:00Z" } };
    assert.equal(profile.normalizePreferences(entry).accentPreference.value, "#aabbcc");
    assert.equal(profile.mergePreferences({}, entry).accentPreference.value, "#aabbcc");
  } },
  { name: "custom colors keep accents and white button labels readable in both themes", fn() {
    for (const color of [...Object.values(colors.presets), "#000000", "#ffffff", "#010101", "#ff0000", "#0000ff", "#ffff00", "#00ff00", "#777777"]) {
      for (const theme of ["dark", "light"]) {
        const palette = colors.palette(color, theme);
        assert.ok(colors.contrast(palette["--teal"], theme === "light" ? "#ffffff" : "#232729") >= 4.5, `${color} ${theme}`);
        assert.ok(colors.contrast(palette["--button-primary"], "#ffffff") >= 4.5);
        assert.match(palette["--accent-rgb"], /^\d+ \d+ \d+$/);
      }
    }
  } },
  { name: "switching from custom to legacy palette removes every inline accent token", fn() {
    const values = new Map();
    const root = { style: { setProperty: (key, value) => values.set(key, value), removeProperty: (key) => values.delete(key) } };
    colors.apply(root, "#abcdef", "dark"); assert.equal(values.size, 7);
    colors.apply(root, "blue", "dark"); assert.equal(values.size, 0);
  } },
];
