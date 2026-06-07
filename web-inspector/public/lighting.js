/**
 * ItemLighter port. Computes per-vertex Gouraud + per-face flat lighting
 * matching RuneLite + Java extractor pipeline.
 *
 * Face type lives in bits 0-1 of face.info:
 *   0 = Gouraud non-textured  (per-vertex HSL modulated by luminance)
 *   1 = flat non-textured     (one HSL for all 3 verts, face-normal lighting)
 *   2 = Gouraud textured      (per-vertex grey ramp, textureId picks bitmap)
 *   3 = flat textured         (one grey value, textureId picks bitmap)
 *
 * Dual-side output (litA/litB/litC vs litBackA/litBackB/litBackC) lets the
 * fragment shader pick the front/back color by gl_FrontFacing — no second pass.
 */

import { hslToRgb } from './palette.js';

const LIGHT_X = -50;
const LIGHT_Y = -10;
const LIGHT_Z = -50;
const AMBIENT_BASE = 64;
const CONTRAST_BASE = 768;
const LUMINANCE_MASK = 127;
const HUESAT_MASK = 65408;
const LUMINANCE_MIN = 2;
const LUMINANCE_MAX = 126;
const NORMAL_SCALE = 256;
const NORMAL_REDUCE_THRESHOLD = 8192;

const TYPE_MASK = 3;
const TYPE_FLAT_BIT = 1;
const TYPE_TEXTURED_BIT = 2;

export function applyLighting(model, itemAmbient = 0, itemContrast = 0) {
  const vc = model.vertices.length;
  const fc = model.faces.length;
  if (vc === 0 || fc === 0) {
    attachEmpty(model);
    return;
  }

  const vnX = new Int32Array(vc);
  const vnY = new Int32Array(vc);
  const vnZ = new Int32Array(vc);
  const vnCount = new Int32Array(vc);

  for (let f = 0; f < fc; f++) {
    const face = model.faces[f];
    const a = face.a, b = face.b, c = face.c;
    if (a < 0 || b < 0 || c < 0 || a >= vc || b >= vc || c >= vc) continue;
    if ((face.info & TYPE_FLAT_BIT) !== 0) continue;
    const n = computeFaceNormal(model, a, b, c);
    vnX[a] += n[0]; vnY[a] += n[1]; vnZ[a] += n[2]; vnCount[a]++;
    vnX[b] += n[0]; vnY[b] += n[1]; vnZ[b] += n[2]; vnCount[b]++;
    vnX[c] += n[0]; vnY[c] += n[1]; vnZ[c] += n[2]; vnCount[c]++;
  }

  const ambient = itemAmbient + AMBIENT_BASE;
  const contrast = itemContrast + CONTRAST_BASE;
  const lightMag = Math.floor(Math.sqrt(LIGHT_X * LIGHT_X + LIGHT_Y * LIGHT_Y + LIGHT_Z * LIGHT_Z));
  const var7 = (lightMag * contrast) >> 8;
  const var7Flat = var7 + (var7 >> 1);

  const litA = new Int32Array(fc);
  const litB = new Int32Array(fc);
  const litC = new Int32Array(fc);
  const litBackA = new Int32Array(fc);
  const litBackB = new Int32Array(fc);
  const litBackC = new Int32Array(fc);

  for (let f = 0; f < fc; f++) {
    const face = model.faces[f];
    const hsl = face.color;
    const a = face.a, b = face.b, c = face.c;
    const t = face.info & TYPE_MASK;
    const flat = (t & TYPE_FLAT_BIT) !== 0;
    const textured = (t & TYPE_TEXTURED_BIT) !== 0;

    if (a < 0 || b < 0 || c < 0 || a >= vc || b >= vc || c >= vc) {
      const fb = textured ? packGrey(LUMINANCE_LEVELS_HALF) : Math.max(0, hslToRgb(hsl));
      litA[f] = litB[f] = litC[f] = fb;
      litBackA[f] = litBackB[f] = litBackC[f] = fb;
      continue;
    }

    if (textured && flat) {
      const fn = computeFaceNormal(model, a, b, c);
      const dot = LIGHT_X * fn[0] + LIGHT_Y * fn[1] + LIGHT_Z * fn[2];
      const lumF = clampLum(((dot / var7Flat) | 0) + ambient);
      const lumB = clampLum(((-dot / var7Flat) | 0) + ambient);
      litA[f] = litB[f] = litC[f] = packGrey(lumF);
      litBackA[f] = litBackB[f] = litBackC[f] = packGrey(lumB);
      continue;
    }

    if (textured) {
      litA[f] = packGrey(vertLum(vnX[a], vnY[a], vnZ[a], vnCount[a], var7, ambient, false));
      litB[f] = packGrey(vertLum(vnX[b], vnY[b], vnZ[b], vnCount[b], var7, ambient, false));
      litC[f] = packGrey(vertLum(vnX[c], vnY[c], vnZ[c], vnCount[c], var7, ambient, false));
      litBackA[f] = packGrey(vertLum(vnX[a], vnY[a], vnZ[a], vnCount[a], var7, ambient, true));
      litBackB[f] = packGrey(vertLum(vnX[b], vnY[b], vnZ[b], vnCount[b], var7, ambient, true));
      litBackC[f] = packGrey(vertLum(vnX[c], vnY[c], vnZ[c], vnCount[c], var7, ambient, true));
      continue;
    }

    if (flat) {
      const fn = computeFaceNormal(model, a, b, c);
      const dot = LIGHT_X * fn[0] + LIGHT_Y * fn[1] + LIGHT_Z * fn[2];
      const tmpF = ((dot / var7Flat) | 0) + ambient;
      const tmpB = ((-dot / var7Flat) | 0) + ambient;
      const rgbF = Math.max(0, hslToRgb(modulateLum(hsl, tmpF)));
      const rgbB = Math.max(0, hslToRgb(modulateLum(hsl, tmpB)));
      litA[f] = litB[f] = litC[f] = rgbF;
      litBackA[f] = litBackB[f] = litBackC[f] = rgbB;
      continue;
    }

    litA[f] = vertRgb(hsl, vnX[a], vnY[a], vnZ[a], vnCount[a], var7, ambient, false);
    litB[f] = vertRgb(hsl, vnX[b], vnY[b], vnZ[b], vnCount[b], var7, ambient, false);
    litC[f] = vertRgb(hsl, vnX[c], vnY[c], vnZ[c], vnCount[c], var7, ambient, false);
    litBackA[f] = vertRgb(hsl, vnX[a], vnY[a], vnZ[a], vnCount[a], var7, ambient, true);
    litBackB[f] = vertRgb(hsl, vnX[b], vnY[b], vnZ[b], vnCount[b], var7, ambient, true);
    litBackC[f] = vertRgb(hsl, vnX[c], vnY[c], vnZ[c], vnCount[c], var7, ambient, true);
  }

  model.litA = litA; model.litB = litB; model.litC = litC;
  model.litBackA = litBackA; model.litBackB = litBackB; model.litBackC = litBackC;
}

