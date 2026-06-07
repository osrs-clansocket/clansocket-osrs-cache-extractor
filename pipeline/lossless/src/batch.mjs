/**
 * Shared batch extraction infrastructure for the OSRS pipeline.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { splitArchive } from './archive.mjs';
import { decompress } from './container.mjs';
import { parseReferenceTable } from './reference-table.mjs';
import { xteaDecrypt } from './xtea.mjs';
import { isLiveCache, readArchiveLive, listArchiveIdsLive } from './live-cache.mjs';

// ─── Config parsers (index 2) ────────────────────────
import { parseItemDef } from './loaders/item-loader.mjs';
import { parseKitDef } from './loaders/kit-loader.mjs';
import { parseNpcDef } from './loaders/npc-loader.mjs';
import { parseObjectDef } from './loaders/object-loader.mjs';
import { parseOverlayDef } from './loaders/overlay-loader.mjs';
import { parseSequenceDef } from './loaders/sequence-loader.mjs';
import { parseGraphicEffectDef } from './loaders/spotanim-loader.mjs';
import { parseUnderlayDef } from './loaders/underlay-loader.mjs';
import { parseVarbitDef } from './loaders/varbit-loader.mjs';

// ─── Non-config parsers ──────────────────────────────
import { parseFrameArchive } from './loaders/frame-loader.mjs';
import { parseFramemap } from './loaders/framemap-loader.mjs';
import { parseLocationData } from './loaders/locations-loader.mjs';
import { parseMapData } from './loaders/map-loader.mjs';
import { parseModel } from './loaders/model-loader.mjs';
import { parseSpriteGroup } from './loaders/sprite-loader.mjs';
import { parseTextureDef } from './loaders/texture-loader.mjs';
import { parseWorldArea } from './loaders/world-area-loader.mjs';

const CONFIG_PARSERS = {
  underlay: parseUnderlayDef, overlay: parseOverlayDef, object: parseObjectDef,
  npc: parseNpcDef, item: parseItemDef, sequence: parseSequenceDef,
  GraphicEffectDef: parseGraphicEffectDef, kit: parseKitDef, varbit: parseVarbitDef,
};

// ─── Helpers ──────────────────────────────────────────

export function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }

export function readDat(cacheDir, index, id) {
  if (isLiveCache(cacheDir)) return readArchiveLive(cacheDir, index, id);
  const p = path.join(cacheDir, String(index), `${id}.dat`);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

export function listDats(cacheDir, index) {
  if (isLiveCache(cacheDir)) return listArchiveIdsLive(cacheDir, index);
  const dir = path.join(cacheDir, String(index));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.dat'))
    .map(f => parseInt(f, 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);
}

export function loadRefTable(cacheDir, idx) {
  const raw = readDat(cacheDir, 255, idx);
  if (!raw) return null;
  try { return parseReferenceTable(decompress(raw).data); }
  catch { return null; }
}

export function writeJsonStream(filePath, arr) {
  const fd = fs.openSync(filePath, 'w');
  fs.writeSync(fd, '[\n');
  for (let i = 0; i < arr.length; i++) {
    const line = JSON.stringify(arr[i]);
    fs.writeSync(fd, (i > 0 ? ',\n' : '') + line);
  }
  fs.writeSync(fd, '\n]\n');
  fs.closeSync(fd);
}

export function elapsed(start) { return ((Date.now() - start) / 1000).toFixed(1) + 's'; }

// Shared streaming writer — opens fd, writes JSON array entries incrementally.
// Single open fd per file; each entry serialized + written + dropped. Avoids
// the in-memory accumulator that OOMs on 60k+ entry corpora.
function makeJsonArrayWriter(filePath) {
  let fd = null;
  let count = 0;
  return {
    append(entry) {
      if (fd == null) {
        fd = fs.openSync(filePath, 'w');
        fs.writeSync(fd, '[\n');
      } else {
        fs.writeSync(fd, ',\n');
      }
      fs.writeSync(fd, JSON.stringify(entry));
      count++;
    },
    close() {
      if (fd == null) {
        fd = fs.openSync(filePath, 'w');
        fs.writeSync(fd, '[]\n');
      } else {
        fs.writeSync(fd, '\n]\n');
      }
      fs.closeSync(fd);
      fd = null;
      return count;
    },
    get count() { return count; },
  };
}

// ─── Batch Processors ─────────────────────────────────

/**
 * Index 2: Config definitions for the typed archives in `configArchiveMap`.
 * @param {Object} configArchiveMap — archive ID → type name (e.g. {10: 'item'})
 */
