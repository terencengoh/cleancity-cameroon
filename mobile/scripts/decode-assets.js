// Decodes the committed base64 artwork (assets/*.png.b64) into the PNGs Expo needs.
// Why: the repo is updated through a text-only API, so binary PNGs are stored as base64.
// Runs automatically from app.config.ts (expo start / export / prebuild / EAS) and on postinstall.
const fs = require("fs");
const path = require("path");

function decodeAssets() {
  const dir = path.join(__dirname, "..", "assets");
  if (!fs.existsSync(dir)) return [];
  const written = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".png.b64")) continue;
    const out = path.join(dir, name.slice(0, -4));
    const buf = Buffer.from(fs.readFileSync(path.join(dir, name), "utf8").trim(), "base64");
    if (fs.existsSync(out) && fs.readFileSync(out).equals(buf)) continue;
    fs.writeFileSync(out, buf);
    written.push(path.basename(out));
  }
  return written;
}

module.exports = { decodeAssets };

if (require.main === module) {
  const w = decodeAssets();
  console.log(w.length ? `decoded: ${w.join(", ")}` : "assets up to date");
}