const LUMINANCE_LEVELS_HALF = 64;

function attachEmpty(model) {
  model.litA = new Int32Array(0);
  model.litB = new Int32Array(0);
  model.litC = new Int32Array(0);
  model.litBackA = new Int32Array(0);
  model.litBackB = new Int32Array(0);
  model.litBackC = new Int32Array(0);
}

function computeFaceNormal(model, a, b, c) {
  const va = model.vertices[a], vb = model.vertices[b], vcv = model.vertices[c];
  let xA = vb[0] - va[0], yA = vb[1] - va[1], zA = vb[2] - va[2];
  let xB = vcv[0] - va[0], yB = vcv[1] - va[1], zB = vcv[2] - va[2];
  let nx = yA * zB - yB * zA;
  let ny = zA * xB - zB * xA;
  let nz = xA * yB - xB * yA;
  while (Math.abs(nx) > NORMAL_REDUCE_THRESHOLD
      || Math.abs(ny) > NORMAL_REDUCE_THRESHOLD
      || Math.abs(nz) > NORMAL_REDUCE_THRESHOLD) {
    nx >>= 1; ny >>= 1; nz >>= 1;
  }
  let len = Math.floor(Math.sqrt(nx * nx + ny * ny + nz * nz));
  if (len <= 0) len = 1;
  return [
    (nx * NORMAL_SCALE / len) | 0,
    (ny * NORMAL_SCALE / len) | 0,
    (nz * NORMAL_SCALE / len) | 0,
  ];
}

function vertRgb(hsl, nx, ny, nz, count, var7, ambient, back) {
  if (count <= 0 || var7 <= 0) return Math.max(0, hslToRgb(hsl));
  let dot = LIGHT_X * nx + LIGHT_Y * ny + LIGHT_Z * nz;
  if (back) dot = -dot;
  const tmp = ((dot / (var7 * count)) | 0) + ambient;
  return Math.max(0, hslToRgb(modulateLum(hsl, tmp)));
}

function vertLum(nx, ny, nz, count, var7, ambient, back) {
  if (count <= 0 || var7 <= 0) return clampLum(ambient);
  let dot = LIGHT_X * nx + LIGHT_Y * ny + LIGHT_Z * nz;
  if (back) dot = -dot;
  return clampLum(((dot / (var7 * count)) | 0) + ambient);
}

function clampLum(v) {
  if (v < LUMINANCE_MIN) return LUMINANCE_MIN;
  if (v > LUMINANCE_MAX) return LUMINANCE_MAX;
  return v;
}

function packGrey(lum) {
  const b = lum & 0xff;
  return (b << 16) | (b << 8) | b;
}

function modulateLum(hsl, factor) {
  let adjusted = ((hsl & LUMINANCE_MASK) * factor) >> 7;
  if (adjusted < LUMINANCE_MIN) adjusted = LUMINANCE_MIN;
  if (adjusted > LUMINANCE_MAX) adjusted = LUMINANCE_MAX;
  return (hsl & HUESAT_MASK) + adjusted;
}

export function applyColorReplacements(model, originalColors, replacementColors) {
  if (!originalColors || !replacementColors) return;
  const n = Math.min(originalColors.length, replacementColors.length);
  for (let i = 0; i < n; i++) {
    const find = originalColors[i];
    const rep = replacementColors[i];
    for (const face of model.faces) {
      if (face.color === find) face.color = rep;
    }
  }
}
