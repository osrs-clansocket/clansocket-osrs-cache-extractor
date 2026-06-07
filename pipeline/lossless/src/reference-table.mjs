import { Stream } from './stream.mjs';

/**
 * Parses a reference table (from index 255) that describes the archives
 * and files within a given index.
 *
 * Returns {
 *   format: number,
 *   version: number,
 *   flags: number,
 *   archives: Map<archiveId, {
 *     nameHash: number|null,
 *     crc: number,
 *     version: number,
 *     fileIds: number[],
 *     fileNameHashes: number[]|null
 *   }>
 * }
 */
export function parseReferenceTable(data) {
  const s = new Stream(data);

  const format = s.readUnsignedByte();
  const version = format >= 6 ? s.readInt() : 0;
  const flags = s.readUnsignedByte();

  const hasNames = (flags & 0x01) !== 0;
  const hasWhirlpool = (flags & 0x02) !== 0;
  const hasSizes = (flags & 0x04) !== 0;
  const hasHash = (flags & 0x08) !== 0;

  // Number of archives
  const archiveCount = format >= 7 ? s.readBigSmart() : s.readUnsignedShort();

  // Archive IDs (delta-encoded)
  const archiveIds = new Array(archiveCount);
  let prev = 0;
  for (let i = 0; i < archiveCount; i++) {
    const delta = format >= 7 ? s.readBigSmart() : s.readUnsignedShort();
    prev += delta;
    archiveIds[i] = prev;
  }

  // Name hashes
  const nameHashes = hasNames ? new Array(archiveCount) : null;
  if (hasNames) {
    for (let i = 0; i < archiveCount; i++) {
      nameHashes[i] = s.readInt();
    }
  }

  // CRCs
  const crcs = new Array(archiveCount);
  for (let i = 0; i < archiveCount; i++) {
    crcs[i] = s.readInt();
  }

  // Hashes (SHA-256 or similar)
  if (hasHash) {
    for (let i = 0; i < archiveCount; i++) {
      s.readInt(); // skip
    }
  }

  // Whirlpool digests (64 bytes each)
  if (hasWhirlpool) {
    for (let i = 0; i < archiveCount; i++) {
      s.skip(64);
    }
  }

  // Compressed/decompressed sizes
  if (hasSizes) {
    for (let i = 0; i < archiveCount; i++) {
      s.readInt(); // compressed
      s.readInt(); // decompressed
    }
  }

  // Versions
  const versions = new Array(archiveCount);
  for (let i = 0; i < archiveCount; i++) {
    versions[i] = s.readInt();
  }

  // File counts per archive
  const fileCounts = new Array(archiveCount);
  for (let i = 0; i < archiveCount; i++) {
    fileCounts[i] = format >= 7 ? s.readBigSmart() : s.readUnsignedShort();
  }

  // File IDs per archive (delta-encoded)
  const fileIds = new Array(archiveCount);
  for (let i = 0; i < archiveCount; i++) {
    const count = fileCounts[i];
    const ids = new Array(count);
    let fprev = 0;
    for (let j = 0; j < count; j++) {
      const delta = format >= 7 ? s.readBigSmart() : s.readUnsignedShort();
      fprev += delta;
      ids[j] = fprev;
    }
    fileIds[i] = ids;
  }

  // File name hashes
  const fileNameHashes = new Array(archiveCount);
  if (hasNames) {
    for (let i = 0; i < archiveCount; i++) {
      const count = fileCounts[i];
      const hashes = new Array(count);
      for (let j = 0; j < count; j++) {
        hashes[j] = s.readInt();
      }
      fileNameHashes[i] = hashes;
    }
  }

  // Build result map
  const archives = new Map();
  for (let i = 0; i < archiveCount; i++) {
    archives.set(archiveIds[i], {
      nameHash: hasNames ? nameHashes[i] : null,
      crc: crcs[i],
      version: versions[i],
      fileIds: fileIds[i],
      fileNameHashes: hasNames ? fileNameHashes[i] : null,
    });
  }

  return { format, version, flags, archives };
}