export function batchConfigs(cacheDir, outputDir, refTable, configArchiveMap, parserOverrides) {
  const defDir = path.join(outputDir, 'definitions');
  mkdirp(defDir);
  let total = 0;

  if (!refTable) return 0;

  function streamArchive(typeName, archiveAid, parser) {
    const info = refTable.archives.get(archiveAid);
    if (!info) return 0;
    const raw = readDat(cacheDir, 2, archiveAid);
    if (!raw) return 0;

    let data;
    try { ({ data } = decompress(raw)); } catch { return 0; }

    const files = splitArchive(data, info.fileIds);
    const outPath = path.join(defDir, `${typeName}.json`);
    const fd = fs.openSync(outPath, 'w');
    let count = 0, errors = 0, first = true;
    try {
      fs.writeSync(fd, '[\n');
      for (const [fileId, fileData] of files) {
        if (fileData.length === 0) continue;
        let entry;
        try {
          entry = parser(fileId, fileData);
        } catch (e) {
          entry = { id: fileId, error: e.message };
          errors++;
        }
        const json = JSON.stringify(entry);
        if (!first) fs.writeSync(fd, ',\n');
        fs.writeSync(fd, json);
        first = false;
        count++;
      }
      fs.writeSync(fd, '\n]\n');
    } finally {
      fs.closeSync(fd);
    }
    console.log(`    ${typeName}: ${count} defs${errors ? ` (${errors} partial)` : ''}`);
    return count;
  }

  for (const [archiveId, typeName] of Object.entries(configArchiveMap)) {
    const parser = parserOverrides?.[typeName] ?? CONFIG_PARSERS[typeName];
    if (!parser) continue;
    total += streamArchive(typeName, parseInt(archiveId), parser);
  }

  return total;
}

/**
 * Index 0: Animation frames (archive-based with skeleton + frames)
 */
export function batchFrames(cacheDir, outputDir, refTable, { parser } = {}) {
  const outDir = path.join(outputDir, 'animations');
  mkdirp(outDir);
  const parseFn = parser || parseFrameArchive;

  const writer = makeJsonArrayWriter(path.join(outDir, 'animations.json'));
  let errors = 0;

  const datFiles = listDats(cacheDir, 0);
  for (const archiveId of datFiles) {
    const raw = readDat(cacheDir, 0, archiveId);
    if (!raw) continue;

    try {
      const data = decompress(raw).data;
      const info = refTable?.archives.get(archiveId);

      if (info && info.fileIds.length > 0) {
        const files = splitArchive(data, info.fileIds);
        writer.append(parseFn(archiveId, files));
      } else {
        writer.append({ archiveId, rawSize: data.length, frames: [] });
      }
    } catch (e) {
      writer.append({ archiveId, error: e.message });
      errors++;
    }

    if (writer.count % 1000 === 0) {
      process.stdout.write(`\r    ${writer.count} archives...`);
    }
  }

  const total = writer.close();
  console.log(`\r    ${total} frame archives (${errors} errors)`);
  return total;
}

/**
 * Index 1: Framemaps/Skeletons
 */
export function batchFramemaps(cacheDir, outputDir, refTable, { parser } = {}) {
  const outDir = path.join(outputDir, 'skeletons');
  mkdirp(outDir);
  const parseFn = parser || parseFramemap;

  const writer = makeJsonArrayWriter(path.join(outDir, 'skeletons.json'));
  let errors = 0;

  const datFiles = listDats(cacheDir, 1);
  for (const archiveId of datFiles) {
    const raw = readDat(cacheDir, 1, archiveId);
    if (!raw) continue;

    try {
      const data = decompress(raw).data;
      const info = refTable?.archives.get(archiveId);

      if (info && info.fileIds.length > 0) {
        const files = splitArchive(data, info.fileIds);
        for (const [fileId, fileData] of files) {
          if (fileData.length === 0) continue;
          const id = info.fileIds.length === 1 ? archiveId : fileId;
          try {
            writer.append(parseFn(id, fileData));
          } catch (e) {
            writer.append({ id, archiveId, error: e.message });
            errors++;
          }
        }
      } else {
        writer.append(parseFn(archiveId, data));
      }
    } catch (e) {
      writer.append({ id: archiveId, error: e.message });
      errors++;
    }
  }

  const total = writer.close();
  console.log(`    ${total} framemaps (${errors} errors)`);
  return total;
}

