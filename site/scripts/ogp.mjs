#!/usr/bin/env node
// Capture the kakitori OGP image from the site's hero row.
//
// Usage:
//   pnpm -C site dev &           # leave running
//   pnpm -C site ogp             # writes site/public/ogp.png
//
// Or pass a different base URL (e.g. for the built preview):
//   BASE_URL=http://localhost:4173 pnpm -C site ogp

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const ANIM_WAIT_MS = Number.parseInt(process.env.ANIM_WAIT_MS ?? "3560", 10);
const OUT = resolve(__dirname, "../public/ogp.png");

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  // Vite keeps an HMR websocket alive, so `networkidle` never fires under dev.
  await page.goto(`${BASE_URL}/?ogp=1`, { waitUntil: "load" });
  // Hold while the 永 SVG mounts and the animate() call paints partial strokes.
  await page.waitForTimeout(ANIM_WAIT_MS);
  await page.screenshot({
    path: OUT,
    clip: { x: 0, y: 0, width: 1280, height: 640 },
  });
  console.log(`wrote ${OUT}`);
} finally {
  await browser.close();
}
