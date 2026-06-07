/**
 * HSL16 → RGB lookup table, mirror of Java ColorPalette.
 *
 * 65536-entry LUT keyed by the 16-bit HSL value the cache uses.
 * Brightness exponent 0.85 matches RuneLite default + Java extractor.
 *
 * Three sentinels short-circuit:
 *   0xFFFF (65535) → -1  invisible (full-mask sentinel)
 *   0x4141 (16705) → -2  texture-overlay placeholder (HSL=0)
 *   0x9466 (37798) → -3  textureFace match (HSL=127)
 */

const HUESAT_COUNT = 512;
const LUMINANCE_LEVELS = 128;
const SAT_DIVISOR = 8;
const SAT_OFFSET = 0.0625;
const SAT_SCALE = 0.8;
const HUE_INITIAL_OFFSET = 0.0078125;
const HUE_MASK = 7;
const RGB_SCALE = 256;
const BRIGHTNESS_EXPONENT = 0.85;

const PALETTE = buildPalette();

function hueToRgb(min, max, h) {
  if (h < 0) h += 1;
  if (h > 1) h -= 1;
  if (h < 1 / 6) return min + (max - min) * 6 * h;
  if (h < 1 / 2) return max;
  if (h < 2 / 3) return min + (max - min) * (2 / 3 - h) * 6;
  return min;
}

function buildPalette() {
  const table = new Int32Array(65536);
  let index = 0;
  for (let hs = 0; hs < HUESAT_COUNT; hs++) {
    const hue = (hs >> 3) / 64 + HUE_INITIAL_OFFSET;
    let sat = (hs & HUE_MASK) / SAT_DIVISOR + SAT_OFFSET;
    sat = Math.min(1, sat * SAT_SCALE);
    for (let lum = 0; lum < LUMINANCE_LEVELS; lum++) {
      const luminance = lum / LUMINANCE_LEVELS;
      let r, g, b;
      if (sat === 0) {
        r = g = b = luminance;
      } else {
        const chromaMax = luminance < 0.5
          ? luminance * (1 + sat)
          : (luminance + sat) - (luminance * sat);
        const chromaMin = 2 * luminance - chromaMax;
        r = hueToRgb(chromaMin, chromaMax, hue + 1 / 3);
        g = hueToRgb(chromaMin, chromaMax, hue);
        b = hueToRgb(chromaMin, chromaMax, hue - 1 / 3);
      }
      const ri = Math.floor(r * RGB_SCALE);
      const gi = Math.floor(g * RGB_SCALE);
      const bi = Math.floor(b * RGB_SCALE);
      let rgb = (ri << 16) | (gi << 8) | bi;
      if (BRIGHTNESS_EXPONENT !== 1) {
        const r2 = Math.pow(((rgb >> 16) & 0xff) / RGB_SCALE, BRIGHTNESS_EXPONENT);
        const g2 = Math.pow(((rgb >> 8) & 0xff) / RGB_SCALE, BRIGHTNESS_EXPONENT);
        const b2 = Math.pow((rgb & 0xff) / RGB_SCALE, BRIGHTNESS_EXPONENT);
        rgb = (Math.floor(r2 * RGB_SCALE) << 16)
            | (Math.floor(g2 * RGB_SCALE) << 8)
            | Math.floor(b2 * RGB_SCALE);
      }
      table[index++] = rgb !== 0 ? rgb : 1;
    }
  }
  return table;
}

export function hslToRgb(hsl) {
  if (hsl === 65535) return -1;
  if (hsl === 16705) return -2;
  if (hsl === 37798) return -3;
  return PALETTE[hsl & 0xffff];
}

export function rgbToFloats(rgb) {
  if (rgb < 0) return [0, 0, 0];
  return [
    ((rgb >> 16) & 0xff) / 255,
    ((rgb >> 8) & 0xff) / 255,
    (rgb & 0xff) / 255,
  ];
}
