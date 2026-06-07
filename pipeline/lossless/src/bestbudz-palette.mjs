/**
 * BestBudz-variant 65536-entry Jagex HSL → RGB palette (hue shift 0.6,
 * brightness pow 0.8). Used by model-loader.mjs to bake face colors at decode
 * time. The authentic-OSRS variant (hue 0.0, brightness pow 0.85) lives in
 * ColorPalette.java on the Java renderer side.
 */

const GLOBAL_HUE_SHIFT = 0.6;
const BRIGHTNESS_EXPONENT = 0.8;

/** Sentinel HSL values that must NOT be palette-looked up */
export const SENTINEL_TRANSPARENT = 65535;       // → -1
export const SENTINEL_FORCE_TRANSPARENT = 16705; // → -2
export const SENTINEL_REMOVED = 37798;           // → -3

function modifyHue(originalHue) {
  // Red override: hue ≤ 0.05 or ≥ 0.97 → forced to 0.50
  if (originalHue <= 0.05 || originalHue >= 0.97) {
    return 0.50;
  }
  // Yellow skip: hue 0.05–0.16 passes through unmodified
  if (originalHue >= 0.05 && originalHue <= 0.16) {
    return originalHue;
  }
  // Global hue shift
  let shiftedHue = originalHue + GLOBAL_HUE_SHIFT;
  return shiftedHue > 1.0 ? shiftedHue - 1.0 : shiftedHue;
}

function hueToRgb(chromaticMin, chromaticMax, hue) {
  if (hue < 0) hue += 1.0;
  if (hue > 1) hue -= 1.0;
  if (hue < 1.0 / 6.0) return chromaticMin + (chromaticMax - chromaticMin) * 6.0 * hue;
  if (hue < 1.0 / 2.0) return chromaticMax;
  if (hue < 2.0 / 3.0) return chromaticMin + (chromaticMax - chromaticMin) * (2.0 / 3.0 - hue) * 6.0;
  return chromaticMin;
}

function adjustColorBrightness(rgbColor, brightnessExponent) {
  let r = (rgbColor >> 16) / 256.0;
  let g = ((rgbColor >> 8) & 0xFF) / 256.0;
  let b = (rgbColor & 0xFF) / 256.0;
  r = Math.pow(r, brightnessExponent);
  g = Math.pow(g, brightnessExponent);
  b = Math.pow(b, brightnessExponent);
  let adjustedRed = Math.floor(r * 256.0);
  let adjustedGreen = Math.floor(g * 256.0);
  let adjustedBlue = Math.floor(b * 256.0);
  return (adjustedRed << 16) + (adjustedGreen << 8) + adjustedBlue;
}

/** Generate the full 65536-entry HSL→RGB palette (mirrors Java exactly) */
function generateColorPalette(brightnessModifier) {
  const palette = new Int32Array(65536);
  let index = 0;

  for (let huesatIndex = 0; huesatIndex < 512; huesatIndex++) {
    let originalHue = (huesatIndex / 8.0) / 64.0 + 0.0078125;
    let modifiedHue = modifyHue(originalHue);

    let saturation = (huesatIndex & 7) / 8.0 + 0.0625;
    saturation = Math.min(1.0, saturation * 0.8);

    for (let luminanceLevel = 0; luminanceLevel < 128; luminanceLevel++) {
      let luminance = luminanceLevel / 128.0;

      let red = luminance, green = luminance, blue = luminance;

      if (saturation !== 0.0) {
        let chromaticMax = luminance < 0.5
          ? luminance * (1.0 + saturation)
          : (luminance + saturation) - (luminance * saturation);
        let chromaticMin = 2 * luminance - chromaticMax;

        red = hueToRgb(chromaticMin, chromaticMax, modifiedHue + 1.0 / 3.0);
        green = hueToRgb(chromaticMin, chromaticMax, modifiedHue);
        blue = hueToRgb(chromaticMin, chromaticMax, modifiedHue - 1.0 / 3.0);
      }

      let redInt = Math.floor(red * 256.0);
      let greenInt = Math.floor(green * 256.0);
      let blueInt = Math.floor(blue * 256.0);

      let rgbColor = (redInt << 16) | (greenInt << 8) | blueInt;
      rgbColor = adjustColorBrightness(rgbColor, brightnessModifier);
      palette[index++] = rgbColor !== 0 ? rgbColor : 1;
    }
  }

  return palette;
}

/** Pre-built palette — singleton, shared across all callers */
export const palette = generateColorPalette(BRIGHTNESS_EXPONENT);

/**
 * Convert a single HSL value to BestBudz palette RGB, handling sentinels.
 * @param {number} hslValue  Jagex 16-bit packed HSL
 * @returns {number} RGB integer (0xRRGGBB) or sentinel (-1, -2, -3)
 */
export function hslToRgb(hslValue) {
  if (hslValue === SENTINEL_TRANSPARENT) return -1;
  if (hslValue === SENTINEL_FORCE_TRANSPARENT) return -2;
  if (hslValue === SENTINEL_REMOVED) return -3;

  const index = hslValue & 0xFFFF;
  if (index < 0 || index >= 65536) return 0;
  return palette[index];
}
