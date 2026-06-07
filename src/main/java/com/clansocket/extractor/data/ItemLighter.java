package com.clansocket.extractor.data;

import com.bestbudz.rendering.model.Model;

/**
 * Per-item Gouraud lighting — port of
 * net.runelite.cache.definitions.ModelDefinition.computeNormals +
 * net.runelite.cache.item.ItemSpriteFactory.light + method2608.
 *
 * Dual-side lighting: computes both FRONT and BACK lit colors per vertex.
 * Front uses the outward-pointing normal; back uses the negated normal.
 * Fragment shader selects per fragment via gl_FrontFacing — items with
 * visible interior surfaces (hoods, open containers) get proper lighting
 * on both sides without geometry duplication.
 */
public final class ItemLighter {

  private ItemLighter() {}

  private static final int LIGHT_DIR_X = -50;
  private static final int LIGHT_DIR_Y = -10;
  private static final int LIGHT_DIR_Z = -50;
  private static final int AMBIENT_BASE = 64;
  private static final int CONTRAST_BASE = 768;
  private static final int LUMINANCE_MASK = 127;
  private static final int HUESAT_MASK = 65408;
  private static final int LUMINANCE_MIN = 2;
  private static final int LUMINANCE_MAX = 126;
  private static final int CONTRAST_SHIFT = 8;
  private static final int LUMINANCE_SHIFT = 7;
  private static final int NORMAL_SCALE = 256;
  private static final int NORMAL_REDUCE_THRESHOLD = 8192;
  private static final int FLAT_FULL_BRIGHTNESS = 128;
  private static final int INVISIBLE_SENTINEL = -2;
  private static final int ALPHA_INVISIBLE = 255;
  private static final int ALPHA_FORCE_FLAT = 254;

