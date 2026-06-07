package com.clansocket.extractor.data;

/**
 * 65536-entry Jagex HSL16 → RGB palette, authentic-OSRS variant
 * (GLOBAL_HUE_SHIFT = 0.0, BRIGHTNESS_EXPONENT = 0.85). Converts HSL16
 * colorFind/colorReplace values from raw/configs/Items-N.json and HSL16 face
 * colors from raw/models/Models-N.json to RGB at render time.
 *
 * Sentinels: HSL value 65535 → -1 (transparent), 16705 → -2 (force transparent),
 * 37798 → -3 (removed). Callers MUST pass through sentinels unchanged.
 */
public final class ColorPalette {

  private ColorPalette() {}

  private static final double GLOBAL_HUE_SHIFT = 0.0;
  private static final double BRIGHTNESS_EXPONENT = 0.85;

  public static final int SENTINEL_TRANSPARENT = 65535;
  public static final int SENTINEL_FORCE_TRANSPARENT = 16705;
  public static final int SENTINEL_REMOVED = 37798;

  private static final int PALETTE_SIZE = 65536;
  private static final int HUESAT_COUNT = 512;
  private static final int LUMINANCE_LEVELS = 128;
  private static final int HUESAT_DIVISOR = 64;
  private static final double HUE_INITIAL_OFFSET = 0.0078125;
  private static final double SATURATION_DIVISOR = 8.0;
  private static final double SATURATION_OFFSET = 0.0625;
  private static final double SATURATION_SCALE = 0.8;
  private static final int HUE_MASK = 7;
  private static final int RGB_SCALE = 256;

  private static final int[] PALETTE = buildPalette();

  private static int[] buildPalette() {
    int[] table = new int[PALETTE_SIZE];
    int index = 0;
    for (int huesatIndex = 0; huesatIndex < HUESAT_COUNT; huesatIndex++) {
      double originalHue = (huesatIndex / SATURATION_DIVISOR) / HUESAT_DIVISOR + HUE_INITIAL_OFFSET;
      double modifiedHue = modifyHue(originalHue);
      double saturation = (huesatIndex & HUE_MASK) / SATURATION_DIVISOR + SATURATION_OFFSET;
      saturation = Math.min(1.0, saturation * SATURATION_SCALE);

      for (int luminanceLevel = 0; luminanceLevel < LUMINANCE_LEVELS; luminanceLevel++) {
        double luminance = luminanceLevel / (double) LUMINANCE_LEVELS;
        double red = luminance;
        double green = luminance;
        double blue = luminance;

        if (saturation != 0.0) {
          double chromaticMax = luminance < 0.5
              ? luminance * (1.0 + saturation)
              : (luminance + saturation) - (luminance * saturation);
          double chromaticMin = 2.0 * luminance - chromaticMax;
          red = hueToRgb(chromaticMin, chromaticMax, modifiedHue + 1.0 / 3.0);
          green = hueToRgb(chromaticMin, chromaticMax, modifiedHue);
          blue = hueToRgb(chromaticMin, chromaticMax, modifiedHue - 1.0 / 3.0);
        }

        int redInt = (int) Math.floor(red * RGB_SCALE);
        int greenInt = (int) Math.floor(green * RGB_SCALE);
        int blueInt = (int) Math.floor(blue * RGB_SCALE);
        int rgb = (redInt << 16) | (greenInt << 8) | blueInt;
        rgb = adjustColorBrightness(rgb, BRIGHTNESS_EXPONENT);
        table[index++] = rgb != 0 ? rgb : 1;
      }
    }
    return table;
  }

  private static double modifyHue(double originalHue) {
    if (GLOBAL_HUE_SHIFT == 0.0) {
      return originalHue;
    }
    if (originalHue <= 0.05 || originalHue >= 0.97) return 0.50;
    if (originalHue >= 0.05 && originalHue <= 0.16) return originalHue;
    double shifted = originalHue + GLOBAL_HUE_SHIFT;
    return shifted > 1.0 ? shifted - 1.0 : shifted;
  }

  private static double hueToRgb(double chromaticMin, double chromaticMax, double hue) {
    if (hue < 0) hue += 1.0;
    if (hue > 1) hue -= 1.0;
    if (hue < 1.0 / 6.0) return chromaticMin + (chromaticMax - chromaticMin) * 6.0 * hue;
    if (hue < 1.0 / 2.0) return chromaticMax;
    if (hue < 2.0 / 3.0) return chromaticMin + (chromaticMax - chromaticMin) * (2.0 / 3.0 - hue) * 6.0;
    return chromaticMin;
  }

  private static int adjustColorBrightness(int rgb, double exponent) {
    if (exponent == 1.0) return rgb;
    double r = (rgb >> 16) / (double) RGB_SCALE;
    double g = ((rgb >> 8) & 0xFF) / (double) RGB_SCALE;
    double b = (rgb & 0xFF) / (double) RGB_SCALE;
    r = Math.pow(r, exponent);
    g = Math.pow(g, exponent);
    b = Math.pow(b, exponent);
    int rInt = (int) Math.floor(r * RGB_SCALE);
    int gInt = (int) Math.floor(g * RGB_SCALE);
    int bInt = (int) Math.floor(b * RGB_SCALE);
    return (rInt << 16) | (gInt << 8) | bInt;
  }

  public static int hslToRgb(int hslValue) {
    if (hslValue == SENTINEL_TRANSPARENT) return -1;
    if (hslValue == SENTINEL_FORCE_TRANSPARENT) return -2;
    if (hslValue == SENTINEL_REMOVED) return -3;
    int index = hslValue & 0xFFFF;
    if (index < 0 || index >= PALETTE_SIZE) return 0;
    return PALETTE[index];
  }
}
