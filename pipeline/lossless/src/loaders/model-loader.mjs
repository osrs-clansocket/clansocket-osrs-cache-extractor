import { Stream } from '../stream.mjs';
import { hslToRgb } from '../bestbudz-palette.mjs';

/**
 * Parses a model from decompressed data.
 *
 * Format detection matches RuneLite's ModelLoader:
 *   data[-1]=0xFD, data[-2]=0xFF  → Type 3 (footer at -26, 8 flags + 6 data shorts)
 *   data[-1]=0xFE, data[-2]=0xFF  → Type 2 (footer at -23, 7 flags + 5 data shorts)
 *   data[-1]=0xFF, data[-2]=0xFF  → Type 1 (footer at -23, 7 flags + 5 data shorts)
 *   else                          → Old format (header at position 0)
 *
 * @param {number} id  Model ID
 * @param {Buffer} data  Decompressed model bytes
 * @param {object} [options]  Options
 * @param {boolean} [options.skipRgb]  If true, output raw HSL colors with no conversion or filtering
 */
export function parseModel(id, data, options = {}) {
  if (!data || data.length < 2) return { id, error: 'too small' };

  const last = data[data.length - 1] & 0xFF;
  const prev = data[data.length - 2] & 0xFF;

  if (prev === 0xFF && last === 0xFD) return decodeType3(id, data, options);
  if (prev === 0xFF && last === 0xFE) return decodeType2(id, data, options);
  if (prev === 0xFF && last === 0xFF) return decodeType1(id, data, options);
  return decodeOld(id, data);
}

// ═══════════════════════════════════════════════════════
// Type 2 — footer 0xFF 0xFE, 23 bytes from end
// Most common format in OSRS 2024 cache
// ═══════════════════════════════════════════════════════

function decodeType2(id, data, options = {}) {
  const buf = Buffer.from(data);
  const s = new Stream(buf);

  // ── Read 23-byte footer ──
  s.pos = buf.length - 23;
  const vertexCount     = s.readUnsignedShort();
  const faceCount       = s.readUnsignedShort();
  const texFaceCount    = s.readUnsignedByte();
  const hasTexData      = s.readUnsignedByte();
  const facePriority    = s.readUnsignedByte();
  const hasTransp       = s.readUnsignedByte();
  const hasPackedTranspVG = s.readUnsignedByte();
  const hasPackedVG     = s.readUnsignedByte();
  const animayaFlag     = s.readUnsignedByte();
  const xDataLen        = s.readUnsignedShort();
  const yDataLen        = s.readUnsignedShort();
  const zDataLen        = s.readUnsignedShort();
  const faceIdxLen      = s.readUnsignedShort();
  const vgCount         = s.readUnsignedShort();

  // ── Calculate offsets (matches RuneLite decodeType2 exactly) ──
  // Order: vertexFlags → faceTypes → priority → transpVG → texFlags → vg → transp → ...
  let pos = 0;
  const vertexFlagsOff = pos; pos += vertexCount;
  const faceTypesOff   = pos; pos += faceCount;
  const priorityOff    = pos; if (facePriority === 255) pos += faceCount;
  const transpVGOff    = pos; if (hasPackedTranspVG === 1) pos += faceCount;
  const texFlagsOff    = pos; if (hasTexData === 1) pos += faceCount;
  const vgOff          = pos; pos += vgCount;
  const transpOff      = pos; if (hasTransp === 1) pos += faceCount;
  const faceIdxOff     = pos; pos += faceIdxLen;
  const faceColorOff   = pos; pos += faceCount * 2;
  const texFaceOff     = pos; pos += texFaceCount * 6;
  const vertexXOff     = pos; pos += xDataLen;
  const vertexYOff     = pos; pos += yDataLen;
  const vertexZOff     = pos; pos += zDataLen;

  return decodeCommon(id, 'type2', buf,
    vertexCount, faceCount, texFaceCount,
    hasTexData, facePriority, hasTransp, hasPackedVG, animayaFlag,
    hasPackedTranspVG, transpVGOff,
    vertexFlagsOff, faceTypesOff, priorityOff, transpOff,
    faceIdxOff, faceColorOff, texFlagsOff, vgOff,
    texFaceOff, vertexXOff, vertexYOff, vertexZOff,
    null, options);
}

