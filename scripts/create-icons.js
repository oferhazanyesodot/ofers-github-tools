/**
 * Run this script with Node.js to generate the extension icons.
 * Usage: node create-icons.js
 *
 * Creates PNG icons with a GitHub-style PR merge icon.
 * - Toolbar icons (16, 48): white icon on transparent background
 * - Store icon (128): white icon on dark rounded-rect background
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/**
 * Draw the GitHub PR icon onto a pixel buffer.
 */
function drawPRIcon(size, { withBackground = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4, 0);

  const setPixel = (x, y, r, g, b, a) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= size || iy < 0 || iy >= size) return;
    const offset = (iy * size + ix) * 4;
    const srcA = a / 255;
    const dstA = pixels[offset + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA === 0) return;
    pixels[offset] = Math.round((r * srcA + pixels[offset] * dstA * (1 - srcA)) / outA);
    pixels[offset + 1] = Math.round((g * srcA + pixels[offset + 1] * dstA * (1 - srcA)) / outA);
    pixels[offset + 2] = Math.round((b * srcA + pixels[offset + 2] * dstA * (1 - srcA)) / outA);
    pixels[offset + 3] = Math.round(outA * 255);
  };

  const fillCircle = (cx, cy, radius, r, g, b) => {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) {
          setPixel(x, y, r, g, b, 255);
        } else if (d2 <= (radius + 0.8) * (radius + 0.8)) {
          const alpha = Math.max(0, 1 - (Math.sqrt(d2) - radius) / 0.8) * 255;
          setPixel(x, y, r, g, b, alpha);
        }
      }
    }
  };

  const drawLine = (x1, y1, x2, y2, thickness, r, g, b) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x1 + dx * t;
      const cy = y1 + dy * t;
      fillCircle(cx, cy, thickness / 2, r, g, b);
    }
  };

  const fillRoundedRect = (x, y, w, h, radius, r, g, b) => {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        let inside = false;
        // Check corners
        if (px < x + radius && py < y + radius) {
          inside = ((px - (x + radius)) ** 2 + (py - (y + radius)) ** 2) <= radius * radius;
        } else if (px >= x + w - radius && py < y + radius) {
          inside = ((px - (x + w - radius)) ** 2 + (py - (y + radius)) ** 2) <= radius * radius;
        } else if (px < x + radius && py >= y + h - radius) {
          inside = ((px - (x + radius)) ** 2 + (py - (y + h - radius)) ** 2) <= radius * radius;
        } else if (px >= x + w - radius && py >= y + h - radius) {
          inside = ((px - (x + w - radius)) ** 2 + (py - (y + h - radius)) ** 2) <= radius * radius;
        } else {
          inside = true;
        }
        if (inside) {
          setPixel(px, py, r, g, b, 255);
        }
      }
    }
  };

  const s = size / 16;

  // Draw background for store icon
  if (withBackground) {
    const radius = Math.round(size * 0.18);
    fillRoundedRect(0, 0, size, size, radius, 36, 41, 47); // #24292f
  }

  // Icon color
  const color = [255, 255, 255]; // white

  // Left vertical line (source branch)
  drawLine(3.75 * s, 4 * s, 3.75 * s, 12 * s, 1.4 * s, ...color);

  // Right vertical line (target branch)
  drawLine(12.25 * s, 7 * s, 12.25 * s, 12 * s, 1.4 * s, ...color);

  // Merge curve
  const arrowSegments = 20;
  for (let i = 0; i < arrowSegments; i++) {
    const t1 = i / arrowSegments;
    const t2 = (i + 1) / arrowSegments;
    const ax1 = (1 - t1) * (1 - t1) * 12.25 + 2 * (1 - t1) * t1 * 12.25 + t1 * t1 * 9.5;
    const ay1 = (1 - t1) * (1 - t1) * 5.5 + 2 * (1 - t1) * t1 * 3 + t1 * t1 * 3;
    const ax2 = (1 - t2) * (1 - t2) * 12.25 + 2 * (1 - t2) * t2 * 12.25 + t2 * t2 * 9.5;
    const ay2 = (1 - t2) * (1 - t2) * 5.5 + 2 * (1 - t2) * t2 * 3 + t2 * t2 * 3;
    drawLine(ax1 * s, ay1 * s, ax2 * s, ay2 * s, 1.4 * s, ...color);
  }

  // Arrow head
  drawLine(9.5 * s, 3 * s, 7.5 * s, 3 * s, 1.4 * s, ...color);
  drawLine(9.2 * s, 1.5 * s, 7.5 * s, 3 * s, 1.3 * s, ...color);
  drawLine(9.2 * s, 4.5 * s, 7.5 * s, 3 * s, 1.3 * s, ...color);

  // Endpoint dots
  const dotR = 1.8 * s;
  fillCircle(3.75 * s, 3.25 * s, dotR, ...color);
  fillCircle(3.75 * s, 12.75 * s, dotR, ...color);
  fillCircle(12.25 * s, 12.75 * s, dotR, ...color);

  return pixels;
}

function encodePNG(pixels, width, height) {
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const filterByte = Buffer.from([0]);
    const row = pixels.slice(y * width * 4, (y + 1) * width * 4);
    rawRows.push(Buffer.concat([filterByte, row]));
  }
  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);
  const ihdr = makeChunk("IHDR", ihdrData);
  const idat = makeChunk("IDAT", compressed);
  const iend = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = crc32(Buffer.concat([typeBuffer, data]));
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeInt32BE(crc, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xedb88320;
      else crc >>>= 1;
    }
  }
  return (crc ^ 0xffffffff) | 0;
}

// ─── Generate ────────────────────────────────────────────────────────────────

const iconsDir = path.join(__dirname, "..", "icons");
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir);
}

// Toolbar icons: white on transparent
for (const size of [16, 48]) {
  const pixels = drawPRIcon(size, { withBackground: false });
  const png = encodePNG(pixels, size, size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  console.log(`Created icons/icon${size}.png (${png.length} bytes) - transparent`);
}

// Store icon: white on dark rounded background
const size128 = 128;
const pixels128 = drawPRIcon(size128, { withBackground: true });
const png128 = encodePNG(pixels128, size128, size128);
fs.writeFileSync(path.join(iconsDir, `icon${size128}.png`), png128);
console.log(`Created icons/icon${size128}.png (${png128.length} bytes) - with background`);

console.log("Done!");
