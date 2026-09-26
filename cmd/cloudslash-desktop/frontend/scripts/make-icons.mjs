/**
 * Renders the application mark into the image formats each platform needs.
 *
 *   node scripts/make-icons.mjs
 *
 * Writes into ../../assets/ (which is the package directory, so main.go can
 * embed the PNG) and leaves the .icns to iconutil on macOS, since that format
 * has no encoder worth hand-writing.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import puppeteer from "puppeteer-core";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "..", "..", "assets");
const svg = readFileSync(join(assets, "appicon.svg"), "utf8");

const CHROME =
  process.env.CHROME_PATH ??
  ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((path) => existsSync(path));

if (!CHROME) {
  console.error("make-icons: no chromium found. Set CHROME_PATH to one.");
  process.exit(1);
}

/** Sizes the different formats ask for, largest first. */
const SIZES = [1024, 512, 256, 128, 64, 48, 32, 16];

async function render(size, page, out) {
  const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;

  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: out, omitBackground: true });
}

/**
 * Builds a .ico around PNG payloads. Windows has accepted PNG-compressed
 * entries since Vista, so this needs no pixel encoder.
 */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  const directory = Buffer.alloc(16 * pngs.length);
  let offset = header.length + directory.length;

  pngs.forEach(({ size, data }, index) => {
    const at = index * 16;
    // 256 is encoded as 0 in a single byte.
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...pngs.map((png) => png.data)]);
}

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage();

const pngs = [];
for (const size of SIZES) {
  const out = join(assets, `appicon-${size}.png`);
  await render(size, page, out);
  pngs.push({ size, data: readFileSync(out) });
}
await browser.close();

// The embed target and the Linux launcher icon.
writeFileSync(join(assets, "appicon.png"), pngs.find((png) => png.size === 512).data);

// Windows: PNG entries only, smallest useful set.
writeFileSync(
  join(assets, "appicon.ico"),
  buildIco(pngs.filter((png) => [256, 128, 64, 48, 32, 16].includes(png.size))),
);

// macOS: iconutil wants this exact set of names inside a .iconset, and rejects
// anything else it finds there.
const iconset = join(assets, "appicon.iconset");
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

const bySize = new Map(pngs.map((png) => [png.size, png.data]));
for (const size of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${size}x${size}.png`), bySize.get(size));
  const retina = bySize.get(size * 2);
  if (retina) writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), retina);
}

writeFileSync(
  join(assets, "cloudslash.desktop"),
  [
    "[Desktop Entry]",
    "Type=Application",
    "Name=CloudSlash",
    "Comment=Autonomous cloud waste detection",
    "Exec=cloudslash-desktop",
    "Icon=cloudslash",
    "Terminal=false",
    "Categories=Development;Utility;",
    "",
  ].join("\n"),
);

if (process.platform === "darwin") {
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(assets, "appicon.icns")], { stdio: "inherit" });
  console.log("make-icons: wrote appicon.icns");
} else {
  console.log("make-icons: skipped appicon.icns (needs macOS iconutil; CI builds it)");
}

console.log(`make-icons: wrote ${SIZES.length} pngs, appicon.ico and cloudslash.desktop into ${assets}`);
