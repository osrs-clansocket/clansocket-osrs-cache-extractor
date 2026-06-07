/**
 * Splits a decompressed multi-file archive into individual file Buffers.
 *
 * RS2 archive format (when fileCount > 1):
 * - The last byte of the data is the "chunk count"
 * - The data is interleaved in chunks across files
 * - Each chunk has a 4-byte delta-encoded size prefix per file
 *
 * When fileCount === 1, the entire data IS the single file.
 *
 * @param {Buffer} data — decompressed archive data
 * @param {number[]} fileIds — file IDs from the reference table
 * @returns {Map<fileId, Buffer>}
 */
export function splitArchive(data, fileIds) {
  const fileCount = fileIds.length;
  const result = new Map();

  if (fileCount === 1) {
    result.set(fileIds[0], data);
    return result;
  }

  // Read chunk count from the last byte
  const chunks = data[data.length - 1] & 0xFF;

  // The "directory" sits at the end of the data:
  // chunks * fileCount * 4 bytes (int32 sizes) + 1 byte (chunk count)
  const dirSize = chunks * fileCount * 4;
  let dirOffset = data.length - 1 - dirSize;

  // Build size table: sizes[chunk][file]
  const sizes = new Array(chunks);
  const savedDirOffset = dirOffset;
  for (let c = 0; c < chunks; c++) {
    sizes[c] = new Array(fileCount);
    let accum = 0;
    for (let f = 0; f < fileCount; f++) {
      const delta = data.readInt32BE(dirOffset);
      dirOffset += 4;
      accum += delta;
      sizes[c][f] = accum;
    }
  }

  // Calculate total size per file
  const totalSizes = new Array(fileCount).fill(0);
  for (let c = 0; c < chunks; c++) {
    for (let f = 0; f < fileCount; f++) {
      totalSizes[f] += sizes[c][f];
    }
  }

  // Allocate output buffers
  const buffers = new Array(fileCount);
  const writeOffsets = new Array(fileCount).fill(0);
  for (let f = 0; f < fileCount; f++) {
    buffers[f] = Buffer.alloc(totalSizes[f]);
  }

  // Read interleaved chunk data
  let readOffset = 0;
  for (let c = 0; c < chunks; c++) {
    for (let f = 0; f < fileCount; f++) {
      const size = sizes[c][f];
      if (size > 0) {
        data.copy(buffers[f], writeOffsets[f], readOffset, readOffset + size);
        writeOffsets[f] += size;
        readOffset += size;
      }
    }
  }

  for (let f = 0; f < fileCount; f++) {
    result.set(fileIds[f], buffers[f]);
  }

  return result;
}
