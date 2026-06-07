import { PNG } from 'pngjs';

/**
 * Parses an OSRS sprite group from decompressed data.
 * Returns an array of { width, height, offsetX, offsetY, png: Buffer } objects.
 *
 * RS2 Sprite Group Format:
 *
 * TAIL (reading from end of buffer):
 *   [count 2B]                     ← last 2 bytes = frame count
 *   [heights N*2B]                 ← per-frame heights (uint16)
 *   [widths N*2B]                  ← per-frame widths (uint16)
 *   [offsetsY N*2B]               ← per-frame Y offsets (uint16)
 *   [offsetsX N*2B]               ← per-frame X offsets (uint16)
 *   [paletteSize-1 1B]            ← palette length minus one
 *   [maxHeight 2B]                ← overall max height
 *   [maxWidth 2B]                 ← overall max width
 *   [palette (paletteSize-1)*3B]  ← RGB triplets (palette[0] = transparent, not stored)
 *
 * FRONT (reading from position 0):
 *   For each frame:
 *     [flags 1B]                  ← bit0: column-major, bit1: has alpha
 *     [indices W*H bytes]         ← palette indices
 *     [alpha W*H bytes]           ← alpha channel (only if flags bit1 set)
 */
export function parseSpriteGroup(id, data) {
  if (!data || data.length < 2) return [];

  const buf = Buffer.from(data);

  // Read frame count from last 2 bytes
  const count = buf.readUInt16BE(buf.length - 2);
  if (count === 0 || count > 2000) return [];

  // Metadata block starts at: end - 7 - count * 8
  const metaStart = buf.length - 7 - count * 8;
  if (metaStart < 0) return [];

  // Read metadata block (forward from metaStart)
  let mp = metaStart;
  const maxWidth = buf.readUInt16BE(mp); mp += 2;
  const maxHeight = buf.readUInt16BE(mp); mp += 2;
  const paletteSize = (buf[mp] & 0xFF) + 1; mp += 1;

  // Read per-frame arrays (forward)
  const offsetsX = new Array(count);
  for (let i = 0; i < count; i++) { offsetsX[i] = buf.readUInt16BE(mp); mp += 2; }

  const offsetsY = new Array(count);
  for (let i = 0; i < count; i++) { offsetsY[i] = buf.readUInt16BE(mp); mp += 2; }

  const widths = new Array(count);
  for (let i = 0; i < count; i++) { widths[i] = buf.readUInt16BE(mp); mp += 2; }

  const heights = new Array(count);
  for (let i = 0; i < count; i++) { heights[i] = buf.readUInt16BE(mp); mp += 2; }

  // Palette is at: metaStart - (paletteSize-1)*3
  const paletteStart = metaStart - (paletteSize - 1) * 3;
  if (paletteStart < 0) return [];

  const palette = new Array(paletteSize);
  palette[0] = 0; // transparent
  let pp = paletteStart;
  for (let i = 1; i < paletteSize; i++) {
    const r = buf[pp++] & 0xFF;
    const g = buf[pp++] & 0xFF;
    const b = buf[pp++] & 0xFF;
    palette[i] = (r << 16) | (g << 8) | b;
    if (palette[i] === 0) palette[i] = 1; // 0 means transparent, use 1 for opaque black
  }

  // Validate dimensions
  for (let i = 0; i < count; i++) {
    if (widths[i] > 4096 || heights[i] > 4096) return [];
  }

  // Validate total pixel data fits
  let totalPixels = 0;
  for (let i = 0; i < count; i++) totalPixels += widths[i] * heights[i];
  if (totalPixels > 16_000_000) return [];
  // Pixel data goes from pos 0 to paletteStart (flags + indices + optional alpha)
  // Each frame uses 1 byte flag + W*H indices + (optionally W*H alpha)
  // Minimum: count flags + totalPixels indices
  if (count + totalPixels > paletteStart) return [];

  // Read pixel data from front
  const sprites = [];
  let pos = 0;

  for (let f = 0; f < count; f++) {
    const w = widths[f];
    const h = heights[f];
    const numPx = w * h;

    if (w === 0 || h === 0) {
      sprites.push({ width: w, height: h, offsetX: 0, offsetY: 0, png: null });
      continue;
    }

    if (pos >= paletteStart) break;
    const flags = buf[pos++] & 0xFF;

    // Read palette indices
    const indices = new Uint8Array(numPx);
    if ((flags & 0x01) !== 0) {
      // Column-major
      for (let x = 0; x < w && pos < paletteStart; x++) {
        for (let y = 0; y < h && pos < paletteStart; y++) {
          indices[y * w + x] = buf[pos++] & 0xFF;
        }
      }
    } else {
      // Row-major
      for (let i = 0; i < numPx && pos < paletteStart; i++) {
        indices[i] = buf[pos++] & 0xFF;
      }
    }

    // Read alpha channel (if flags bit 1 set)
    const hasAlpha = (flags & 0x02) !== 0;
    const alpha = hasAlpha ? new Uint8Array(numPx) : null;
    if (hasAlpha) {
      if ((flags & 0x01) !== 0) {
        for (let x = 0; x < w && pos < paletteStart; x++) {
          for (let y = 0; y < h && pos < paletteStart; y++) {
            alpha[y * w + x] = buf[pos++] & 0xFF;
          }
        }
      } else {
        for (let i = 0; i < numPx && pos < paletteStart; i++) {
          alpha[i] = buf[pos++] & 0xFF;
        }
      }
    }

    // Convert to RGBA PNG
    const png = new PNG({ width: w, height: h });
    for (let i = 0; i < numPx; i++) {
      const palIdx = indices[i];
      const idx4 = i * 4;

      if (hasAlpha) {
        const a = alpha[i];
        const rgb = palette[palIdx] || 0;
        png.data[idx4] = (rgb >> 16) & 0xFF;
        png.data[idx4 + 1] = (rgb >> 8) & 0xFF;
        png.data[idx4 + 2] = rgb & 0xFF;
        png.data[idx4 + 3] = a;
      } else if (palIdx === 0) {
        png.data[idx4] = 0;
        png.data[idx4 + 1] = 0;
        png.data[idx4 + 2] = 0;
        png.data[idx4 + 3] = 0; // transparent
      } else {
        const rgb = palette[palIdx];
        png.data[idx4] = (rgb >> 16) & 0xFF;
        png.data[idx4 + 1] = (rgb >> 8) & 0xFF;
        png.data[idx4 + 2] = rgb & 0xFF;
        png.data[idx4 + 3] = 255;
      }
    }

    sprites.push({
      width: w,
      height: h,
      offsetX: offsetsX[f],
      offsetY: offsetsY[f],
      overallWidth: maxWidth,
      overallHeight: maxHeight,
      png: PNG.sync.write(png),
    });
  }

  return sprites;
}
