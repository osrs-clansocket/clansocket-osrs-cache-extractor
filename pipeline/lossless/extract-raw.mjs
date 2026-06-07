#!/usr/bin/env node

/**
 * OSRS Raw JSON Extractor — cache-faithful, no BestBudz adaptations.
 *
 * Goal: dump the cache as JSON in Jagex/RuneLite-canonical structure so the
 * engine team can compare against rendering reality (plane heights, bridge
 * geometry, model placement) and identify where our pipeline drifts from what
 * the cache actually says.
 *
 * What this script does NOT do:
 *   - rename fields (flags vs settings, overlay vs overlayId, etc.)
 *   - resolve sentinels (0xFFFF → -1) outside what the loader strictly needs
 *   - reshape sparse data into fixed-size arrays
 *   - bucket plane/tile data into BestBudz client/server formats
 *   - drop "empty" tiles that the cache encoded with zero attributes
 *
 * What it DOES do:
 *   - decompress containers (raw / bzip2 / gzip)
 *   - split multi-file archives via the reference table
 *   - XTEA-decrypt index-5 file 1 (locations) using ~/.runelite/cache/xtea.json
 *   - parse maps with RuneLite MapLoader field semantics
 *   - parse locations with RuneLite RegionLoader field semantics
 *   - parse index-2 config archives via the existing loaders (already mostly
 *     RuneLite-faithful) — surface _unknownOpcodes / _incomplete markers so
 *     drift between our parser and modern OSRS opcodes is visible
 *
 * Output layout (under <CacheEditing>/raw_cache/):
 *   manifest.json
 *   reference-tables/
 *     index-{N}.json
 *   maps/
 *     {regionId}-r{x}-{y}.json
 *   configs/
 *     Items-{chunk}.json   Objects-{chunk}.json   Npcs-{chunk}.json
 *     Sequences-{chunk}.json   Underlays.json   Overlays.json
 *     Varbits-{chunk}.json   Kits.json   GraphicEffects-{chunk}.json
 *   world-areas/
 *     world-areas.json
 *
 * Models / animation frames / texture sprites are not dumped as JSON by default
 * (one JSON per model = ~3GB). Use --include-binary to also write the raw
 * decompressed payloads to raw_cache/bin/ for byte-level inspection.
 *
 * Usage:
 *   node osrs_extract-raw.mjs
 *   node osrs_extract-raw.mjs --cache-dir <path>
 *   node osrs_extract-raw.mjs --out <path>
 *   node osrs_extract-raw.mjs --only maps              dump only maps
 *   node osrs_extract-raw.mjs --only configs           dump only configs
 *   node osrs_extract-raw.mjs --only world-areas
 *   node osrs_extract-raw.mjs --include-binary         also dump raw .bin files
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { Stream } from './src/stream.mjs';
import { decompress } from './src/container.mjs';
import { splitArchive } from './src/archive.mjs';
import { parseReferenceTable } from './src/reference-table.mjs';
import { xteaDecrypt } from './src/xtea.mjs';
import {
  defaultLiveCachePath, isLiveCache,
  readArchiveLive, listArchiveIdsLive,
} from './src/live-cache.mjs';

// Loaders — these are already RuneLite-faithful for the most part.
// We re-export their output verbatim, preserving _unknownOpcodes markers.
import { parseItemDef } from './src/loaders/item-loader.mjs';
import { parseKitDef } from './src/loaders/kit-loader.mjs';
import { parseNpcDef } from './src/loaders/npc-loader.mjs';
import { parseObjectDef } from './src/loaders/object-loader.mjs';
import { parseOverlayDef } from './src/loaders/overlay-loader.mjs';
import { parseSequenceDef } from './src/loaders/sequence-loader.mjs';
import { parseGraphicEffectDef } from './src/loaders/spotanim-loader.mjs';
import { parseUnderlayDef } from './src/loaders/underlay-loader.mjs';
import { parseVarbitDef } from './src/loaders/varbit-loader.mjs';
import { parseLocationData } from './src/loaders/locations-loader.mjs';
import { parseWorldArea } from './src/loaders/world-area-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Index 2 archive routing.
const CONFIG_ARCHIVES = {
  1:  { name: 'Underlays',       parser: parseUnderlayDef,       chunkSize: 0     },
  4:  { name: 'Overlays',        parser: parseOverlayDef,        chunkSize: 0     },
  6:  { name: 'Objects',         parser: parseObjectDef,         chunkSize: 5000  },
  9:  { name: 'Npcs',            parser: parseNpcDef,            chunkSize: 2000  },
  10: { name: 'Items',           parser: parseItemDef,           chunkSize: 5000  },
  12: { name: 'Sequences',       parser: parseSequenceDef,       chunkSize: 2000  },
  13: { name: 'GraphicEffects',  parser: parseGraphicEffectDef,  chunkSize: 2000  },
  14: { name: 'Varbits',         parser: parseVarbitDef,         chunkSize: 5000  },
  29: { name: 'Kits',            parser: parseKitDef,            chunkSize: 0     },
};

// ─── CLI ──────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    cacheDir: null, outDir: null,
    only: null, includeBinary: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cache-dir') args.cacheDir = argv[++i];
    else if (a === '--out') args.outDir = argv[++i];
    else if (a === '--only') args.only = argv[++i];
    else if (a === '--include-binary') args.includeBinary = true;
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node osrs_extract-raw.mjs [options]`);
  console.log(`  --cache-dir <path>   RuneLite live cache (default: ${defaultLiveCachePath()})`);
  console.log(`  --out <path>         Output dir (default: <CacheEditing>/raw_cache)`);
  console.log(`  --only <section>     One of: maps, configs, world-areas, reference-tables`);
  console.log(`  --include-binary     Also dump decompressed .bin payloads to raw_cache/bin/`);
}

// ─── Helpers ──────────────────────────────────────────

function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }

function loadRefTable(cacheDir, indexId) {
  const raw = readArchiveLive(cacheDir, 255, indexId);
  if (!raw) return null;
  try { return parseReferenceTable(decompress(raw).data); }
  catch { return null; }
}

function loadXteaKeys() {
  const p = path.join(os.homedir(), '.runelite', 'cache', 'xtea.json');
  if (!fs.existsSync(p)) return new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    const m = new Map();
    for (const k of Object.keys(parsed)) {
      const aid = Number(k);
      if (!Number.isNaN(aid) && Array.isArray(parsed[k]) && parsed[k].length === 4) {
        m.set(aid, parsed[k]);
      }
    }
    return m;
  } catch { return new Map(); }
}

function elapsed(start) { return ((Date.now() - start) / 1000).toFixed(1) + 's'; }

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function listPresentIndices(cacheDir) {
  const prefix = 'main_file_cache.idx';
  const found = new Set();
  for (const f of fs.readdirSync(cacheDir)) {
    if (!f.startsWith(prefix)) continue;
    const suffix = f.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    found.add(parseInt(suffix, 10));
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * RuneLite-faithful map parser. Walks the terrain byte stream and accumulates
 * per-tile state in a sparse [plane][x][y] grid. Field names match
 * net.runelite.cache.region.Region / MapLoader exactly.
 *
 * Per-attr semantics (modern OSRS, unchanged since 2010-era):
 *   attr === 0     : tile complete
 *   attr === 1     : height = readUnsignedByte(); tile complete
 *   attr 2..49     : overlayId = readShort();
 *                    overlayPath = (attr - 2) >>> 2
 *                    overlayRotation = (attr - 2) & 3
 *                    attrOpcode = attr        (kept for debugging)
 *   attr 50..81    : settings = attr - 49     (5-bit packed: bridge/roof/blocked/forceDraw/etc.)
 *   attr 82+       : underlayId = attr - 81
 */
