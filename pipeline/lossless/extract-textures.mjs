#!/usr/bin/env node

/**
 * Lossless OSRS texture extractor — dumps cache index 9 (texture definitions)
 * + index 8 (sprites) to per-texture PNGs + TextureIndex-0.json manifest.
 *
 * For each texture definition (index 9 archive group 0, one subfile per texture):
 *   - Parse texture def via texture-loader.mjs (gets fileIds array)
 *   - Read first fileId as a sprite group from index 8
 *   - Parse sprite group via sprite-loader.mjs (gets per-frame PNG buffers)
 *   - Write the first frame's PNG to <out>/textures/model/<textureId>.png
 *   - Append to TextureIndex-0.json: { id, width, height, file: "model/<id>.png" }
 *
 * Animated textures cycle through N sprite frames; we only ship the first frame
 * here (matches RuneLite's static texture-baking for cache item icons; animation
 * happens at runtime, irrelevant for offline icon rendering).
 *
 * Usage:
 *   node pipeline/lossless/extract-textures.mjs
 *   node pipeline/lossless/extract-textures.mjs --cache-dir <path>
 *   node pipeline/lossless/extract-textures.mjs --out <path>
 *
 * Output layout:
 *   <out>/textures/TextureIndex-0.json
 *   <out>/textures/model/<textureId>.png
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decompress } from './src/container.mjs';
import { splitArchive } from './src/archive.mjs';
import { parseReferenceTable } from './src/reference-table.mjs';
import { parseTextureDef } from './src/loaders/texture-loader.mjs';
import { parseSpriteGroup } from './src/loaders/sprite-loader.mjs';
import {
  defaultLiveCachePath, isLiveCache,
  readArchiveLive,
} from './src/live-cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEXTURE_INDEX = 9;
const SPRITE_INDEX = 8;
const TEXTURE_ARCHIVE = 0;

function parseArgs(argv) {
  const args = { cacheDir: null, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cache-dir') args.cacheDir = argv[++i];
    else if (a === '--out') args.outDir = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node extract-textures.mjs [--cache-dir <path>] [--out <path>]');
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

function loadSpriteFirstFrame(cacheDir, spriteId) {
  let raw;
  try { raw = readArchiveLive(cacheDir, SPRITE_INDEX, spriteId); }
  catch { return null; }
  if (!raw) return null;

  let payload;
  try { ({ data: payload } = decompress(raw)); }
  catch { return null; }

  let frames;
  try { frames = parseSpriteGroup(spriteId, payload); }
  catch { return null; }
  if (!frames || frames.length === 0) return null;

  const first = frames[0];
  if (!first || !first.png) return null;
  return first;
}

function dumpTextures(cacheDir, outDir) {
  const refTable9 = loadRefTable(cacheDir, TEXTURE_INDEX);
  if (!refTable9) {
    console.error(`    no reference table for index ${TEXTURE_INDEX}`);
    return { textures: 0, sprites: 0, errors: 1 };
  }
  const archiveInfo = refTable9.archives.get(TEXTURE_ARCHIVE);
  if (!archiveInfo) {
    console.error(`    index ${TEXTURE_INDEX} has no archive ${TEXTURE_ARCHIVE}`);
    return { textures: 0, sprites: 0, errors: 1 };
  }

  let payload;
  try {
    const raw = readArchiveLive(cacheDir, TEXTURE_INDEX, TEXTURE_ARCHIVE);
    if (!raw) {
      console.error(`    cannot read index ${TEXTURE_INDEX} archive ${TEXTURE_ARCHIVE}`);
      return { textures: 0, sprites: 0, errors: 1 };
    }
    ({ data: payload } = decompress(raw));
  } catch (e) {
    console.error(`    decompress index ${TEXTURE_INDEX} archive ${TEXTURE_ARCHIVE}: ${e.message}`);
    return { textures: 0, sprites: 0, errors: 1 };
  }

  const parts = splitArchive(payload, archiveInfo.fileIds);

  const texturesDir = path.join(outDir, 'textures');
  const modelDir = path.join(texturesDir, 'model');
  fs.mkdirSync(modelDir, { recursive: true });

  const manifest = [];
  let parsed = 0;
  let spritesWritten = 0;
  let errors = 0;

  for (const [textureId, fileData] of parts) {
    if (fileData.length === 0) continue;

    let def;
    try { def = parseTextureDef(textureId, fileData); }
    catch (e) {
      errors++;
      continue;
    }
    parsed++;

    if (!def.fileIds || def.fileIds.length === 0) continue;

    const spriteId = def.fileIds[0];
    const frame = loadSpriteFirstFrame(cacheDir, spriteId);
    if (!frame) {
      errors++;
      continue;
    }

    const pngPath = path.join(modelDir, `${textureId}.png`);
    fs.writeFileSync(pngPath, frame.png);
    spritesWritten++;

    manifest.push({
      id: String(textureId),
      width: frame.width,
      height: frame.height,
      file: `model/${textureId}.png`,
    });

    if (parsed % 50 === 0) {
      process.stdout.write(`\r    parsed ${parsed} textures, ${spritesWritten} sprites written`);
    }
  }
  process.stdout.write('\n');

  fs.writeFileSync(
      path.join(texturesDir, 'TextureIndex-0.json'),
      JSON.stringify(manifest, null, 2),
  );

  console.log(`    textures: ${parsed} parsed, ${spritesWritten} sprites written, ${errors} errors`);
  console.log(`    manifest → ${path.join(texturesDir, 'TextureIndex-0.json')}`);
  return { textures: parsed, sprites: spritesWritten, errors };
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
  console.log(`Output: ${outDir}\n`);

  fs.mkdirSync(outDir, { recursive: true });

  const t0 = Date.now();
  console.log('[textures]');
  const result = dumpTextures(cacheDir, outDir);
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`    done in ${elapsedSec}s`);

  console.log('\n' + '─'.repeat(60));
  console.log(`Done. Textures: ${result.textures}, sprites: ${result.sprites}, errors: ${result.errors}.`);
}

main();
