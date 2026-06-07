/**
 * XTEA decryption for encrypted map regions.
 * 32 rounds, golden ratio 0x9E3779B9, 8-byte blocks.
 * Must use 32-bit integer overflow (achieved via |0 and >>>0).
 */

const ROUNDS = 32;
const GOLDEN_RATIO = 0x9E3779B9;

/**
 * Decrypt a Buffer in-place using XTEA with the given 4-int key.
 * Only processes complete 8-byte blocks; trailing bytes are untouched.
 *
 * @param {Buffer} data
 * @param {number[]} key — array of 4 int32 values
 * @returns {Buffer} — same buffer, decrypted in-place
 */
export function xteaDecrypt(data, key) {
  const blockCount = Math.floor(data.length / 8);

  for (let b = 0; b < blockCount; b++) {
    const off = b * 8;
    let v0 = data.readInt32BE(off);
    let v1 = data.readInt32BE(off + 4);

    let sum = (GOLDEN_RATIO * ROUNDS) | 0;

    for (let i = 0; i < ROUNDS; i++) {
      v1 = (v1 - ((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + key[(sum >>> 11) & 3]))) | 0;
      sum = (sum - GOLDEN_RATIO) | 0;
      v0 = (v0 - ((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + key[sum & 3]))) | 0;
    }

    data.writeInt32BE(v0, off);
    data.writeInt32BE(v1, off + 4);
  }

  return data;
}
