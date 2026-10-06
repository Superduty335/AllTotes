// Copies the web app (served as-is by GitHub Pages from the repo root) into www/ for the native apps.
import { cpSync, rmSync, mkdirSync } from "node:fs";

const FILES = ["index.html", "styles.css", "app.js", "sw.js", "manifest.webmanifest", "vendor", "fonts", "icons"];
rmSync("www", { recursive: true, force: true });
mkdirSync("www");
for (const f of FILES) cpSync(f, `www/${f}`, { recursive: true });
console.log(`Copied ${FILES.length} entries to www/`);