// ═══════════════════════════════════════════════════════
// Type 1 — footer 0xFF 0xFF, 23 bytes from end (OSRS)
// ═══════════════════════════════════════════════════════

function decodeType1(id, data, options = {}) {
  const buf = Buffer.from(data);
  const s = new Stream(buf);

  s.pos = buf.length - 23;
  const vertexCount       = s.readUnsignedShort();
  const faceCount         = s.readUnsignedShort();
  const texFaceCount      = s.readUnsignedByte();
  const hasRenderTypes    = s.readUnsignedByte();
  const facePriority      = s.readUnsignedByte();
  const hasTransp         = s.readUnsignedByte();
  const hasPackedTranspVG = s.readUnsignedByte();
  const hasFaceTextures   = s.readUnsignedByte();
  const hasPackedVG       = s.readUnsignedByte();
  const xDataLen          = s.readUnsignedShort();
  const yDataLen          = s.readUnsignedShort();
  const zDataLen          = s.readUnsignedShort();
  const faceIdxLen        = s.readUnsignedShort();
  const texIdxLen         = s.readUnsignedShort();

  // Read textureRenderTypes at offset 0 to count type-0 entries
  let type0TexCount = texFaceCount; // default: all are type-0
  if (texFaceCount > 0) {
    type0TexCount = 0;
    s.pos = 0;
    for (let i = 0; i < texFaceCount; i++) {
      if (s.readUnsignedByte() === 0) type0TexCount++;
    }
  }

  // ── Calculate offsets (matches RuneLite decodeType1 exactly) ──
  // textureRenderTypes (texFaceCount bytes) at file start
  // Then: vertexFlags → renderTypes → faceTypes → priority → transpVG → vg → transp
  //       → faceIdx → faceTextures → texIdx → faceColors → vertexXYZ → texFaces
  let pos = texFaceCount;
  const vertexFlagsOff  = pos; pos += vertexCount;
  const texFlagsOff     = pos; if (hasRenderTypes === 1) pos += faceCount;
  const faceTypesOff    = pos; pos += faceCount;
  const priorityOff     = pos; if (facePriority === 255) pos += faceCount;
  const transpVGOff     = pos; if (hasPackedTranspVG === 1) pos += faceCount;
  const vgOff           = pos; if (hasPackedVG === 1) pos += vertexCount;
  const transpOff       = pos; if (hasTransp === 1) pos += faceCount;
  const faceIdxOff      = pos; pos += faceIdxLen;
  const faceTexturesOff = pos; if (hasFaceTextures === 1) pos += faceCount * 2;
  const texIdxOff       = pos; pos += texIdxLen;
  const faceColorOff    = pos; pos += faceCount * 2;
  const vertexXOff      = pos; pos += xDataLen;
  const vertexYOff      = pos; pos += yDataLen;
  const vertexZOff      = pos; pos += zDataLen;
  const texFaceOff      = pos; // type-0 texFaces after vertex data

  // Pre-read separate faceTextures and texCoords for Type 1
  const separateTextureData = readSeparateTextures(
    buf, faceCount, texFaceCount,
    hasRenderTypes, texFlagsOff,
    hasFaceTextures, faceTexturesOff, texIdxOff);

  return decodeCommon(id, 'type1', buf,
    vertexCount, faceCount, type0TexCount,
    hasRenderTypes, facePriority, hasTransp, hasPackedVG, 0,
    hasPackedTranspVG, transpVGOff,
    vertexFlagsOff, faceTypesOff, priorityOff, transpOff,
    faceIdxOff, faceColorOff, texFlagsOff, vgOff,
    texFaceOff, vertexXOff, vertexYOff, vertexZOff,
    separateTextureData, options);
}