/**
 * Index 5: Maps (terrain + locations).
 *
 * Each archive in index 5 = one region with archiveId = (regionX << 8) | regionY.
 * The archive decompresses to a 5-file compound (split via archive.splitArchive):
 *   file 0 — landscape (terrain heights / underlays / overlays) — plaintext
 *   file 1 — locations (object placements) — XTEA-encrypted per region
 *   file 2 — ~228 byte env block
 *   file 3 — 2 byte marker
 *   file 4 — 1 byte flag
 *
 * XTEA keys load from $HOME/.runelite/cache/xtea.json
 * (format: { "<regionId>": [k1, k2, k3, k4], ... }).
 */
function loadXteaKeys() {
  const p = path.join(os.homedir(), '.runelite', 'cache', 'xtea.json');
  if (!fs.existsSync(p)) {
    console.log('    no XTEA keys at ~/.runelite/cache/xtea.json — locations will be skipped');
    return new Map();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    const m = new Map();
    for (const k of Object.keys(parsed)) {
      const aid = Number(k);
      if (!Number.isNaN(aid) && Array.isArray(parsed[k]) && parsed[k].length === 4) {
        m.set(aid, parsed[k]);
      }
    }
    console.log(`    loaded ${m.size} XTEA keys from ${p}`);
    return m;
  } catch (e) {
    console.log(`    failed to read XTEA keys: ${e.message}`);
    return new Map();
  }
}

function streamRegionJson(filePath, fillCb) {
  const fd = fs.openSync(filePath, 'w');
  const CHUNK_BYTES = 65536;
  let buf = '';
  let first = true;

  function emit(jsonStr) {
    buf += first ? '[\n' : ',\n';
    buf += jsonStr;
    first = false;
    if (buf.length >= CHUNK_BYTES) {
      fs.writeSync(fd, buf);
      buf = '';
    }
  }

  fillCb(emit);

  if (first) {
    fs.writeSync(fd, '[]\n');
  } else {
    buf += '\n]\n';
    fs.writeSync(fd, buf);
  }
  fs.closeSync(fd);
}

export function batchMaps(cacheDir, outputDir, refTable, { mapParser, locParser } = {}) {
  if (!refTable) {
    console.log('    no reference table — skipping maps');
    return 0;
  }

  const mapDir = path.join(outputDir, 'maps');
  const locDir = path.join(outputDir, 'locations');
  const envDir = path.join(outputDir, 'map-env');
  mkdirp(mapDir); mkdirp(locDir); mkdirp(envDir);

  const xteaByRegion = loadXteaKeys();

  const mapFn = mapParser || parseMapData;
  const locFn = locParser || parseLocationData;

  let mapCount = 0, locCount = 0, envCount = 0;
  let mapErrors = 0, locErrors = 0, locMissingKey = 0, archiveErrors = 0;

  for (const [aid, info] of refTable.archives) {
    const raw = readDat(cacheDir, 5, aid);
    if (!raw) { archiveErrors++; continue; }
    const x = aid >> 8;
    const y = aid & 0xFF;

    let decompressed;
    try {
      decompressed = decompress(raw).data;
    } catch {
      archiveErrors++;
      continue;
    }

    const files = splitArchive(decompressed, info.fileIds);

    const f0 = files.get(0);
    if (f0 && f0.length > 0) {
      try {
        streamRegionJson(path.join(mapDir, aid + '.json'), (emit) => {
          mapFn(x, y, f0, (plane, tx, ty, height, overlay, overlayShape, overlayRotation, flags, underlay) => {
            let out = '{"plane":' + plane + ',"x":' + tx + ',"y":' + ty;
            if (height !== undefined) out += ',"height":' + height;
            if (overlay !== undefined) out += ',"overlay":' + overlay + ',"overlayShape":' + overlayShape + ',"overlayRotation":' + overlayRotation;
            if (flags !== undefined) out += ',"flags":' + flags;
            if (underlay !== undefined) out += ',"underlay":' + underlay;
            out += '}';
            emit(out);
          });
        });
        mapCount++;
      } catch { mapErrors++; }
    }

    const f1 = files.get(1);
    if (f1 && f1.length > 0) {
      const key = xteaByRegion.get(aid);
      if (!key) {
        locMissingKey++;
      } else {
        try {
          const decrypted = xteaDecrypt(Buffer.from(f1), key);
          streamRegionJson(path.join(locDir, aid + '.json'), (emit) => {
            locFn(x, y, decrypted, (id, type, orientation, plane, localX, localY) => {
              emit('{"id":' + id + ',"type":' + type + ',"orientation":' + orientation + ',"plane":' + plane + ',"localX":' + localX + ',"localY":' + localY + '}');
            });
          });
          locCount++;
        } catch { locErrors++; }
      }
    }

    const f2 = files.get(2);
    const f3 = files.get(3);
    const f4 = files.get(4);
    if ((f2 && f2.length > 0) || (f3 && f3.length > 0) || (f4 && f4.length > 0)) {
      fs.writeFileSync(path.join(envDir, aid + '.json'), JSON.stringify({
        archiveId: aid, regionX: x, regionY: y,
        file2: f2 ? f2.toString('hex') : null,
        file3: f3 ? f3.toString('hex') : null,
        file4: f4 ? f4.toString('hex') : null,
      }));
      envCount++;
    }
  }

  const parts = [
    `${mapCount} terrain files`,
    `${locCount} locations files`,
    `${envCount} env/other files`,
  ];
  if (mapErrors) parts.push(`${mapErrors} map errors`);
  if (locErrors) parts.push(`${locErrors} location decrypt errors`);
  if (locMissingKey) parts.push(`${locMissingKey} regions missing XTEA key`);
  if (archiveErrors) parts.push(`${archiveErrors} archive errors`);
  console.log(`    ${parts.join(', ')}`);

  return mapCount + locCount + envCount;
}

