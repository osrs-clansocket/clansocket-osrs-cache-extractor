/**
 * Live OSRS cache reader — reads the native Jagex/RuneLite cache format
 * (main_file_cache.dat2 + main_file_cache.idx<N>) directly, without
 * pre-extraction to per-archive .dat files.
 *
 * Ports net.runelite.cache.fs.jagex.IndexFile + DataFile.read() from the
 * RuneLite cache library. Same sector-walking algorithm, same large-vs-small
 * header branching (archiveId > 0xFFFF picks 10-byte headers).
 *
 * Output is the RAW container bytes — pipeline scripts pipe these through
 * container.mjs::decompress(...) downstream, exactly like they would for
 * per-archive .dat files.
 *
 * Default path: ${HOME}/.runelite/jagexcache/oldschool/LIVE/ — where RuneLite
 * mirrors the Jagex Launcher cache. Updating RuneLite refreshes this folder
 * automatically.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const SECTOR_SIZE = 520;
const INDEX_ENTRY_LEN = 6;

const HANDLE_CACHE = new Map();

export function defaultLiveCachePath() {
  return path.resolve(os.homedir(), '.runelite', 'jagexcache', 'oldschool', 'LIVE');
}

export function isLiveCache(cacheDir) {
  return fs.existsSync(path.join(cacheDir, 'main_file_cache.dat2'));
}

function openHandle(cacheDir) {
  const dat2Path = path.join(cacheDir, 'main_file_cache.dat2');
  if (!fs.existsSync(dat2Path)) return null;

  const dat2Fd = fs.openSync(dat2Path, 'r');
  const dat2Size = fs.statSync(dat2Path).size;
  const indexFds = new Map();

  const prefix = 'main_file_cache.idx';
  for (const f of fs.readdirSync(cacheDir)) {
    if (!f.startsWith(prefix)) continue;
    const suffix = f.slice(prefix.length);
    if (suffix.length === 0) continue;
    let allDigit = true;
    for (let i = 0; i < suffix.length; i++) {
      const c = suffix.charCodeAt(i);
      if (c < 48 || c > 57) { allDigit = false; break; }
    }
    if (!allDigit) continue;
    const idx = Number(suffix);
    indexFds.set(idx, {
      fd: fs.openSync(path.join(cacheDir, f), 'r'),
      size: fs.statSync(path.join(cacheDir, f)).size,
    });
  }

  return { cacheDir, dat2Fd, dat2Size, indexFds };
}

function getHandle(cacheDir) {
  let handle = HANDLE_CACHE.get(cacheDir);
  if (!handle) {
    handle = openHandle(cacheDir);
    if (handle) HANDLE_CACHE.set(cacheDir, handle);
  }
  return handle;
}

function readIndexEntry(handle, indexId, archiveId) {
  const idxInfo = handle.indexFds.get(indexId);
  if (!idxInfo) return null;

  const offset = archiveId * INDEX_ENTRY_LEN;
  if (offset + INDEX_ENTRY_LEN > idxInfo.size) return null;

  const buf = Buffer.alloc(INDEX_ENTRY_LEN);
  const bytesRead = fs.readSync(idxInfo.fd, buf, 0, INDEX_ENTRY_LEN, offset);
  if (bytesRead !== INDEX_ENTRY_LEN) return null;

  const length = (buf[0] << 16) | (buf[1] << 8) | buf[2];
  const sector = (buf[3] << 16) | (buf[4] << 8) | buf[5];
  if (length <= 0 || sector <= 0) return null;
  return { length, sector };
}

export function readArchiveLive(cacheDir, indexId, archiveId) {
  const handle = getHandle(cacheDir);
  if (!handle) return null;

  const entry = readIndexEntry(handle, indexId, archiveId);
  if (!entry) return null;

  const out = Buffer.alloc(entry.length);
  let outPos = 0;
  let sector = entry.sector;
  let part = 0;
  const sectorBuf = Buffer.alloc(SECTOR_SIZE);
  const useLargeHeader = archiveId > 0xFFFF;
  const headerSize = useLargeHeader ? 10 : 8;

  while (outPos < entry.length) {
    if (sector === 0) return null;
    if (sector < 0 || handle.dat2Size / SECTOR_SIZE < sector) return null;

    let dataBlockSize = entry.length - outPos;
    if (dataBlockSize > SECTOR_SIZE - headerSize) {
      dataBlockSize = SECTOR_SIZE - headerSize;
    }

    const want = headerSize + dataBlockSize;
    const got = fs.readSync(handle.dat2Fd, sectorBuf, 0, want, sector * SECTOR_SIZE);
    if (got !== want) return null;

    let currentArchive, currentPart, nextSector, currentIndex;
    if (useLargeHeader) {
      currentArchive = (sectorBuf[0] << 24) | (sectorBuf[1] << 16) | (sectorBuf[2] << 8) | sectorBuf[3];
      currentPart = (sectorBuf[4] << 8) | sectorBuf[5];
      nextSector = (sectorBuf[6] << 16) | (sectorBuf[7] << 8) | sectorBuf[8];
      currentIndex = sectorBuf[9];
    } else {
      currentArchive = (sectorBuf[0] << 8) | sectorBuf[1];
      currentPart = (sectorBuf[2] << 8) | sectorBuf[3];
      nextSector = (sectorBuf[4] << 16) | (sectorBuf[5] << 8) | sectorBuf[6];
      currentIndex = sectorBuf[7];
    }

    if (currentArchive !== archiveId || currentPart !== part || currentIndex !== indexId) {
      return null;
    }

    sectorBuf.copy(out, outPos, headerSize, headerSize + dataBlockSize);
    outPos += dataBlockSize;
    sector = nextSector;
    part++;
  }

  return out;
}

export function listArchiveIdsLive(cacheDir, indexId) {
  const handle = getHandle(cacheDir);
  if (!handle) return [];
  const idxInfo = handle.indexFds.get(indexId);
  if (!idxInfo) return [];

  const count = Math.floor(idxInfo.size / INDEX_ENTRY_LEN);
  const ids = [];
  const buf = Buffer.alloc(INDEX_ENTRY_LEN);
  for (let id = 0; id < count; id++) {
    const got = fs.readSync(idxInfo.fd, buf, 0, INDEX_ENTRY_LEN, id * INDEX_ENTRY_LEN);
    if (got !== INDEX_ENTRY_LEN) continue;
    const length = (buf[0] << 16) | (buf[1] << 8) | buf[2];
    const sector = (buf[3] << 16) | (buf[4] << 8) | buf[5];
    if (length > 0 && sector > 0) ids.push(id);
  }
  return ids;
}

export function closeAllLiveHandles() {
  for (const handle of HANDLE_CACHE.values()) {
    try { fs.closeSync(handle.dat2Fd); } catch {}
    for (const idx of handle.indexFds.values()) {
      try { fs.closeSync(idx.fd); } catch {}
    }
  }
  HANDLE_CACHE.clear();
}
