const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const destination = path.join(root, "app/assets/vendor");
fs.mkdirSync(destination, { recursive: true });
esbuild.buildSync({
  entryPoints: [require.resolve("chart.js/auto")], bundle: true, minify: true,
  format: "iife", globalName: "RhythmCharts", platform: "browser", target: "es2022",
  outfile: path.join(destination, "chart.js"), legalComments: "eof",
});
fs.copyFileSync(path.join(root, "node_modules/chart.js/LICENSE.md"), path.join(destination, "chart.LICENSE.txt"));
console.log("Local Chart.js bundle updated");