// ═══════════════════════════════════════════════════════
// Type 3 — footer 0xFF 0xFD, 26 bytes from end
// ═══════════════════════════════════════════════════════

function decodeType3(id, data, options = {}) {
  const buf = Buffer.from(data);
  const s = new Stream(buf);

  s.pos = buf.length - 26;
  const vertexCount       = s.readUnsignedShort();
  const faceCount         = s.readUnsignedShort();
  const texFaceCount      = s.readUnsignedByte();
  const hasRenderTypes    = s.readUnsignedByte();
  const facePriority      = s.readUnsignedByte();
  const hasTransp         = s.readUnsignedByte();
  const hasPackedTranspVG = s.readUnsignedByte();
  const hasFaceTextures   = s.readUnsignedByte();
  const hasPackedVG       = s.readUnsignedByte();
  const animayaFlag       = s.readUnsignedByte();
  const xDataLen          = s.readUnsignedShort();
  const yDataLen          = s.readUnsignedShort();
  const zDataLen          = s.readUnsignedShort();
  const faceIdxLen        = s.readUnsignedShort();
  const texIdxLen         = s.readUnsignedShort();
  const vgCount           = s.readUnsignedShort();

  // Read textureRenderTypes at offset 0 to count type-0 entries
  let type0TexCount = texFaceCount;
  if (texFaceCount > 0) {
    type0TexCount = 0;
    s.pos = 0;
    for (let i = 0; i < texFaceCount; i++) {
      if (s.readUnsignedByte() === 0) type0TexCount++;
    }
  }

  // ── Calculate offsets (matches RuneLite decodeType3 exactly) ──
  // textureRenderTypes (texFaceCount bytes) at file start
  // Then: vertexFlags → renderTypes → faceTypes → priority → transpVG → vg → transp
  //       → faceIdx → faceTextures → texIdx → faceColors → vertexXYZ → texFaces
  let pos = texFaceCount;
  const vertexFlagsOff  = pos; pos += vertexCount;
  const texFlagsOff     = pos; if (hasRenderTypes === 1) pos += faceCount;
  const faceTypesOff    = pos; pos += faceCount;
  const priorityOff     = pos; if (facePriority === 255) pos += faceCount;
  const transpVGOff     = pos; if (hasPackedTranspVG === 1) pos += faceCount;
  const vgOff           = pos; pos += vgCount;
  const transpOff       = pos; if (hasTransp === 1) pos += faceCount;
  const faceIdxOff      = pos; pos += faceIdxLen;
  const faceTexturesOff = pos; if (hasFaceTextures === 1) pos += faceCount * 2;
  const texIdxOff       = pos; pos += texIdxLen;
  const faceColorOff    = pos; pos += faceCount * 2;
  const vertexXOff      = pos; pos += xDataLen;
  const vertexYOff      = pos; pos += yDataLen;
  const vertexZOff      = pos; pos += zDataLen;
  const texFaceOff      = pos; // type-0 texFaces after vertex data

  // Pre-read separate faceTextures and texCoords for Type 3
  const separateTextureData = readSeparateTextures(
    buf, faceCount, texFaceCount,
    hasRenderTypes, texFlagsOff,
    hasFaceTextures, faceTexturesOff, texIdxOff);

  return decodeCommon(id, 'type3', buf,
    vertexCount, faceCount, type0TexCount,
    hasRenderTypes, facePriority, hasTransp, hasPackedVG, animayaFlag,
    hasPackedTranspVG, transpVGOff,
    vertexFlagsOff, faceTypesOff, priorityOff, transpOff,
    faceIdxOff, faceColorOff, texFlagsOff, vgOff,
    texFaceOff, vertexXOff, vertexYOff, vertexZOff,
    separateTextureData, options);
}