  public static void applyLighting(Model m, int itemAmbient, int itemContrast) {
    int vc = m.vertexCount;
    int fc = m.triangleCount;
    if (vc == 0 || fc == 0) return;

    int[] vnX = new int[vc];
    int[] vnY = new int[vc];
    int[] vnZ = new int[vc];
    int[] vnCount = new int[vc];

    for (int f = 0; f < fc; f++) {
      int a = m.faceVertexA[f];
      int b = m.faceVertexB[f];
      int c = m.faceVertexC[f];
      if (a < 0 || b < 0 || c < 0 || a >= vc || b >= vc || c >= vc) continue;

      if ((m.faceInfo[f] & 3) != 0) continue;

      int xA = m.verticesX[b] - m.verticesX[a];
      int yA = m.verticesY[b] - m.verticesY[a];
      int zA = m.verticesZ[b] - m.verticesZ[a];
      int xB = m.verticesX[c] - m.verticesX[a];
      int yB = m.verticesY[c] - m.verticesY[a];
      int zB = m.verticesZ[c] - m.verticesZ[a];

      int nx = yA * zB - yB * zA;
      int ny = zA * xB - zB * xA;
      int nz = xA * yB - xB * yA;

      while (nx > NORMAL_REDUCE_THRESHOLD || ny > NORMAL_REDUCE_THRESHOLD || nz > NORMAL_REDUCE_THRESHOLD
          || nx < -NORMAL_REDUCE_THRESHOLD || ny < -NORMAL_REDUCE_THRESHOLD || nz < -NORMAL_REDUCE_THRESHOLD) {
        nx >>= 1;
        ny >>= 1;
        nz >>= 1;
      }

      int len = (int) Math.sqrt((double) nx * nx + (double) ny * ny + (double) nz * nz);
      if (len <= 0) len = 1;

      nx = nx * NORMAL_SCALE / len;
      ny = ny * NORMAL_SCALE / len;
      nz = nz * NORMAL_SCALE / len;

      vnX[a] += nx; vnY[a] += ny; vnZ[a] += nz; vnCount[a]++;
      vnX[b] += nx; vnY[b] += ny; vnZ[b] += nz; vnCount[b]++;
      vnX[c] += nx; vnY[c] += ny; vnZ[c] += nz; vnCount[c]++;
    }

    int ambient = itemAmbient + AMBIENT_BASE;
    int contrast = itemContrast + CONTRAST_BASE;
    int lightMag = (int) Math.sqrt(
        (double) LIGHT_DIR_X * LIGHT_DIR_X
            + (double) LIGHT_DIR_Y * LIGHT_DIR_Y
            + (double) LIGHT_DIR_Z * LIGHT_DIR_Z);
    int var7 = (lightMag * contrast) >> CONTRAST_SHIFT;
    int var7_flat = var7 + (var7 >> 1);

    for (int f = 0; f < fc; f++) {
      int hslOrTexId = m.faceColors[f];
      int a = m.faceVertexA[f];
      int b = m.faceVertexB[f];
      int c = m.faceVertexC[f];
      int rawType = m.faceInfo[f] & 3;
      boolean isTextured = (rawType & 2) != 0;
      boolean isFlat = (rawType & 1) != 0;

      if (a < 0 || b < 0 || c < 0 || a >= vc || b >= vc || c >= vc) {
        int fallback;
        if (isTextured) {
          fallback = packGrey(FLAT_FULL_BRIGHTNESS);
        } else {
          int rgb = ColorPalette.hslToRgb(hslOrTexId);
          fallback = rgb < 0 ? 0 : rgb;
        }
        m.litColorA[f] = m.litColorB[f] = m.litColorC[f] = fallback;
        m.litColorBackA[f] = m.litColorBackB[f] = m.litColorBackC[f] = fallback;
        continue;
      }

      if (isTextured && isFlat) {
        int[] fn = computeFaceNormal(m, a, b, c);
        long dotFront = (long) LIGHT_DIR_X * fn[0] + (long) LIGHT_DIR_Y * fn[1] + (long) LIGHT_DIR_Z * fn[2];
        int lumFront = clampLum((int) (dotFront / (long) var7_flat) + ambient);
        int lumBack = clampLum((int) (-dotFront / (long) var7_flat) + ambient);
        m.litColorA[f] = m.litColorB[f] = m.litColorC[f] = packGrey(lumFront);
        m.litColorBackA[f] = m.litColorBackB[f] = m.litColorBackC[f] = packGrey(lumBack);
        continue;
      }

      if (isTextured) {
        m.litColorA[f] = packGrey(vertexLitLum(vnX[a], vnY[a], vnZ[a], vnCount[a], var7, ambient, false));
        m.litColorB[f] = packGrey(vertexLitLum(vnX[b], vnY[b], vnZ[b], vnCount[b], var7, ambient, false));
        m.litColorC[f] = packGrey(vertexLitLum(vnX[c], vnY[c], vnZ[c], vnCount[c], var7, ambient, false));
        m.litColorBackA[f] = packGrey(vertexLitLum(vnX[a], vnY[a], vnZ[a], vnCount[a], var7, ambient, true));
        m.litColorBackB[f] = packGrey(vertexLitLum(vnX[b], vnY[b], vnZ[b], vnCount[b], var7, ambient, true));
        m.litColorBackC[f] = packGrey(vertexLitLum(vnX[c], vnY[c], vnZ[c], vnCount[c], var7, ambient, true));
        continue;
      }

      if (isFlat) {
        int[] fn = computeFaceNormal(m, a, b, c);
        long dotFront = (long) LIGHT_DIR_X * fn[0] + (long) LIGHT_DIR_Y * fn[1] + (long) LIGHT_DIR_Z * fn[2];
        int tmpFront = (int) (dotFront / (long) var7_flat) + ambient;
        int tmpBack = (int) (-dotFront / (long) var7_flat) + ambient;
        int rgbFront = ColorPalette.hslToRgb(modulateLuminance(hslOrTexId, tmpFront));
        int rgbBack = ColorPalette.hslToRgb(modulateLuminance(hslOrTexId, tmpBack));
        if (rgbFront < 0) rgbFront = 0;
        if (rgbBack < 0) rgbBack = 0;
        m.litColorA[f] = m.litColorB[f] = m.litColorC[f] = rgbFront;
        m.litColorBackA[f] = m.litColorBackB[f] = m.litColorBackC[f] = rgbBack;
        continue;
      }

      m.litColorA[f] = vertexLitRgb(hslOrTexId, vnX[a], vnY[a], vnZ[a], vnCount[a], var7, ambient, false);
      m.litColorB[f] = vertexLitRgb(hslOrTexId, vnX[b], vnY[b], vnZ[b], vnCount[b], var7, ambient, false);
      m.litColorC[f] = vertexLitRgb(hslOrTexId, vnX[c], vnY[c], vnZ[c], vnCount[c], var7, ambient, false);
      m.litColorBackA[f] = vertexLitRgb(hslOrTexId, vnX[a], vnY[a], vnZ[a], vnCount[a], var7, ambient, true);
      m.litColorBackB[f] = vertexLitRgb(hslOrTexId, vnX[b], vnY[b], vnZ[b], vnCount[b], var7, ambient, true);
      m.litColorBackC[f] = vertexLitRgb(hslOrTexId, vnX[c], vnY[c], vnZ[c], vnCount[c], var7, ambient, true);
    }
    m.lit = true;
  }

