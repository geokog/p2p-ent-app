/**
 * Copy `pdfjs-dist/build/pdf.worker.min.mjs` into `public/pdf.worker.mjs` so the
 * PDF.js viewer can load a same-origin worker pinned to the exact `pdfjs-dist`
 * version this app installs.
 *
 * The worker MUST be pulled from `node_modules` rather than a CDN — version
 * skew between the API bundle and a CDN-hosted worker silently breaks
 * rendering, and the CDN may not be reachable from CI.
 *
 * Wired into `npm install` (postinstall) and `npm run build` (prebuild) in
 * package.json so a fresh clone always has a matching worker on disk.
 */
import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(
  __dirname,
  "..",
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
);
const dst = resolve(__dirname, "..", "public/pdf.worker.mjs");

await mkdir(dirname(dst), { recursive: true });
await cp(src, dst);
console.log(`copied ${src} → ${dst}`);