/**
 * Index 7: Models (chunked output)
 */
export function batchModels(cacheDir, outputDir, options = {}) {
  const dirName = options.skipRgb ? 'models-hsl' : 'models';
  const modelDir = path.join(outputDir, dirName);
  mkdirp(modelDir);

  const CHUNK = 5000;
  let count = 0, errors = 0, chunkIdx = 0;
  let chunkFd = null, entriesInChunk = 0;

  function appendChunk(entry) {
    if (chunkFd == null) {
      chunkFd = fs.openSync(path.join(modelDir, `models-${chunkIdx}.json`), 'w');
      fs.writeSync(chunkFd, '[\n');
      entriesInChunk = 0;
    } else {
      fs.writeSync(chunkFd, ',\n');
    }
    fs.writeSync(chunkFd, JSON.stringify(entry));
    entriesInChunk++;
    if (entriesInChunk >= CHUNK) {
      fs.writeSync(chunkFd, '\n]\n');
      fs.closeSync(chunkFd);
      chunkFd = null;
      chunkIdx++;
    }
  }
  function closeChunk() {
    if (chunkFd == null) return;
    fs.writeSync(chunkFd, '\n]\n');
    fs.closeSync(chunkFd);
    chunkFd = null;
    chunkIdx++;
  }

  const datFiles = listDats(cacheDir, 7);
  for (const id of datFiles) {
    const raw = readDat(cacheDir, 7, id);
    if (!raw) continue;
    try {
      const model = parseModel(id, decompress(raw).data, options);
      appendChunk(model);
      count++;
    } catch (e) {
      appendChunk({ id });
      console.error(`  WARN: model ${id} failed: ${e.message}`);
      errors++;
    }
    if (count % 1000 === 0) {
      process.stdout.write(`\r    ${count} models...`);
    }
  }
  closeChunk();
  console.log(`\r    ${count} models in ${chunkIdx} chunks (${errors} errors)`);
  return count;
}

/**
 * Index 9, 19: Textures
 */
export function batchTextures(cacheDir, outputDir, indexId, refTable, dirName) {
  const outDir = path.join(outputDir, dirName);
  mkdirp(outDir);

  const writer = makeJsonArrayWriter(path.join(outDir, `${dirName}.json`));
  let errors = 0;

  const datFiles = listDats(cacheDir, indexId);
  for (const id of datFiles) {
    const raw = readDat(cacheDir, indexId, id);
    if (!raw) continue;
    try {
      const data = decompress(raw).data;
      const info = refTable?.archives.get(id);
      if (info && info.fileIds.length > 0) {
        const files = splitArchive(data, info.fileIds);
        for (const [fid, fdata] of files) {
          if (fdata.length > 0) {
            try { writer.append(parseTextureDef(fid, fdata)); }
            catch { writer.append({ id: fid, rawLength: fdata.length }); }
          }
        }
      } else {
        try { writer.append(parseTextureDef(id, data)); }
        catch { writer.append({ id, rawLength: data.length }); }
      }
    } catch {
      writer.append({ id });
      errors++;
    }
  }

  const total = writer.close();
  console.log(`    ${total} textures (${errors} errors)`);
  return total;
}

/**
 * Index 255: Meta (reference tables)
 */