// ═══════════════════════════════════════════════════════
// Old format — header at position 0
// ═══════════════════════════════════════════════════════

function decodeOld(id, data) {
  const buf = Buffer.from(data);
  const s = new Stream(buf);

  const vertexCount    = s.readUnsignedShort();
  const faceCount      = s.readUnsignedShort();
  const texFaceCount   = s.readUnsignedByte();
  const hasFaceTypes   = s.readUnsignedByte();
  const facePriority   = s.readUnsignedByte();
  const hasAlpha       = s.readUnsignedByte();
  const hasFaceSkins   = s.readUnsignedByte();
  const hasVertexSkins = s.readUnsignedByte();

  // Export metadata only — old format is rare in OSRS 2024
  return {
    id,
    format: 'old',
    vertexCount,
    faceCount,
    texFaceCount,
  };
}

// ═══════════════════════════════════════════════════════
// Pre-read separate faceTextures + texCoords (Type 1/3)
//
// Type 1/3 store faceRenderTypes, faceTextures, and
// textureCoords as separate arrays (unlike Type 2 which
// packs them into a single combined byte per face).
//
// This reads those arrays and synthesizes a combined-byte
// faceTextures array matching the Type 2 format that
// decodeCommon expects.
// ═══════════════════════════════════════════════════════

function readSeparateTextures(buf, faceCount, texFaceCount,
  hasRenderTypes, renderTypesOff,
  hasFaceTextures, faceTexturesOff, texCoordsOff) {

  if (hasRenderTypes !== 1 && hasFaceTextures !== 1) return null;

  const s = new Stream(buf);

  // Read per-face render types (0=flat, 1=Gouraud, 2=textured+flat, 3=textured+Gouraud)
  let renderTypes = null;
  if (hasRenderTypes === 1) {
    renderTypes = new Array(faceCount);
    s.pos = renderTypesOff;
    for (let i = 0; i < faceCount; i++) {
      renderTypes[i] = s.readByte();
    }
  }

  // Read separate faceTextures (unsigned shorts, -1 adjusted) and textureCoords
  let texIds = null;
  let texCoords = null;
  if (hasFaceTextures === 1) {
    texIds = new Int16Array(faceCount);
    texCoords = new Int8Array(faceCount);
    texCoords.fill(-1);

    s.pos = faceTexturesOff;
    for (let i = 0; i < faceCount; i++) {
      texIds[i] = s.readUnsignedShort() - 1;
    }

    // textureCoords: only read for faces that have a texture AND texFaceCount > 0
    if (texFaceCount > 0) {
      const s2 = new Stream(buf);
      s2.pos = texCoordsOff;
      for (let i = 0; i < faceCount; i++) {
        if (texIds[i] !== -1) {
          texCoords[i] = s2.readUnsignedByte() - 1;
        }
      }
    }
  }

  return { renderTypes, texIds, texCoords };
}

// ═══════════════════════════════════════════════════════
// Common decoder shared by Type 1/2/3
// ═══════════════════════════════════════════════════════

