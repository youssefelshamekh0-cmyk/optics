// شغّله من جذر المشروع:  node apply-ui-polish.mjs
import fs from "node:fs";
const p = "src/app/globals.css";
let c = fs.readFileSync(p, "utf8");
if (c.includes("/* ui-polish */")) { console.log("• جاهز من قبل"); process.exit(0); }
const eol = c.includes("\r\n") ? "\r\n" : "\n";
const css = fs.readFileSync(new URL("./ui-polish.css", import.meta.url), "utf8").trim().replace(/\r?\n/g, eol);
fs.writeFileSync(p, c.replace(/\s*$/, "") + eol + css + eol);
console.log("✅ تم تحسين الواجهة في globals.css");