export function batchMeta(cacheDir, outputDir) {
  mkdirp(path.join(outputDir, 'meta'));
  const writer = makeJsonArrayWriter(path.join(outputDir, 'meta', 'reference-tables.json'));
  for (const id of listDats(cacheDir, 255)) {
    const raw = readDat(cacheDir, 255, id);
    if (!raw) continue;
    try {
      const table = parseReferenceTable(decompress(raw).data);
      const archives = {};
      for (const [aid, info] of table.archives) {
        archives[aid] = { ...info, fileCount: info.fileIds.length };
      }
      writer.append({ indexId: id, format: table.format, version: table.version,
        flags: table.flags, archiveCount: table.archives.size, archives });
    } catch {}
  }
  const total = writer.close();
  console.log(`    ${total} reference tables`);
  return total;
}

/**
 * Index 8: Sprite groups. Each archive in index 8 is one sprite group (a
 * related set of frames sharing a palette and overall bounding box — used for
 * spellbook icons, prayer book icons, world map icons, UI buttons, etc.).
 *
 * Output layout:
 *   sprites/
 *     index.json                       — per-archive metadata (frame count, dims, offsets)
 *     png/<archiveId>/<frameIdx>.png   — each frame as RGBA PNG
 *
 * Each PNG is written with its own offset / dimensions; index.json carries the
 * group's overall bounding box and per-frame offsets so consumers can compose
 * sprites back into their group canvas (e.g. spellbook layout).
 */
export function batchSprites(cacheDir, outputDir) {
  const outDir = path.join(outputDir, 'sprites');
  const pngRoot = path.join(outDir, 'png');
  mkdirp(outDir);
  mkdirp(pngRoot);

  const datFiles = listDats(cacheDir, 8);
  const index = [];
  let archiveCount = 0, frameCount = 0, errors = 0;
  let lastReport = 0;

  for (const archiveId of datFiles) {
    const raw = readDat(cacheDir, 8, archiveId);
    if (!raw) continue;

    let payload;
    try { ({ data: payload } = decompress(raw)); }
    catch { errors++; continue; }

    let sprites;
    try { sprites = parseSpriteGroup(archiveId, payload); }
    catch { errors++; continue; }
    if (!sprites || sprites.length === 0) continue;

    const archDir = path.join(pngRoot, String(archiveId));
    mkdirp(archDir);

    const frames = [];
    for (let f = 0; f < sprites.length; f++) {
      const s = sprites[f];
      if (s.png) {
        fs.writeFileSync(path.join(archDir, `${f}.png`), s.png);
        frameCount++;
      }
      frames.push({
        frame: f,
        width: s.width,
        height: s.height,
        offsetX: s.offsetX,
        offsetY: s.offsetY,
        hasPng: s.png != null,
      });
    }

    index.push({
      archiveId,
      overallWidth: sprites[0]?.overallWidth,
      overallHeight: sprites[0]?.overallHeight,
      frameCount: sprites.length,
      frames,
    });
    archiveCount++;

    const now = Date.now();
    if (now - lastReport > 750) {
      process.stdout.write(`\r    ${archiveCount}/${datFiles.length} archives, ${frameCount} frames`);
      lastReport = now;
    }
  }

  index.sort((a, b) => a.archiveId - b.archiveId);
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 0));
  process.stdout.write(`\r    ${archiveCount} archives, ${frameCount} frames (${errors} errors)\n`);
  return archiveCount;
}

/**
 * Index 19 archive 0: Named World Areas (Mole Hole, Morytania Underground, etc.)
 *
 * Each entry has an internal snake_case name + a UI display name + region
 * chunk coords. Sibling to textures in index 19; the area defs share the index
 * but are filtered out by the texture script's parseTextureDef throw. This
 * extractor targets archive 0 specifically and outputs to world-areas.json.
 */
export function batchWorldAreas(cacheDir, outputDir, refTable) {
  const outDir = path.join(outputDir, 'world-areas');
  mkdirp(outDir);
  if (!refTable) return 0;

  const writer = makeJsonArrayWriter(path.join(outDir, 'world-areas.json'));
  let errors = 0;

  const info = refTable.archives.get(0);
  if (!info) { writer.close(); return 0; }

  const raw = readDat(cacheDir, 19, 0);
  if (!raw) { writer.close(); return 0; }

  let data;
  try { data = decompress(raw).data; }
  catch { writer.close(); return 0; }

  const files = splitArchive(data, info.fileIds);
  for (const [fid, fdata] of files) {
    if (fdata.length === 0) continue;
    try {
      const def = parseWorldArea(fid, fdata);
      writer.append(def);
      if (def.parseError) errors++;
    } catch (e) {
      writer.append({ id: fid, error: e.message });
      errors++;
    }
  }

  const total = writer.close();
  console.log(`    ${total} world areas (${errors} errors)`);
  return total;
}
