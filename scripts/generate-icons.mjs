/**
 * Generate PWA icons for Camera Monitor.
 *
 * Design: iOS-style — white camera icon on iOS blue (#007AFF) background
 * with iOS-standard rounded corners.
 */
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const IOS_BLUE = "#007AFF";
const WHITE = "#ffffff";

function makeSvg(size) {
  const cx = size / 2;
  const cy = size / 2;
  const s = size / 100; // scale factor

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="${IOS_BLUE}"/>
  <g transform="translate(${cx}, ${cy}) scale(${s})">
    <!-- Camera body -->
    <rect x="-32" y="-17" width="44" height="34" rx="5" fill="${WHITE}"/>
    <!-- Lens -->
    <circle cx="-10" cy="0" r="12" fill="${IOS_BLUE}"/>
    <circle cx="-10" cy="0" r="8.5" fill="${WHITE}"/>
    <circle cx="-10" cy="0" r="5" fill="${IOS_BLUE}"/>
    <circle cx="-10" cy="0" r="2.5" fill="${WHITE}" opacity="0.5"/>
    <!-- Viewfinder -->
    <rect x="-28" y="-23" width="12" height="7" rx="2" fill="${WHITE}"/>
    <!-- Signal waves -->
    <path d="M 19 -10 Q 29 0 19 10" stroke="${WHITE}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M 26 -16 Q 40 0 26 16" stroke="${WHITE}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M 33 -22 Q 50 0 33 22" stroke="${WHITE}" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.7"/>
  </g>
</svg>`;
}

function makeBadgeSvg(size) {
  const cx = size / 2;
  const cy = size / 2;
  const s = size / 100;

  // Monochrome badge — white on transparent for notification badges
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${cx}, ${cy}) scale(${s})">
    <rect x="-32" y="-17" width="44" height="34" rx="5" fill="${WHITE}"/>
    <circle cx="-10" cy="0" r="12" fill="#000"/>
    <circle cx="-10" cy="0" r="8" fill="${WHITE}"/>
    <circle cx="-10" cy="0" r="4.5" fill="#000"/>
    <rect x="-28" y="-23" width="12" height="7" rx="2" fill="${WHITE}"/>
    <path d="M 19 -10 Q 29 0 19 10" stroke="${WHITE}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M 26 -16 Q 40 0 26 16" stroke="${WHITE}" stroke-width="3" fill="none" stroke-linecap="round"/>
  </g>
</svg>`;
}

async function generate() {
  await sharp(Buffer.from(makeSvg(512))).png().toFile(path.join(publicDir, "icon-512x512.png"));
  console.log("icon-512x512.png");

  await sharp(Buffer.from(makeSvg(192))).png().toFile(path.join(publicDir, "icon-192x192.png"));
  console.log("icon-192x192.png");

  await sharp(Buffer.from(makeSvg(180))).png().toFile(path.join(publicDir, "apple-touch-icon.png"));
  console.log("apple-touch-icon.png");

  await sharp(Buffer.from(makeBadgeSvg(96))).png().toFile(path.join(publicDir, "badge-mono.png"));
  console.log("badge-mono.png");

  console.log("Done!");
}

generate().catch(console.error);
