#!/usr/bin/env node

/**
 * Lossless OSRS model extractor — dumps cache index 7 (models) to chunked
 * JSON files preserving raw HSL16 face colors (skipRgb: true).
 *
 * Volume: ~60k models. Output ~1-3 GB across ~30 chunk files at 2000 models/chunk.
 *
 * Usage:
 *   node pipeline/lossless/extract-models.mjs
 *   node pipeline/lossless/extract-models.mjs --cache-dir <path>
 *   node pipeline/lossless/extract-models.mjs --out <path>
 *
 * Output layout:
 *   <out>/models/Models-0.json   (model ids 0-1999)
 *   <out>/models/Models-1.json   (model ids 2000-3999)
 *   ...
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decompress } from './src/container.mjs';
import { parseReferenceTable } from './src/reference-table.mjs';
import { parseModel } from './src/loaders/model-loader.mjs';
import {
  defaultLiveCachePath, isLiveCache,
  readArchiveLive,
} from './src/live-cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODEL_INDEX = 7;
const CHUNK_SIZE = 2000;
const PROGRESS_STEP = 1000;

function parseArgs(argv) {
  const args = { cacheDir: null, outDir: null, noStrip: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cache-dir') args.cacheDir = argv[++i];
    else if (a === '--out') args.outDir = argv[++i];
    else if (a === '--no-strip') args.noStrip = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node extract-models.mjs [--cache-dir <path>] [--out <path>] [--no-strip]');
      console.log('  --no-strip   Skip JSON-time sentinel detection (HSL=0, HSL=255,');
      console.log('               HSL=127+texFace match, ground tiles). Useful for');
      console.log('               diagnosing what would render if we trusted the raw');
      console.log('               cache data verbatim (RuneLite-style no-filter).');
      process.exit(0);
    }
  }
  return args;
}

function loadRefTable(cacheDir, indexId) {
  const raw = readArchiveLive(cacheDir, 255, indexId);
  if (!raw) return null;
  try { return parseReferenceTable(decompress(raw).data); }
  catch { return null; }
}

function dumpModels(cacheDir, outDir, noStrip) {
  const refTable = loadRefTable(cacheDir, MODEL_INDEX);
  if (!refTable) {
    console.error(`    no reference table for index ${MODEL_INDEX}`);
    return { archives: 0, files: 0, errors: 0 };
  }

  const modelDir = path.join(outDir, 'models');
  fs.mkdirSync(modelDir, { recursive: true });

  const archiveIds = [...refTable.archives.keys()].sort((a, b) => a - b);
  console.log(`    ${archiveIds.length} model archives to decode`);

  const chunks = new Map();
  let parsed = 0;
  let errors = 0;

  for (const archiveId of archiveIds) {
    let raw;
    try { raw = readArchiveLive(cacheDir, MODEL_INDEX, archiveId); }
    catch { errors++; continue; }
    if (!raw) { errors++; continue; }

    let payload;
    try { ({ data: payload } = decompress(raw)); }
    catch (e) {
      const entry = { id: archiveId, _decompressError: e.message };
      addToChunk(chunks, archiveId, entry);
      errors++;
      continue;
    }

    let model;
    try { model = parseModel(archiveId, payload, { skipRgb: true, noStrip }); }
    catch (e) {
      model = { id: archiveId, _parseError: e.message };
      errors++;
    }
    addToChunk(chunks, archiveId, model);
    parsed++;

    if (parsed % PROGRESS_STEP === 0) {
      process.stdout.write(`\r    parsed ${parsed}/${archiveIds.length} models`);
    }
  }
  process.stdout.write('\n');

  let chunkCount = 0;
  for (const [chunkIdx, models] of chunks) {
    const file = path.join(modelDir, `Models-${chunkIdx}.json`);
    fs.writeFileSync(file, JSON.stringify(models));
    chunkCount++;
  }

  console.log(`    Models: ${parsed} parsed, ${errors} errors, ${chunkCount} chunks → ${modelDir}`);
  return { archives: archiveIds.length, files: parsed, errors, chunks: chunkCount };
}

function addToChunk(chunks, id, entry) {
  const chunkIdx = Math.floor(id / CHUNK_SIZE);
  if (!chunks.has(chunkIdx)) chunks.set(chunkIdx, []);
  chunks.get(chunkIdx).push(entry);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cacheDir = path.resolve(args.cacheDir || defaultLiveCachePath());
  const outDir = path.resolve(args.outDir || path.join(__dirname, '..', '..', 'extracted_osrs_cache', 'raw'));

  if (!fs.existsSync(cacheDir) || !isLiveCache(cacheDir)) {
    console.error(`Not a live cache: ${cacheDir}`);
    process.exit(1);
  }

  console.log(`Cache:  ${cacheDir}`);
  console.log(`Output: ${outDir}`);
  if (args.noStrip) console.log(`Mode:   --no-strip (raw RuneLite-style, no sentinel filtering)`);
  console.log('');

  fs.mkdirSync(outDir, { recursive: true });

  const t0 = Date.now();
  console.log('[models]');
  const result = dumpModels(cacheDir, outDir, args.noStrip);
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`    done in ${elapsedSec}s`);

  console.log('\n' + '─'.repeat(60));
  console.log(`Done. Models: ${result.files} files, ${result.chunks} chunks, ${result.errors} errors.`);
}

main();
