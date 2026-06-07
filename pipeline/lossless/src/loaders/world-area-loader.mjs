import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS named world-area definition from the byte stream in
 * index 19 archive 0.
 *
 * Format (Jagex-specific, not in any RuneLite source branch on disk):
 *   internalName    NUL-terminated ASCII   — snake_case identifier
 *   displayName     NUL-terminated ASCII   — UI label
 *   header          opaque bytes           — not fully RE'd; preserved as hex
 *   tail            (regionX, regionY)*    — pairs of big-endian ushorts
 *
 * The header carries flags / count / metadata we haven't decoded yet. The tail
 * is walked from the END of the buffer backward, accepting ushort pairs as
 * region chunk coordinates while their values stay within the valid OSRS
 * chunk-coord range (0–255). Stops at the first pair outside the range — that
 * is the upper bound of the unknown header section.
 *
 * Output shape:
 *   { id, internalName, displayName, regions: [{x,y}], headerHex }
 *
 * Caveats:
 *   - Region list may include duplicate coords (intentional in the cache; some
 *     areas declare the same chunk twice with different plane bounds).
 *   - headerHex retained for downstream forensic work — once the header layout
 *     is decoded, this field gets replaced with named fields.
 */
export function parseWorldArea(id, data) {
  const s = new Stream(data);
  const def = { id };

  try {
    def.internalName = s.readString();
    def.displayName = s.readString();
  } catch (e) {
    return { id, parseError: e.message, raw: Buffer.from(data).toString('hex') };
  }

  const buf = Buffer.from(data);
  const regions = [];
  let tailStart = buf.length;
  while (tailStart >= s.pos + 4) {
    const rx = buf.readUInt16BE(tailStart - 4);
    const ry = buf.readUInt16BE(tailStart - 2);
    if (rx > 255 || ry > 255) break;
    regions.unshift({ x: rx, y: ry });
    tailStart -= 4;
  }
  def.regions = regions;
  def.headerHex = buf.slice(s.pos, tailStart).toString('hex');

  return def;
}
