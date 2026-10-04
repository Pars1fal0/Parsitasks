(function (global) {
  const presets = {
    emerald: "#27c6a5", blue: "#5aa7ff", orange: "#ff9b45", violet: "#a78bfa",
    rose: "#f58bb4", cyan: "#53cedd", amber: "#e5c454", lime: "#afce65",
  };
  const tokens = ["--teal", "--teal-deep", "--button-primary", "--teal-soft", "--accent-rgb", "--accent-strong-rgb", "--logo-filter"];
  function normalize(value) {
    if (typeof value === "string" && Object.hasOwn(presets, value)) return value;
    const hex = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
    if (/^#[0-9a-f]{3}$/.test(hex)) return `#${[...hex.slice(1)].map((letter) => letter + letter).join("")}`;
    return "emerald";
  }
  function rgb(hex) { return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)); }
  function hex(channels) { return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`; }
  function luminance(color) {
    return rgb(color).reduce((sum, channel, index) => {
      const value = channel / 255;
      return sum + (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index];
    }, 0);
  }
  function contrast(a, b) {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + .05) / (values[1] + .05);
  }
  function readable(color, background, towards) {
    const original = rgb(color), target = rgb(towards);
    for (let step = 0; step <= 100; step++) {
      const candidate = hex(original.map((channel, index) => channel + (target[index] - channel) * step / 100));
      if (contrast(candidate, background) >= 4.5) return candidate;
    }
    return towards;
  }
  function hue(color) {
    const [r, g, b] = rgb(color).map((channel) => channel / 255);
    const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
    if (!delta) return 0;
    return ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
  }
  function palette(value, theme = "dark") {
    const chosen = presets[normalize(value)] || normalize(value);
    const accent = readable(chosen, theme === "light" ? "#ffffff" : "#232729", theme === "light" ? "#000000" : "#ffffff");
    const primary = readable(chosen, "#ffffff", "#000000");
    const saturation = Math.max(...rgb(chosen)) === Math.min(...rgb(chosen)) ? "grayscale(1)" : `hue-rotate(${hue(chosen) - hue(presets.emerald)}deg)`;
    return {
      "--teal": accent, "--teal-deep": accent, "--button-primary": primary,
      "--teal-soft": `rgb(${rgb(accent).join(" ")} / 14%)`, "--accent-rgb": rgb(accent).join(" "),
      "--accent-strong-rgb": rgb(primary).join(" "), "--logo-filter": saturation,
    };
  }
  function apply(root, value, theme) {
    tokens.forEach((token) => root.style.removeProperty(token));
    // Existing four themes keep their established CSS colors.
    if (["emerald", "blue", "orange", "violet"].includes(normalize(value))) return;
    Object.entries(palette(value, theme)).forEach(([token, color]) => root.style.setProperty(token, color));
  }
  const api = { presets, normalize, palette, contrast, apply };
  global.RhythmAccentColors = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
