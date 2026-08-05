/**
 * Generate Chrome Web Store listing assets.
 * Usage: node create-store-assets.js
 *
 * Creates:
 * - store-assets/screenshot-1280x800.png (screenshot)
 * - store-assets/promo-440x280.png (small promotional tile)
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function createImage(width, height, drawFn) {
  const pixels = Buffer.alloc(width * height * 4, 0);

  const setPixel = (x, y, r, g, b, a = 255) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) return;
    const offset = (iy * width + ix) * 4;
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    pixels[offset + 3] = a;
  };

  const fillRect = (x, y, w, h, r, g, b) => {
    for (let py = y; py < y + h && py < height; py++) {
      for (let px = x; px < x + w && px < width; px++) {
        setPixel(px, py, r, g, b);
      }
    }
  };

  const fillRoundedRect = (x, y, w, h, radius, r, g, b) => {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        let inside = true;
        if (px < x + radius && py < y + radius) {
          inside = ((px - (x + radius)) ** 2 + (py - (y + radius)) ** 2) <= radius * radius;
        } else if (px >= x + w - radius && py < y + radius) {
          inside = ((px - (x + w - radius - 1)) ** 2 + (py - (y + radius)) ** 2) <= radius * radius;
        } else if (px < x + radius && py >= y + h - radius) {
          inside = ((px - (x + radius)) ** 2 + (py - (y + h - radius - 1)) ** 2) <= radius * radius;
        } else if (px >= x + w - radius && py >= y + h - radius) {
          inside = ((px - (x + w - radius - 1)) ** 2 + (py - (y + h - radius - 1)) ** 2) <= radius * radius;
        }
        if (inside) setPixel(px, py, r, g, b);
      }
    }
  };

  const writeText = (x, y, text, size, r, g, b) => {
    // Simple block-based text rendering for store assets
    // Each char is roughly size*0.6 wide
    const charWidth = Math.round(size * 0.6);
    const charHeight = size;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== " ") {
        // Draw a simple filled rectangle as character placeholder
        fillRoundedRect(x + i * charWidth, y, charWidth - 1, charHeight, 2, r, g, b);
      }
    }
  };

  drawFn({ setPixel, fillRect, fillRoundedRect, writeText, width, height });
  return pixels;
}

function drawScreenshot(ctx) {
  const { fillRect, fillRoundedRect, width, height } = ctx;

  // Dark background (mimicking Chrome in dark mode)
  fillRect(0, 0, width, height, 13, 17, 23); // #0d1117

  // Browser chrome area (top bar)
  fillRect(0, 0, width, 72, 22, 27, 34); // #161b22

  // Tab bar
  fillRoundedRect(8, 8, 180, 32, 8, 36, 41, 47);
  fillRoundedRect(192, 8, 160, 32, 8, 30, 35, 41);

  // Address bar
  fillRoundedRect(8, 44, width - 16, 24, 6, 36, 41, 47);

  // Bookmarks bar
  fillRect(0, 72, width, 28, 22, 27, 34);

  // "GitHub PRs" folder in bookmarks bar
  fillRoundedRect(8, 76, 90, 20, 4, 47, 54, 61);

  // Main content area - simulating a bookmark folder dropdown
  fillRoundedRect(8, 100, 350, 500, 8, 22, 27, 34);

  // Folder header
  fillRoundedRect(16, 108, 334, 32, 4, 36, 41, 47);

  // Bookmark entries
  const entries = [
    "alpha-team-scripts - feat: add db migration scripts",
    "intelligate-backend - fix(event): keep event results",
    "intelligate-client - fix(client): survive transient 5xx",
    "intelligate-client - fix(contract): normalize responses",
    "intelligate-client - fix(event-summaries): read target",
    "intelligate-client - fix(questionnaire): keep builder",
    "intelligate-client - feat(nodes): show load-failure",
    "intelligate-backend - fix(e2e): stop LocalStack lambdas",
    "meetmaynim-backend - feat: tighten candidate schema",
    "intelligate-backend - feat(meetmaynim): align sync",
    "intelligate-backend - feat(metrics): Prometheus exporter",
    "alpha-team-actions - ci: add job timeout",
  ];

  for (let i = 0; i < entries.length; i++) {
    const y = 148 + i * 36;
    fillRoundedRect(20, y, 326, 30, 4, 30, 35, 41);
    // PR icon dot
    fillRoundedRect(28, y + 10, 10, 10, 5, 63, 185, 80);
    // Text representation
    const textLen = Math.min(entries[i].length, 42);
    for (let c = 0; c < textLen; c++) {
      if (entries[i][c] !== " ") {
        fillRect(44 + c * 7, y + 10, 5, 10, 201, 209, 217);
      }
    }
  }

  // Extension popup (top right)
  fillRoundedRect(width - 340, 72, 320, 140, 8, 22, 27, 34);

  // Popup content
  fillRoundedRect(width - 332, 80, 304, 24, 4, 36, 41, 47); // header
  fillRoundedRect(width - 332, 112, 304, 36, 6, 15, 41, 26); // status (green)
  fillRoundedRect(width - 332, 156, 148, 32, 6, 33, 38, 45); // sync button
  fillRoundedRect(width - 176, 156, 148, 32, 6, 33, 38, 45); // settings button

  // Badge on extension icon area
  fillRoundedRect(width - 60, 46, 20, 16, 4, 31, 111, 235); // blue badge
}

function drawPromo(ctx) {
  const { fillRect, fillRoundedRect, width, height } = ctx;

  // Dark background
  fillRect(0, 0, width, height, 13, 17, 23);

  // Large PR icon in center (simplified)
  const cx = width / 2;
  const cy = height / 2 - 20;
  const s = 6;

  // Icon lines
  for (let t = 0; t < 50; t++) {
    fillRect(cx - 50 + t * 0, cy - 40 + t, 4, 4, 255, 255, 255); // left line
  }
  for (let t = 0; t < 30; t++) {
    fillRect(cx + 50, cy - 20 + t, 4, 4, 255, 255, 255); // right line
  }

  // Endpoint dots
  fillRoundedRect(cx - 58, cy - 52, 16, 16, 8, 255, 255, 255);
  fillRoundedRect(cx - 58, cy + 14, 16, 16, 8, 255, 255, 255);
  fillRoundedRect(cx + 42, cy + 14, 16, 16, 8, 255, 255, 255);

  // Title text area
  fillRoundedRect(cx - 150, height - 70, 300, 16, 4, 201, 209, 217);
  fillRoundedRect(cx - 100, height - 46, 200, 12, 4, 125, 133, 144);
}

function encodePNG(pixels, width, height) {
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const filterByte = Buffer.from([0]);
    const row = pixels.slice(y * width * 4, (y + 1) * width * 4);
    rawRows.push(Buffer.concat([filterByte, row]));
  }
  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(6, 9);
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

const outDir = path.join(__dirname, "store-assets");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir);
}

// Screenshot 1280x800
const ssPixels = createImage(1280, 800, drawScreenshot);
const ssPng = encodePNG(ssPixels, 1280, 800);
fs.writeFileSync(path.join(outDir, "screenshot-1280x800.png"), ssPng);
console.log(`Created store-assets/screenshot-1280x800.png (${(ssPng.length / 1024).toFixed(1)} KB)`);

// Promo tile 440x280
const promoPixels = createImage(440, 280, drawPromo);
const promoPng = encodePNG(promoPixels, 440, 280);
fs.writeFileSync(path.join(outDir, "promo-440x280.png"), promoPng);
console.log(`Created store-assets/promo-440x280.png (${(promoPng.length / 1024).toFixed(1)} KB)`);

console.log("\nDone! Use these for your Chrome Web Store listing.");
console.log("Note: For a polished listing, consider replacing with actual screenshots.");