function parseMapNative(data) {
  const s = new Stream(data);
  const tiles = {}; // plane → x → y → fields

  for (let plane = 0; plane < 4; plane++) {
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        let tile = null;
        let attrsSeen = null;
        while (true) {
          const attr = s.readUnsignedShort();
          if (attr === 0) break;
          if (tile == null) { tile = {}; attrsSeen = []; }
          attrsSeen.push(attr);
          if (attr === 1) {
            tile.height = s.readUnsignedByte();
            break;
          }
          if (attr <= 49) {
            tile.attrOpcode = attr;
            tile.overlayId = s.readShort();
            tile.overlayPath = (attr - 2) >>> 2;
            tile.overlayRotation = (attr - 2) & 3;
          } else if (attr <= 81) {
            tile.settings = attr - 49;
          } else {
            tile.underlayId = attr - 81;
          }
        }
        if (tile != null) {
          if (tile.settings != null) {
            tile.settingsBits = [
              (tile.settings & 0x01) !== 0,
              (tile.settings & 0x02) !== 0,
              (tile.settings & 0x04) !== 0,
              (tile.settings & 0x08) !== 0,
              (tile.settings & 0x10) !== 0,
            ];
          }
          tile._attrsSeen = attrsSeen;
          if (!tiles[plane]) tiles[plane] = {};
          if (!tiles[plane][x]) tiles[plane][x] = {};
          tiles[plane][x][y] = tile;
        }
      }
    }
  }

  return {
    tiles,
    bytesConsumed: s.pos,
    bytesTrailing: s.length - s.pos,
  };
}

