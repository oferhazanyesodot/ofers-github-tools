/**
 * Run this script with Node.js to generate the extension icons.
 * Usage: node create-icons.js
 *
 * Creates PNG icons using GitHub's pull-request icon shape.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/**
 * Draw the GitHub PR icon onto a pixel buffer.
 * The icon is drawn as vectors scaled to the target size.
 */
function drawPRIcon(size) {
  // Canvas: RGBA buffer
  const pixels = Buffer.alloc(size * size * 4, 0);

  const setPixel = (x, y, r, g, b, a) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= size || iy < 0 || iy >= size) return;
    const offset = (iy * size + ix) * 4;
    // Alpha blend
    const srcA = a / 255;
    const dstA = pixels[offset + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA === 0) return;
    pixels[offset] = Math.round((r * srcA + pixels[offset] * dstA * (1 - srcA)) / outA);
    pixels[offset + 1] = Math.round((g * srcA + pixels[offset + 1] * dstA * (1 - srcA)) / outA);
    pixels[offset + 2] = Math.round((b * srcA + pixels[offset + 2] * dstA * (1 - srcA)) / outA);
    pixels[offset + 3] = Math.round(outA * 255);
  };

  // Draw filled circle
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
          // Anti-alias edge
          const alpha = Math.max(0, 1 - (Math.sqrt(d2) - radius) / 0.8) * 255;
          setPixel(x, y, r, g, b, alpha);
        }
      }
    }
  };

  // Draw thick line
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

  // Scale factor
  const s = size / 16;

  // Colors - green like GitHub's PR icon
  const green = [57, 211, 83]; // #39d353 - GitHub green

  // Draw the PR icon shape (based on GitHub's Octicon)
  // Left vertical line (source branch)
  drawLine(3.75 * s, 4 * s, 3.75 * s, 12 * s, 1.4 * s, ...green);

  // Right vertical line (target branch, shorter)
  drawLine(12.25 * s, 7 * s, 12.25 * s, 12 * s, 1.4 * s, ...green);

  // Arrow from right to left-ish (the merge arrow curve)
  // Draw as segments approximating the curve
  const arrowSegments = 20;
  for (let i = 0; i < arrowSegments; i++) {
    const t1 = i / arrowSegments;
    const t2 = (i + 1) / arrowSegments;
    // Quadratic bezier: start(12.25, 5.5) control(12.25, 3) end(9.5, 3)
    const ax1 = (1 - t1) * (1 - t1) * 12.25 + 2 * (1 - t1) * t1 * 12.25 + t1 * t1 * 9.5;
    const ay1 = (1 - t1) * (1 - t1) * 5.5 + 2 * (1 - t1) * t1 * 3 + t1 * t1 * 3;
    const ax2 = (1 - t2) * (1 - t2) * 12.25 + 2 * (1 - t2) * t2 * 12.25 + t2 * t2 * 9.5;
    const ay2 = (1 - t2) * (1 - t2) * 5.5 + 2 * (1 - t2) * t2 * 3 + t2 * t2 * 3;
    drawLine(ax1 * s, ay1 * s, ax2 * s, ay2 * s, 1.4 * s, ...green);
  }

  // Arrow head pointing left at (9.5, 3)
  drawLine(9.5 * s, 3 * s, 7.5 * s, 3 * s, 1.4 * s, ...green);
  drawLine(9.2 * s, 1.5 * s, 7.5 * s, 3 * s, 1.3 * s, ...green);
  drawLine(9.2 * s, 4.5 * s, 7.5 * s, 3 * s, 1.3 * s, ...green);

  // Circles at endpoints
  const dotR = 1.8 * s;
  fillCircle(3.75 * s, 3.25 * s, dotR, ...green);
  fillCircle(3.75 * s, 12.75 * s, dotR, ...green);
  fillCircle(12.25 * s, 12.75 * s, dotR, ...green);

  return pixels;
}

/**
 * Encode RGBA pixel buffer as PNG.
 */
function encodePNG(pixels, width, height) {
  // Build raw image data with filter bytes
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const filterByte = Buffer.from([0]); // None filter
    const row = pixels.slice(y * width * 4, (y + 1) * width * 4);
    rawRows.push(Buffer.concat([filterByte, row]));
  }
  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData);

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);   // bit depth
  ihdrData.writeUInt8(6, 9);   // color type: RGBA
  ihdrData.writeUInt8(0, 10);  // compression
  ihdrData.writeUInt8(0, 11);  // filter
  ihdrData.writeUInt8(0, 12);  // interlace
  const ihdr = makeChunk("IHDR", ihdrData);

  // IDAT
  const idat = makeChunk("IDAT", compressed);

  // IEND
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
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc >>>= 1;
      }
    }
  }
  return (crc ^ 0xffffffff) | 0;
}

// Create icons directory
const iconsDir = path.join(__dirname, "icons");
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir);
}

// Generate icons
const sizes = [16, 48, 128];
for (const size of sizes) {
  const pixels = drawPRIcon(size);
  const png = encodePNG(pixels, size, size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  console.log(`Created icons/icon${size}.png (${png.length} bytes)`);
}

console.log("Done!");
