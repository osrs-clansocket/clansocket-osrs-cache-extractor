import zlib from 'zlib';
import bzip2 from 'seek-bzip';

const COMPRESSION_NONE = 0;
const COMPRESSION_BZIP2 = 1;
const COMPRESSION_GZIP = 2;

/**
 * Decompresses an RS2 container from a raw .dat file Buffer.
 *
 * Container format:
 *   byte  0       — compression type (0=none, 1=BZip2, 2=GZip)
 *   bytes 1-4     — compressed data length (int32 BE)
 *   bytes 5-8     — decompressed length (only present when compressed)
 *   bytes 5/9+    — payload
 *
 * Returns { data: Buffer, compression: number }
 */
export function decompress(buf) {
  const compression = buf[0];
  const compressedLen = buf.readInt32BE(1);

  if (compression === COMPRESSION_NONE) {
    return { data: buf.subarray(5, 5 + compressedLen), compression };
  }

  const decompressedLen = buf.readInt32BE(5);
  const payload = buf.subarray(9, 9 + compressedLen);

  let data;
  if (compression === COMPRESSION_BZIP2) {
    // Jagex strips the 4-byte BZip2 header — prepend "BZh1"
    const header = Buffer.from([0x42, 0x5A, 0x68, 0x31]);
    const full = Buffer.concat([header, payload]);
    data = bzip2.decode(full);
    // seek-bzip returns a Uint8Array; wrap to Buffer
    if (!(data instanceof Buffer)) data = Buffer.from(data);
  } else if (compression === COMPRESSION_GZIP) {
    data = zlib.gunzipSync(payload);
  } else {
    throw new Error(`Unknown compression type: ${compression}`);
  }

  if (data.length !== decompressedLen) {
    throw new Error(
      `Decompressed size mismatch: expected ${decompressedLen}, got ${data.length}`
    );
  }

  return { data, compression };
}