function collectLocationsNative(data) {
  const locations = [];
  parseLocationData(0, 0, data, (id, type, orientation, plane, localX, localY) => {
    locations.push({ id, type, orientation, plane, localX, localY });
  });
  return locations;
}

// ─── Section: maps ────────────────────────────────────

function dumpMaps(cacheDir, outDir, xteaKeys) {
  const mapsDir = path.join(outDir, 'maps');
  mkdirp(mapsDir);

  const refTable = loadRefTable(cacheDir, 5);
  if (!refTable) {
    console.log('    no reference table for index 5 — skipping');
    return { archives: 0, files: 0, errors: 0 };
  }

  let archives = 0, written = 0, decrypted = 0, missingKey = 0, errors = 0;
  let lastReport = 0;
  const ids = [...refTable.archives.keys()].sort((a, b) => a - b);

  for (const aid of ids) {
    const info = refTable.archives.get(aid);
    const raw = readArchiveLive(cacheDir, 5, aid);
    if (!raw) { errors++; continue; }

    let payload;
    try { ({ data: payload } = decompress(raw)); }
    catch (e) {
      fs.writeFileSync(path.join(mapsDir, `${aid}.error.txt`), `decompress failed: ${e.message}\n`);
      errors++; continue;
    }

    const regionX = aid >> 8;
    const regionY = aid & 0xFF;

    let parts;
    try { parts = splitArchive(payload, info.fileIds); }
    catch (e) {
      fs.writeFileSync(path.join(mapsDir, `${aid}-r${regionX}-${regionY}.error.txt`),
        `splitArchive failed: ${e.message}\nfileCount: ${info.fileIds.length}\n`);
      errors++; continue;
    }

    const out = {
      regionId: aid,
      regionX,
      regionY,
      sourceIndex: 5,
      sourceArchiveId: aid,
      sourceFileIds: info.fileIds,
      terrain: null,
      locations: null,
      locationsXteaStatus: null,
      auxFiles: {},
    };

    const f0 = parts.get(0);
    if (f0 && f0.length > 0) {
      try { out.terrain = parseMapNative(f0); }
      catch (e) { out.terrain = { error: e.message, bytes: f0.length }; }
    }

    const f1 = parts.get(1);
    if (f1 && f1.length > 0) {
      const key = xteaKeys.get(aid);
      if (key) {
        try {
          const decryptedBuf = xteaDecrypt(Buffer.from(f1), key);
          out.locations = collectLocationsNative(decryptedBuf);
          out.locationsXteaStatus = 'decrypted';
          decrypted++;
        } catch (e) {
          out.locations = null;
          out.locationsXteaStatus = `decrypt-failed: ${e.message}`;
          errors++;
        }
      } else {
        out.locationsXteaStatus = 'missing-key';
        missingKey++;
      }
    } else {
      out.locationsXteaStatus = 'no-file';
    }

    // Aux sub-files 2, 3, 4 — short blobs whose semantics are not documented in
    // the RuneLite source we ported from. Keep them as hex for inspection.
    for (const fid of [2, 3, 4]) {
      const f = parts.get(fid);
      if (f && f.length > 0) out.auxFiles[`file${fid}`] = { bytes: f.length, hex: f.toString('hex') };
    }

    fs.writeFileSync(
      path.join(mapsDir, `${aid}-r${regionX}-${regionY}.json`),
      JSON.stringify(out, null, 2),
    );
    written++;
    archives++;

    const now = Date.now();
    if (now - lastReport > 750) {
      process.stdout.write(`\r    ${archives}/${ids.length} regions, ${decrypted} decrypted, ${missingKey} missing key`);
      lastReport = now;
    }
  }
  process.stdout.write(`\r    ${archives}/${ids.length} regions, ${decrypted} decrypted, ${missingKey} missing key, ${errors} errors\n`);
  return { archives, files: written, errors, decrypted, missingKey };
}

