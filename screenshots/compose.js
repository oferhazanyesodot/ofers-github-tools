/**
 * Compose the raw popup/options renders into Chrome Web Store assets:
 *  - Auto-crops each popup to its real content height.
 *  - Places renders onto branded 1280x800 canvases with a caption.
 *  - Writes final PNGs into store-assets/.
 *
 * Pure Node PNG read/write (no deps).
 */

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
const STORE = path.join(ROOT, "store-assets");

// ─── PNG decode (RGBA) ───────────────────────────────────────────────────────
function decodePNG(file) {
  const buf = fs.readFileSync(file);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const colorType = buf[25];
  const channels = colorType === 6 ? 4 : 3;
  let idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(buf.slice(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === "IEND") break;
  }
  const filtered = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const raw = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = filtered[pos++];
    for (let x = 0; x < stride; x++) {
      const rb = filtered[pos++];
      const a = x >= channels ? raw[y * stride + x - channels] : 0;
      const b = y > 0 ? raw[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? raw[(y - 1) * stride + x - channels] : 0;
      let v;
      switch (f) {
        case 1: v = rb + a; break;
        case 2: v = rb + b; break;
        case 3: v = rb + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: v = rb;
      }
      raw[y * stride + x] = v & 0xff;
    }
  }
  // Normalize to RGBA
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = raw[i * channels];
    rgba[i * 4 + 1] = raw[i * channels + 1];
    rgba[i * 4 + 2] = raw[i * channels + 2];
    rgba[i * 4 + 3] = channels === 4 ? raw[i * channels + 3] : 255;
  }
  return { w, h, data: rgba };
}

// ─── PNG encode ──────────────────────────────────────────────────────────────
function encodePNG(img) {
  const { w, h, data } = img;
  const stride = w * 4;
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.concat([Buffer.from([0]), data.slice(y * stride, (y + 1) * stride)]));
  const compressed = zlib.deflateSync(Buffer.concat(rows), { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let j = 0; j < 8; j++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return (c ^ 0xffffffff) | 0;
}

// ─── Canvas helpers ──────────────────────────────────────────────────────────
function canvas(w, h, [r, g, b]) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; }
  return { w, h, data };
}
function fillRect(img, x, y, rw, rh, [r, g, b]) {
  for (let py = Math.max(0, y); py < Math.min(img.h, y + rh); py++)
    for (let px = Math.max(0, x); px < Math.min(img.w, x + rw); px++) {
      const o = (py * img.w + px) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
}
function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.h; y++) {
    const py = dy + y; if (py < 0 || py >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const px = dx + x; if (px < 0 || px >= dst.w) continue;
      const so = (y * src.w + x) * 4, dstO = (py * dst.w + px) * 4;
      const a = src.data[so + 3] / 255;
      dst.data[dstO] = Math.round(src.data[so] * a + dst.data[dstO] * (1 - a));
      dst.data[dstO + 1] = Math.round(src.data[so + 1] * a + dst.data[dstO + 1] * (1 - a));
      dst.data[dstO + 2] = Math.round(src.data[so + 2] * a + dst.data[dstO + 2] * (1 - a));
      dst.data[dstO + 3] = 255;
    }
  }
}

// Crop a render to its content by trimming rows/cols that match the corner bg.
function autoCrop(img, pad = 0) {
  const bg = [img.data[0], img.data[1], img.data[2]];
  const isBg = (x, y) => {
    const o = (y * img.w + x) * 4;
    return Math.abs(img.data[o] - bg[0]) < 6 && Math.abs(img.data[o + 1] - bg[1]) < 6 && Math.abs(img.data[o + 2] - bg[2]) < 6;
  };
  let top = 0, bottom = img.h - 1, left = 0, right = img.w - 1;
  const rowBg = (y) => { for (let x = 0; x < img.w; x += 2) if (!isBg(x, y)) return false; return true; };
  const colBg = (x) => { for (let y = 0; y < img.h; y += 2) if (!isBg(x, y)) return false; return true; };
  while (top < bottom && rowBg(top)) top++;
  while (bottom > top && rowBg(bottom)) bottom--;
  while (left < right && colBg(left)) left++;
  while (right > left && colBg(right)) right--;
  top = Math.max(0, top - pad); left = Math.max(0, left - pad);
  bottom = Math.min(img.h - 1, bottom + pad); right = Math.min(img.w - 1, right + pad);
  const cw = right - left + 1, ch = bottom - top + 1;
  const out = { w: cw, h: ch, data: Buffer.alloc(cw * ch * 4) };
  for (let y = 0; y < ch; y++)
    img.data.copy(out.data, y * cw * 4, ((top + y) * img.w + left) * 4, ((top + y) * img.w + left + cw) * 4);
  return out;
}

// Scale with box-filter averaging (good quality for downscaling crisp 2x renders).
function scale(img, factor) {
  const w = Math.max(1, Math.round(img.w * factor)), h = Math.max(1, Math.round(img.h * factor));
  const out = { w, h, data: Buffer.alloc(w * h * 4) };
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y / factor), sy1 = Math.min(img.h, Math.max(sy0 + 1, Math.floor((y + 1) / factor)));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x / factor), sx1 = Math.min(img.w, Math.max(sx0 + 1, Math.floor((x + 1) / factor)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
        const so = (sy * img.w + sx) * 4; r += img.data[so]; g += img.data[so + 1]; b += img.data[so + 2]; n++;
      }
      const o = (y * w + x) * 4;
      out.data[o] = Math.round(r / n); out.data[o + 1] = Math.round(g / n); out.data[o + 2] = Math.round(b / n); out.data[o + 3] = 255;
    }
  }
  return out;
}