function decodeCommon(id, format, buf,
  vertexCount, faceCount, texFaceCount,
  hasTexData, facePriority, hasTransp, hasPackedVG, animayaFlag,
  hasTriangleLabels, triangleLabelsOff,
  vertexFlagsOff, faceTypesOff, priorityOff, transpOff,
  faceIdxOff, faceColorOff, texFlagsOff, vgOff,
  texFaceOff, vertexXOff, vertexYOff, vertexZOff,
  separateTextureData = null, options = {}) {

  const s1 = new Stream(buf);
  const s2 = new Stream(buf);
  const s3 = new Stream(buf);
  const s4 = new Stream(buf);
  const s5 = new Stream(buf);

  // ── Decode vertices (delta-encoded ShortSmart) ──
  const vx = new Int32Array(vertexCount);
  const vy = new Int32Array(vertexCount);
  const vz = new Int32Array(vertexCount);

  s1.pos = vertexFlagsOff;
  s2.pos = vertexXOff;
  s3.pos = vertexYOff;
  s4.pos = vertexZOff;
  s5.pos = vgOff;

  const vertexLabels = (hasPackedVG === 1) ? new Array(vertexCount) : null;

  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < vertexCount; i++) {
    const flags = s1.readUnsignedByte();
    if ((flags & 1) !== 0) cx += s2.readShortSmart();
    if ((flags & 2) !== 0) cy += s3.readShortSmart();
    if ((flags & 4) !== 0) cz += s4.readShortSmart();
    vx[i] = cx; vy[i] = cy; vz[i] = cz;

    if (hasPackedVG === 1) vertexLabels[i] = s5.readUnsignedByte();
  }

  // Skip animaya bone-weighting block when the Type 3 footer flag is set.
  if (animayaFlag === 1) {
    for (let i = 0; i < vertexCount; i++) {
      const count = s5.readUnsignedByte();
      s5.skip(count * 2); // pairs of (group, scale)
    }
  }

  // ── Decode triangle labels (per-face bone assignment) ──
  const triangleLabels = (hasTriangleLabels === 1) ? new Array(faceCount) : null;
  if (hasTriangleLabels === 1) {
    s1.pos = triangleLabelsOff;
    for (let i = 0; i < faceCount; i++) {
      triangleLabels[i] = s1.readUnsignedByte();
    }
  }

  // ── Decode face colors ──
  const faceColors = new Array(faceCount);
  s1.pos = faceColorOff;
  for (let i = 0; i < faceCount; i++) {
    faceColors[i] = s1.readUnsignedShort();
  }

  // ── Decode face texture info ──
  // Type 2: single combined byte per face (render type + texture flag + coord index)
  // Type 1/3: separate faceRenderTypes, faceTextures, textureCoords arrays (pre-read)
  let faceTextures = null;
  if (separateTextureData) {
    // Type 1/3: synthesize combined-byte format from separate arrays
    const { renderTypes, texIds, texCoords } = separateTextureData;
    const hasAnyTexture = texIds !== null;
    const hasAnyRenderType = renderTypes !== null;

    if (hasAnyTexture || hasAnyRenderType) {
      faceTextures = new Array(faceCount);
      for (let i = 0; i < faceCount; i++) {
        let info = 0;
        if (hasAnyRenderType && (renderTypes[i] & 1)) info |= 1;
        if (hasAnyTexture && texIds[i] !== -1) {
          // Face is textured — encode texture flag + coord index
          // texCoords == -1 means "use face vertices" — encode as 0xFF, resolve after face indices
          const coord = texCoords[i] & 0xFF;
          info = (info & 1) | 2 | (coord << 2);
          faceColors[i] = texIds[i]; // replace HSL color with texture ID
        }
        faceTextures[i] = info;
      }
    }
  } else if (hasTexData) {
    // Type 2: read combined bytes directly (signed — RS2 treats 0xFF as -1)
    faceTextures = new Array(faceCount);
    s1.pos = texFlagsOff;
    for (let i = 0; i < faceCount; i++) {
      faceTextures[i] = s1.readByte();
    }
  }

  // ── Decode face priorities ──
  const facePriorities = facePriority === 255 ? new Array(faceCount) : null;
  if (facePriority === 255) {
    s1.pos = priorityOff;
    for (let i = 0; i < faceCount; i++) {
      facePriorities[i] = s1.readByte();
    }
  }

  // ── Decode face transparencies ──
  const faceAlphas = hasTransp ? new Array(faceCount) : null;
  if (hasTransp) {
    s1.pos = transpOff;
    for (let i = 0; i < faceCount; i++) {
      faceAlphas[i] = s1.readByte();
    }
  }

  // ── Decode face indices ──
  const fa = new Int32Array(faceCount);
  const fb = new Int32Array(faceCount);
  const fc = new Int32Array(faceCount);

  s1.pos = faceTypesOff;
  s2.pos = faceIdxOff;

  let a = 0, b = 0, c = 0;
  for (let i = 0; i < faceCount; i++) {
    // Lower 3 bits of the tritype byte encode the face type (1–4).
    const type = s1.readUnsignedByte() & 7;
    if (type === 1) {
      a = s2.readShortSmart() + c;
      b = s2.readShortSmart() + a;
      c = s2.readShortSmart() + b;
    } else if (type === 2) {
      b = c;
      c = s2.readShortSmart() + c;
    } else if (type === 3) {
      a = c;
      c = s2.readShortSmart() + c;
    } else if (type === 4) {
      const tmp = a;
      a = b;
      b = tmp;
      c = s2.readShortSmart() + c;
    }
    fa[i] = a; fb[i] = b; fc[i] = c;
  }

  // ── Decode textured face triangles ──
  // Use regular arrays (not Int32Array) so we can extend for dynamic entries
  const texA = new Array(texFaceCount);
  const texB = new Array(texFaceCount);
  const texC = new Array(texFaceCount);
  s1.pos = texFaceOff;
  for (let i = 0; i < texFaceCount; i++) {
    texA[i] = s1.readUnsignedShort();
    texB[i] = s1.readUnsignedShort();
    texC[i] = s1.readUnsignedShort();
  }

  // ── Resolve texCoords == -1 for Type 1/3 ──
  // When a textured face has textureCoords == -1 (encoded as 0xFF in info bits 2+),
  // the texture UV coordinates use the face's own vertex positions. Create dynamic
  // texFace entries for these faces so the client can index them normally.
  let finalTexFaceCount = texFaceCount;
  if (separateTextureData && faceTextures) {
    const texFaceMap = new Map();
    // Index existing texFace entries
    for (let i = 0; i < texFaceCount; i++) {
      texFaceMap.set(`${texA[i]},${texB[i]},${texC[i]}`, i);
    }

    for (let i = 0; i < faceCount; i++) {
      if ((faceTextures[i] & 2) && ((faceTextures[i] >> 2) & 0xFF) === 0xFF) {
        // This face needs a texFace entry using its own vertices
        const key = `${fa[i]},${fb[i]},${fc[i]}`;
        let idx = texFaceMap.get(key);
        if (idx === undefined) {
          idx = finalTexFaceCount;
          texA.push(fa[i]);
          texB.push(fb[i]);
          texC.push(fc[i]);
          texFaceMap.set(key, idx);
          finalTexFaceCount++;
        }
        // Replace 0xFF coord with actual index
        faceTextures[i] = (faceTextures[i] & 3) | (idx << 2);
      }
    }
  }

  // ── Build output ──
  const skipRgb = options.skipRgb === true;
  const noStrip = options.noStrip === true;
  const faces = skipRgb
    ? buildFacesRaw(fa, fb, fc, faceColors, faceTextures, faceAlphas, facePriorities, vx, vy, vz, texA, texB, texC, finalTexFaceCount, noStrip)
    : buildFaces(fa, fb, fc, faceColors, faceTextures, faceAlphas, facePriorities, vx, vy, vz);
  const out = {
    id,
    format,
    vertices: buildVertices(vx, vy, vz),
    faces,
    defaultPriority: facePriority !== 255 ? facePriority : undefined,
    textureFaces: finalTexFaceCount > 0 ? buildTexFaces(texA, texB, texC) : undefined,
  };
  if (vertexLabels) out.vertexLabels = Array.from(vertexLabels);
  if (triangleLabels) out.faceLabels = Array.from(triangleLabels);
  return out;
}