// ─── Section: configs ─────────────────────────────────

function dumpConfigsArchive(cacheDir, outDir, refTable, archiveId, descriptor) {
  const info = refTable.archives.get(archiveId);
  if (!info) {
    console.log(`    archive ${archiveId} (${descriptor.name}): not in reference table`);
    return { archives: 0, files: 0, errors: 0 };
  }
  const raw = readArchiveLive(cacheDir, 2, archiveId);
  if (!raw) return { archives: 0, files: 0, errors: 0 };

  let payload;
  try { ({ data: payload } = decompress(raw)); }
  catch (e) {
    console.error(`    archive ${archiveId} (${descriptor.name}): decompress failed: ${e.message}`);
    return { archives: 1, files: 0, errors: 1 };
  }

  const parts = splitArchive(payload, info.fileIds);
  const entries = [];
  let errors = 0, incomplete = 0, withUnknownOpcodes = 0;

  for (const [fileId, fileData] of parts) {
    if (fileData.length === 0) continue;
    let entry;
    try { entry = descriptor.parser(fileId, fileData); }
    catch (e) {
      entry = { id: fileId, _parseError: e.message };
      errors++;
    }
    if (entry._incomplete) incomplete++;
    if (entry._unknownOpcodes || entry._unknownOpcodesSeen) withUnknownOpcodes++;
    entries.push(entry);
  }

  const configDir = path.join(outDir, 'configs');
  mkdirp(configDir);

  if (descriptor.chunkSize > 0) {
    for (let chunkIdx = 0; chunkIdx * descriptor.chunkSize < entries.length; chunkIdx++) {
      const slice = entries.slice(chunkIdx * descriptor.chunkSize, (chunkIdx + 1) * descriptor.chunkSize);
      fs.writeFileSync(
        path.join(configDir, `${descriptor.name}-${chunkIdx}.json`),
        JSON.stringify(slice, null, 2),
      );
    }
  } else {
    fs.writeFileSync(
      path.join(configDir, `${descriptor.name}.json`),
      JSON.stringify(entries, null, 2),
    );
  }

  const notes = [];
  if (errors) notes.push(`${errors} parse errors`);
  if (incomplete) notes.push(`${incomplete} incomplete (unknown opcode aborted parse)`);
  if (withUnknownOpcodes) notes.push(`${withUnknownOpcodes} entries with unknown opcodes`);
  console.log(`    archive ${archiveId} ${descriptor.name}: ${entries.length} defs${notes.length ? ' — ' + notes.join(', ') : ''}`);

  return { archives: 1, files: entries.length, errors, incomplete, withUnknownOpcodes };
}

function dumpConfigs(cacheDir, outDir) {
  const refTable = loadRefTable(cacheDir, 2);
  if (!refTable) {
    console.log('    no reference table for index 2 — skipping');
    return { archives: 0, files: 0, errors: 0 };
  }

  const totals = { archives: 0, files: 0, errors: 0, incomplete: 0, withUnknownOpcodes: 0 };
  const summary = [];
  for (const [aid, descriptor] of Object.entries(CONFIG_ARCHIVES)) {
    const r = dumpConfigsArchive(cacheDir, outDir, refTable, parseInt(aid), descriptor);
    summary.push({ archiveId: parseInt(aid), name: descriptor.name, ...r });
    totals.archives += r.archives;
    totals.files += r.files;
    totals.errors += r.errors || 0;
    totals.incomplete += r.incomplete || 0;
    totals.withUnknownOpcodes += r.withUnknownOpcodes || 0;
  }
  totals.summary = summary;
  return totals;
}