  private static int[] computeFaceNormal(Model m, int a, int b, int c) {
    int xA = m.verticesX[b] - m.verticesX[a];
    int yA = m.verticesY[b] - m.verticesY[a];
    int zA = m.verticesZ[b] - m.verticesZ[a];
    int xB = m.verticesX[c] - m.verticesX[a];
    int yB = m.verticesY[c] - m.verticesY[a];
    int zB = m.verticesZ[c] - m.verticesZ[a];

    int nx = yA * zB - yB * zA;
    int ny = zA * xB - zB * xA;
    int nz = xA * yB - xB * yA;

    while (nx > NORMAL_REDUCE_THRESHOLD || ny > NORMAL_REDUCE_THRESHOLD || nz > NORMAL_REDUCE_THRESHOLD
        || nx < -NORMAL_REDUCE_THRESHOLD || ny < -NORMAL_REDUCE_THRESHOLD || nz < -NORMAL_REDUCE_THRESHOLD) {
      nx >>= 1;
      ny >>= 1;
      nz >>= 1;
    }

    int len = (int) Math.sqrt((double) nx * nx + (double) ny * ny + (double) nz * nz);
    if (len <= 0) len = 1;
    return new int[] {
        nx * NORMAL_SCALE / len,
        ny * NORMAL_SCALE / len,
        nz * NORMAL_SCALE / len,
    };
  }

  private static int vertexLitRgb(int hsl, int nx, int ny, int nz, int count, int var7, int ambient, boolean back) {
    if (count <= 0 || var7 <= 0) {
      int rgb = ColorPalette.hslToRgb(hsl);
      return rgb < 0 ? 0 : rgb;
    }
    long dot = (long) LIGHT_DIR_X * nx + (long) LIGHT_DIR_Y * ny + (long) LIGHT_DIR_Z * nz;
    if (back) dot = -dot;
    int tmp = (int) (dot / ((long) var7 * count)) + ambient;
    int litHsl = modulateLuminance(hsl, tmp);
    int rgb = ColorPalette.hslToRgb(litHsl);
    return rgb < 0 ? 0 : rgb;
  }

  private static int vertexLitLum(int nx, int ny, int nz, int count, int var7, int ambient, boolean back) {
    if (count <= 0 || var7 <= 0) return clampLum(ambient);
    long dot = (long) LIGHT_DIR_X * nx + (long) LIGHT_DIR_Y * ny + (long) LIGHT_DIR_Z * nz;
    if (back) dot = -dot;
    int tmp = (int) (dot / ((long) var7 * count)) + ambient;
    return clampLum(tmp);
  }

  private static int clampLum(int v) {
    if (v < LUMINANCE_MIN) return LUMINANCE_MIN;
    if (v > LUMINANCE_MAX) return LUMINANCE_MAX;
    return v;
  }

  private static int packGrey(int lum) {
    int b = lum & 0xFF;
    return (b << 16) | (b << 8) | b;
  }

  private static int modulateLuminance(int hsl, int factor) {
    int adjusted = ((hsl & LUMINANCE_MASK) * factor) >> LUMINANCE_SHIFT;
    if (adjusted < LUMINANCE_MIN) adjusted = LUMINANCE_MIN;
    if (adjusted > LUMINANCE_MAX) adjusted = LUMINANCE_MAX;
    return (hsl & HUESAT_MASK) + adjusted;
  }
}