// ─── Output helpers ────────────────────────────────────

function buildVertices(x, y, z) {
  const out = new Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = [x[i], y[i], z[i]];
  return out;
}

/** Raw HSL output — no palette conversion.
 *  Strips two classes of structural sentinels that Jagex bakes into models:
 *
 *  1. GROUND TILES: a small group (2-6) of faces whose 3 vertices are all at
 *     the model's bottom-most Y, AND whose XZ span is significantly larger
 *     than every non-bottom face. These are decorative "placement tiles"
 *     visible in inventory icons but absent from OSRS in-game rendering
 *     (e.g. item 45 opal bolt tips, item 4762).
 *
 *  2. HSL=127 TEXTURE-OVERLAY MARKERS: non-textured faces with color=127
 *     (white) whose vertex tuple matches a textureFaces[] UV-reference
 *     triangle. These are texture-overlay anchors used by the CPU rasterizer
 *     to position a texture sample — they should never render as visible
 *     white triangles (e.g. item 303 small fishing net).
 */
function buildFacesRaw(a, b, c, colors, textures, alphas, priorities, vx, vy, vz, texA, texB, texC, texFaceCount, noStrip) {
  const groundTile = noStrip ? new Array(a.length).fill(false) : detectGroundTiles(a, b, c, vx, vy, vz);
  const textureMarker = noStrip ? new Array(a.length).fill(false) : detectTextureOverlayMarkers(a, b, c, colors, textures, texA, texB, texC, texFaceCount);
  const out = [];
  for (let i = 0; i < a.length; i++) {
    if (groundTile[i]) continue;
    if (textureMarker[i]) continue;
    out.push({
      a: a[i], b: b[i], c: c[i],
      color: colors[i],
      info: textures ? textures[i] : 0,
      alpha: alphas ? alphas[i] : 0,
      priority: priorities ? priorities[i] : 0,
    });
  }
  return out;
}

