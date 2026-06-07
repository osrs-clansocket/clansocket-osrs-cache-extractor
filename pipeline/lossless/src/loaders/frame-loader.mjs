import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS animation frame archive from index 0.
 *
 * ALL files in the archive are frames. The skeleton/framemap is stored
 * separately in cache index 1, NOT in file 0. Each frame's first 2 bytes
 * contain the framemapId referencing the skeleton.
 *
 * Returns { archiveId, frames: [...] }
 */
export function parseFrameArchive(archiveId, files) {
  const result = { archiveId, frames: [] };

  for (const [fileId, data] of files) {
    if (data.length < 3) {
      result.frames.push({ fileId, rawSize: data.length });
      continue;
    }
    try {
      const frame = parseFrame(fileId, data);
      result.frames.push(frame);
    } catch (e) {
      result.frames.push({ fileId, rawSize: data.length, error: e.message });
    }
  }

  return result;
}

/**
 * Parse a single animation frame using RuneLite's dual-cursor approach.
 *
 * Binary layout:
 *   [framemapId: 2B] [transformCount: 1B] [flags × count] [values...]
 *
 * Flags are packed first, then all values follow sequentially. RuneLite reads
 * flags from one stream pointer and values from another starting at offset
 * 3 + count (past the header + all flag bytes).
 *
 * Transforms with flag <= 0 are skipped (matching RuneLite). Default values
 * (0 vs 128 for scale) are NOT applied here because that requires the skeleton
 * from index 1. Defaults are applied during the conversion step instead.
 */
function parseFrame(fileId, data) {
  // Flag stream: reads framemapId + count + per-transform flag bytes
  const flagStream = new Stream(data);
  const framemapId = flagStream.readUnsignedShort();
  const transformCount = flagStream.readUnsignedByte();

  // Value stream: starts after all flag bytes (offset = 3 + transformCount)
  const valueStream = new Stream(data);
  valueStream.skip(3 + transformCount);

  const transforms = [];

  for (let i = 0; i < transformCount; i++) {
    const flag = flagStream.readUnsignedByte();

    // Match RuneLite: skip transforms with zero flags (no data for this bone)
    if (flag <= 0) {
      continue;
    }

    let dx = 0;
    let dy = 0;
    let dz = 0;

    if ((flag & 0x01) !== 0) {
      dx = valueStream.readShortSmart();
    }
    if ((flag & 0x02) !== 0) {
      dy = valueStream.readShortSmart();
    }
    if ((flag & 0x04) !== 0) {
      dz = valueStream.readShortSmart();
    }

    transforms.push({ index: i, flags: flag, dx, dy, dz });
  }

  return {
    fileId,
    framemapId,
    transformCount,
    transforms,
  };
}
