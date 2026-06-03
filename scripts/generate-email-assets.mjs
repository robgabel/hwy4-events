// Rasterize the site's brand marks for the HTML newsletter.
//
// Email clients (Gmail especially) do not render <svg> or <img src="*.svg">, so
// the newsletter header can't reuse the site's SVG assets directly. This script
// renders the same marks the site uses — the Calaveras Big Trees sequoia (paths
// copied from components/Header.tsx) and Millie (public/millie-happy.svg) — into
// retina PNGs under public/email/, which deploy with the site and are served from
// SITE_URL at send time. Colors come from the @theme tokens in app/globals.css:
//   forest #1B3A2D · sage-light #B5C4A8.
//
// Re-run after changing the marks:  node scripts/generate-email-assets.mjs
import sharp from "sharp";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "email");
await mkdir(outDir, { recursive: true });

// The Big Trees sequoia, in sage-light — flanks the title like the site header.
const treeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 40" fill="#B5C4A8">
  <path d="M12 33h4v7h-4z"/>
  <path d="M14 12 3 34h22z"/>
  <path d="M14 7 6 24h16z"/>
  <path d="M14 3 9 16h10z"/>
</svg>`;

const tree = await sharp(Buffer.from(treeSvg), { density: 384 })
  .resize({ width: 88 }) // displayed ~22px wide (4x for retina)
  .png()
  .toFile(join(outDir, "tree.png"));

// Millie — front-facing, happy. Dark line-art on transparency; sits on the cream
// below the green hero, exactly as on the site.
const millieSvg = await readFile(join(root, "public", "millie-happy.svg"));
const millie = await sharp(millieSvg, { density: 384 })
  .resize({ width: 240 }) // displayed ~80px wide (3x for retina)
  .png()
  .toFile(join(outDir, "millie-happy.png"));

console.log(`tree.png        ${tree.width}x${tree.height}`);
console.log(`millie-happy.png ${millie.width}x${millie.height}`);