function detectGroundTiles(a, b, c, vx, vy, vz) {
  const fc = a.length;
  const out = new Array(fc).fill(false);
  if (!vx || !vy || !vz || fc === 0) return out;

  let maxY = -Infinity;
  for (let v = 0; v < vy.length; v++) if (vy[v] > maxY) maxY = vy[v];

  const candidates = [];
  let maxOtherSpan = 0;
  let maxGroundSpan = 0;

  for (let i = 0; i < fc; i++) {
    const ia = a[i], ib = b[i], ic = c[i];
    if (ia < 0 || ib < 0 || ic < 0 || ia >= vx.length || ib >= vx.length || ic >= vx.length) continue;
    const xs = [vx[ia], vx[ib], vx[ic]];
    const zs = [vz[ia], vz[ib], vz[ic]];
    const span = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs)
    );
    if (span === 0) continue;
    const allAtBottom = vy[ia] === maxY && vy[ib] === maxY && vy[ic] === maxY;
    if (allAtBottom) {
      candidates.push(i);
      if (span > maxGroundSpan) maxGroundSpan = span;
    } else if (span > maxOtherSpan) {
      maxOtherSpan = span;
    }
  }

  if (candidates.length < 2 || candidates.length > 6) return out;
  if (maxGroundSpan < 3 * Math.max(1, maxOtherSpan)) return out;

  for (const i of candidates) out[i] = true;
  return out;
}

function detectTextureOverlayMarkers(a, b, c, colors, textures, texA, texB, texC, texFaceCount) {
  const fc = a.length;
  const out = new Array(fc).fill(false);
  if (!texA || texFaceCount === 0) return out;

  const texSet = new Set();
  for (let i = 0; i < texFaceCount; i++) {
    const sorted = [texA[i], texB[i], texC[i]].sort((x, y) => x - y);
    texSet.add(sorted[0] + ',' + sorted[1] + ',' + sorted[2]);
  }

  for (let i = 0; i < fc; i++) {
    const col = colors[i];
    if (col !== 0 && col !== 127 && col !== 255) continue;
    const info = textures ? textures[i] : 0;
    if ((info & 2) !== 0) continue;
    const sorted = [a[i], b[i], c[i]].sort((x, y) => x - y);
    const key = sorted[0] + ',' + sorted[1] + ',' + sorted[2];
    if (texSet.has(key)) out[i] = true;
  }

  return out;
}