// ─── Section: world-areas ─────────────────────────────

function dumpWorldAreas(cacheDir, outDir) {
  const refTable = loadRefTable(cacheDir, 19);
  if (!refTable) return { archives: 0, files: 0, errors: 0 };
  const info = refTable.archives.get(0);
  if (!info) return { archives: 0, files: 0, errors: 0 };
  const raw = readArchiveLive(cacheDir, 19, 0);
  if (!raw) return { archives: 0, files: 0, errors: 0 };

  let payload;
  try { ({ data: payload } = decompress(raw)); }
  catch { return { archives: 1, files: 0, errors: 1 }; }

  const parts = splitArchive(payload, info.fileIds);
  const entries = [];
  let errors = 0;
  for (const [fid, fdata] of parts) {
    if (fdata.length === 0) continue;
    try {
      const def = parseWorldArea(fid, fdata);
      if (def.parseError) errors++;
      entries.push(def);
    } catch (e) {
      entries.push({ id: fid, _parseError: e.message });
      errors++;
    }
  }

  const waDir = path.join(outDir, 'world-areas');
  mkdirp(waDir);
  fs.writeFileSync(path.join(waDir, 'world-areas.json'), JSON.stringify(entries, null, 2));
  console.log(`    ${entries.length} world areas (${errors} errors)`);
  return { archives: 1, files: entries.length, errors };
}

// ─── Section: reference-tables ────────────────────────

function dumpReferenceTables(cacheDir, outDir, indices) {
  const refDir = path.join(outDir, 'reference-tables');
  mkdirp(refDir);
  let written = 0;
  for (const indexId of indices) {
    if (indexId === 255) continue;
    const raw = readArchiveLive(cacheDir, 255, indexId);
    if (!raw) continue;
    let table;
    try { table = parseReferenceTable(decompress(raw).data); }
    catch (e) {
      fs.writeFileSync(path.join(refDir, `index-${indexId}.error.txt`), e.message);
      continue;
    }

    const archives = [];
    for (const [aid, info] of table.archives) {
      archives.push({
        archiveId: aid,
        nameHash: info.nameHash,
        crc: info.crc,
        version: info.version,
        fileCount: info.fileIds.length,
        fileIds: info.fileIds,
        fileNameHashes: info.fileNameHashes,
      });
    }
    archives.sort((a, b) => a.archiveId - b.archiveId);

    fs.writeFileSync(
      path.join(refDir, `index-${indexId}.json`),
      JSON.stringify({
        indexId,
        format: table.format,
        version: table.version,
        flags: table.flags,
        archiveCount: archives.length,
        archives,
      }, null, 2),
    );
    written++;
  }
  console.log(`    ${written} reference tables`);
  return { written };
}

// ─── Section: binary (opt-in) ─────────────────────────