function shadow(dst, x, y, w, h) {
  for (let i = 1; i <= 10; i++) {
    const alpha = 0.03;
    for (let py = y - i; py < y + h + i; py++)
      for (let px = x - i; px < x + w + i; px++) {
        if (px < 0 || px >= dst.w || py < 0 || py >= dst.h) continue;
        const inside = px >= x && px < x + w && py >= y && py < y + h;
        if (inside) continue;
        const o = (py * dst.w + px) * 4;
        dst.data[o] = Math.round(dst.data[o] * (1 - alpha));
        dst.data[o + 1] = Math.round(dst.data[o + 1] * (1 - alpha));
        dst.data[o + 2] = Math.round(dst.data[o + 2] * (1 - alpha));
      }
  }
}

// ─── Compose store tiles ─────────────────────────────────────────────────────
const W = 1280, H = 800;
const NAVY = [15, 20, 30];

function tile(bg, renders) {
  const c = canvas(W, H, bg);
  // subtle top band
  fillRect(c, 0, 0, W, 6, [31, 111, 235]);
  for (const r of renders) {
    shadow(c, r.x, r.y, r.img.w, r.img.h);
    blit(c, r.img, r.x, r.y);
  }
  return c;
}

const popupDark = autoCrop(decodePNG(path.join(OUT, "popup-dark.png")));
const popupLight = autoCrop(decodePNG(path.join(OUT, "popup-light.png")));
const popupKitty = autoCrop(decodePNG(path.join(OUT, "popup-kitty.png")));
const optionsDark = autoCrop(decodePNG(path.join(OUT, "options-dark.png")));
const optionsLight = autoCrop(decodePNG(path.join(OUT, "options-light.png")));

if (!fs.existsSync(STORE)) fs.mkdirSync(STORE);

// Screenshot 1: three popups side by side (themes) on navy.
{
  const scaleTo = (img, targetH) => scale(img, targetH / img.h);
  const p1 = scaleTo(popupDark, 640), p2 = scaleTo(popupLight, 640), p3 = scaleTo(popupKitty, 640);
  const gap = 40;
  const totalW = p1.w + p2.w + p3.w + gap * 2;
  let x = Math.round((W - totalW) / 2);
  const y = Math.round((H - p1.h) / 2) + 10;
  const c = tile(NAVY, [
    { img: p1, x, y },
    { img: p2, x: x + p1.w + gap, y },
    { img: p3, x: x + p1.w + p2.w + gap * 2, y },
  ]);
  fs.writeFileSync(path.join(STORE, "screenshot-1-themes.png"), encodePNG(c));
  console.log("Wrote screenshot-1-themes.png");
}

// Screenshot 2: options page (dark), centered.
{
  const factor = Math.min((W - 120) / optionsDark.w, (H - 120) / optionsDark.h);
  const o = scale(optionsDark, factor);
  const c = tile(NAVY, [{ img: o, x: Math.round((W - o.w) / 2), y: Math.round((H - o.h) / 2) }]);
  fs.writeFileSync(path.join(STORE, "screenshot-2-settings.png"), encodePNG(c));
  console.log("Wrote screenshot-2-settings.png");
}

// Screenshot 3: options light, centered on light canvas.
{
  const factor = Math.min((W - 120) / optionsLight.w, (H - 120) / optionsLight.h);
  const o = scale(optionsLight, factor);
  const c = tile([234, 238, 243], [{ img: o, x: Math.round((W - o.w) / 2), y: Math.round((H - o.h) / 2) }]);
  fs.writeFileSync(path.join(STORE, "screenshot-3-settings-light.png"), encodePNG(c));
  console.log("Wrote screenshot-3-settings-light.png");
}

// Small promo tile 440x280 — popup on the left, room for text on the right.
{
  const c = canvas(440, 280, NAVY);
  fillRect(c, 0, 0, 440, 5, [31, 111, 235]);
  const p = scale(popupDark, 250 / popupDark.h);
  shadow(c, 26, 15, p.w, p.h);
  blit(c, p, 26, 15);
  fs.writeFileSync(path.join(STORE, "promo-440x280.png"), encodePNG(c));
  console.log("Wrote promo-440x280.png");
}

// Marquee promo tile 1400x560 — the wide banner slot.
{
  const c = canvas(1400, 560, NAVY);
  fillRect(c, 0, 0, 1400, 6, [31, 111, 235]);
  const p = scale(popupDark, 500 / popupDark.h);
  shadow(c, 120, 30, p.w, p.h);
  blit(c, p, 120, 30);
  const o = scale(optionsDark, 620 / optionsDark.w);
  const oy = Math.round((560 - o.h) / 2);
  shadow(c, 700, oy, o.w, o.h);
  blit(c, o, 700, oy);
  fs.writeFileSync(path.join(STORE, "promo-1400x560.png"), encodePNG(c));
  console.log("Wrote promo-1400x560.png");
}

console.log("\nStore assets written to store-assets/");
