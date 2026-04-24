// One-shot stub-icon generator for the PWA install path. Replace
// public/icons/* with real art from Temur when available; this script
// just unblocks Home Screen install with a dark tile + serif "W".
//
// Run: node scripts/make-pwa-icons.mjs

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "public", "icons");

const BG = "#1A1714"; // matches avatar-stage background (globals.css)
const FG = "#F5F0E8"; // cream, matches Erewhon design tokens

function svgTile(size) {
  const fontSize = Math.round(size * 0.65);
  // Cormorant Garamond is the display font (app/layout.tsx); stub uses
  // a generic serif so we don't ship font files to the rasteriser.
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
       <rect width="${size}" height="${size}" fill="${BG}"/>
       <text x="50%" y="50%" fill="${FG}" font-family="Cormorant Garamond, Georgia, serif"
             font-weight="500" font-size="${fontSize}"
             text-anchor="middle" dominant-baseline="central">W</text>
     </svg>`
  );
}

async function renderAt(size, filename) {
  const out = path.join(outDir, filename);
  await sharp(svgTile(size)).png().toFile(out);
  console.log("wrote", out);
}

await renderAt(180, "apple-touch-icon.png"); // iPad Home Screen
await renderAt(192, "icon-192.png");          // PWA manifest
await renderAt(512, "icon-512.png");          // PWA manifest (maskable)