function dumpBinary(cacheDir, outDir, indices) {
  const binRoot = path.join(outDir, 'bin');
  mkdirp(binRoot);
  let totalArchives = 0, totalFiles = 0, totalBytes = 0;
  for (const indexId of indices) {
    const refTable = indexId !== 255 ? loadRefTable(cacheDir, indexId) : null;
    const ids = listArchiveIdsLive(cacheDir, indexId);
    if (ids.length === 0) continue;
    const indexDir = path.join(binRoot, `index-${indexId}`);
    mkdirp(indexDir);
    let archives = 0, files = 0, bytes = 0;
    for (const aid of ids) {
      const raw = readArchiveLive(cacheDir, indexId, aid);
      if (!raw) continue;
      let payload;
      try { ({ data: payload } = decompress(raw)); }
      catch { continue; }

      const info = refTable?.archives.get(aid);
      if (info && info.fileIds.length > 1) {
        let parts;
        try { parts = splitArchive(payload, info.fileIds); }
        catch { fs.writeFileSync(path.join(indexDir, `a${aid}.bin`), payload); files++; bytes += payload.length; archives++; continue; }
        const archDir = path.join(indexDir, `a${aid}`);
        mkdirp(archDir);
        for (const [fid, fdata] of parts) {
          fs.writeFileSync(path.join(archDir, `f${fid}.bin`), fdata);
          files++; bytes += fdata.length;
        }
      } else {
        fs.writeFileSync(path.join(indexDir, `a${aid}.bin`), payload);
        files++; bytes += payload.length;
      }
      archives++;
    }
    console.log(`    index ${indexId}: ${archives} archives, ${files} files, ${fmtBytes(bytes)}`);
    totalArchives += archives; totalFiles += files; totalBytes += bytes;
  }
  return { archives: totalArchives, files: totalFiles, bytes: totalBytes };
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cacheDir = path.resolve(args.cacheDir || defaultLiveCachePath());
  const outDir = path.resolve(args.outDir || path.join(__dirname, '..', '..', 'raw_cache'));

  if (!fs.existsSync(cacheDir) || !isLiveCache(cacheDir)) {
    console.error(`Not a live cache: ${cacheDir}`);
    process.exit(1);
  }

  console.log(`Cache:  ${cacheDir}`);
  console.log(`Output: ${outDir}\n`);

  if (fs.existsSync(outDir)) {
    console.log(`Cleaning existing ${outDir}\n`);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  mkdirp(outDir);

  const sections = args.only
    ? [args.only]
    : ['reference-tables', 'maps', 'configs', 'world-areas'];

  const xteaKeys = loadXteaKeys();
  console.log(`XTEA keys loaded: ${xteaKeys.size}\n`);

  const presentIndices = listPresentIndices(cacheDir);
  console.log(`Indices present: ${presentIndices.join(', ')}\n`);

  const t0 = Date.now();
  const results = {};

  for (const section of sections) {
    const t = Date.now();
    console.log(`[${section}]`);
    if (section === 'reference-tables') {
      results[section] = dumpReferenceTables(cacheDir, outDir, presentIndices);
    } else if (section === 'maps') {
      results[section] = dumpMaps(cacheDir, outDir, xteaKeys);
    } else if (section === 'configs') {
      results[section] = dumpConfigs(cacheDir, outDir);
    } else if (section === 'world-areas') {
      results[section] = dumpWorldAreas(cacheDir, outDir);
    } else {
      console.log(`    unknown section "${section}" — skipping`);
      continue;
    }
    console.log(`    done in ${elapsed(t)}\n`);
  }

  if (args.includeBinary) {
    const t = Date.now();
    console.log(`[binary]`);
    results.binary = dumpBinary(cacheDir, outDir, presentIndices);
    console.log(`    done in ${elapsed(t)}\n`);
  }

  const manifest = {
    generatedFrom: cacheDir,
    sectionsDumped: sections.concat(args.includeBinary ? ['binary'] : []),
    xteaKeysAvailable: xteaKeys.size,
    indicesPresent: presentIndices,
    elapsed: elapsed(t0),
    results,
    notes: [
      'Files are decompressed cache containers, then loader-parsed into JSON.',
      'Field names follow RuneLite (cache canonical): overlayId / overlayPath / overlayRotation / settings / underlayId / height for tiles; id / type / orientation / plane / localX / localY for locations.',
      'Map tile.settings is the 5-bit packed flags byte (RuneLite-canonical). settingsBits is a sidecar boolean[5] decomposition for inspection — do NOT speculate on bit semantics here; cross-reference against the engine consumer that interprets them.',
      'Config defs may carry _unknownOpcodes / _incomplete markers — modern OSRS opcodes our loaders do not yet handle. Each marked entry stops at the first unknown opcode, so trailing fields are missing.',
      'Map tile._attrsSeen is the raw attr sequence the parser walked for that tile (helpful for hex-diffing against the binary).',
      'No sentinel resolution beyond what the loaders strictly need; no field renames; no plane regrouping. This is the cache structure 1:1.',
    ],
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`${'─'.repeat(60)}`);
  console.log(`Done in ${elapsed(t0)}.`);
  console.log(`Manifest: ${path.join(outDir, 'manifest.json')}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