function buildFaces(a, b, c, colors, textures, alphas, priorities, vx, vy, vz) {
  const out = [];
  for (let i = 0; i < a.length; i++) {
    // faceColors is dual-purpose in RS binary format:
    //   - Non-textured faces (bit 1 of faceInfo == 0): Jagex packed HSL color → bake to RGB
    //   - Textured faces (bit 1 of faceInfo == 1): texture ID (0-125) → pass through as-is
    // IMPORTANT: check bit 1 specifically, NOT "!= 0" — bit 0 is the flat-shading flag
    // which does NOT indicate texturing. Using "!= 0" skips HSL→RGB conversion for
    // flat-shaded non-textured faces, producing raw HSL numbers as face colors (grey triangles).
    const isTextured = textures && (textures[i] & 2) !== 0;
    const info = textures ? textures[i] : 0;

    // RS2 sentinel: faceInfo == -1 marks invisible structural faces — strip at source.
    if (info === -1) continue;

    // RS2 undocumented sentinel: HSL 0 (hue=0, sat=0, lum=0) marks hidden/structural
    // faces. The palette maps HSL 0 → RGB(0,0,1), never RGB(0,0,0). The CPU rasterizer
    // produces zero-brightness pixels for these — effectively invisible. 319k faces
    // across 10k models: ground plates, occlusion planes, and interior hidden faces.
    if (!isTextured && colors[i] === 0) continue;

    // RS2 undocumented sentinel: HSL 127 (hue=0, sat=0, lum=127) marks structural
    // occlusion geometry — 254k faces across 4119 models, never legitimate visible
    // content. The CPU rasterizer hid these via back-face culling + painter's algorithm;
    // GPU depth buffer renders them as phantom white triangles. Strip at source.
    if (!isTextured && colors[i] === 127) continue;

    let color;
    if (isTextured) {
      color = colors[i]; // texture ID, not HSL
    } else {
      color = hslToRgb(colors[i]); // BestBudz palette lookup
      // Sentinel RGB values (-1, -2, -3) = invisible faces — strip at source.
      if (color < 0) continue;
    }

    // RS2 faceAlpha 255 (unsigned) = fully invisible — strip at source.
    const rawAlpha = alphas ? alphas[i] : 0;
    if ((rawAlpha & 0xFF) === 255) continue;

    // RS2 ground plate detection: strip flat horizontal faces at ground level.
    // RS2 CPU renderer needed fake ground tiles baked into object models because
    // painter's algorithm would hide terrain underneath. GPU depth buffer handles
    // terrain visibility automatically — these embedded floor faces are unnecessary.
    // Detection: all 3 vertices at Y >= -1 (ground level) AND triangle spans >= 64
    // units in XZ (full tile width). This catches the 128x128 unit quads and similar.
    if (vx && vy && vz) {
      const ya = vy[a[i]], yb = vy[b[i]], yc = vy[c[i]];
      if (ya >= -1 && yb >= -1 && yc >= -1) {
        const xa = vx[a[i]], xb = vx[b[i]], xc = vx[c[i]];
        const za = vz[a[i]], zb = vz[b[i]], zc = vz[c[i]];
        const xSpan = Math.max(xa, xb, xc) - Math.min(xa, xb, xc);
        const zSpan = Math.max(za, zb, zc) - Math.min(za, zb, zc);
        if (xSpan >= 64 || zSpan >= 64) continue;
      }
    }

    out.push({
      a: a[i], b: b[i], c: c[i],
      color,
      info,
      alpha: rawAlpha !== 0 ? rawAlpha : 0,
      priority: priorities ? priorities[i] : 0,
    });
  }
  return out;
}

function buildTexFaces(a, b, c) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = [a[i], b[i], c[i]];
  return out;
}
