import { Stream } from '../stream.mjs';

/**
 * Streams OSRS location (object placement) data for one region into a sink.
 * Locations are delta-encoded with object ID + position increments; the sink
 * fires once per placed object.
 *
 * Sink signature:
 *   sink(id, type, orientation, plane, localX, localY)
 *
 * Format:
 *   while true:
 *     idDelta = readUnsignedIntSmartShortCompat()
 *     if 0: break
 *     objectId += idDelta
 *     while true:
 *       posDelta = readUnsignedShortSmart()
 *       if 0: break
 *       locPacked += posDelta - 1
 *       localY = locPacked & 0x3F
 *       localX = (locPacked >> 6) & 0x3F
 *       plane  = (locPacked >> 12) & 0x3
 *       attributes = readUnsignedByte()
 *       type = attributes >> 2
 *       orientation = attributes & 0x3
 */
export function parseLocationData(regionX, regionY, data, sink) {
  const s = new Stream(data);
  let objectId = -1;

  // Outer/inner loops bounded on s.pos: OSRS location files use file-end as
  // the implicit terminator (no trailing 0 byte). The try/catch absorbs the
  // case where a smart-short's 2-byte path is requested with only 1 byte
  // remaining — those are still well-formed varint streams that simply ran
  // out at the end. Matches RuneLite RegionLoader's catch-IOException pattern
  // but pushes the recovery into the parser so partial location lists are
  // emitted instead of the whole region being dropped.
  try {
    while (s.pos < s.length) {
      const idDelta = s.readUnsignedIntSmartShortCompat();
      if (idDelta === 0) break;
      objectId += idDelta;

      let locPacked = 0;
      while (s.pos < s.length) {
        const posDelta = s.readUnsignedShortSmart();
        if (posDelta === 0) break;
        locPacked += posDelta - 1;

        const localY = locPacked & 0x3F;
        const localX = (locPacked >> 6) & 0x3F;
        const plane = (locPacked >> 12) & 0x3;
        const attributes = s.readUnsignedByte();
        const type = attributes >> 2;
        const orientation = attributes & 0x3;

        sink(objectId, type, orientation, plane, localX, localY);
      }
    }
  } catch (e) {
    if (!(e instanceof RangeError) && !(e.message && e.message.startsWith('Stream EOF'))) {
      throw e;
    }
  }
}

/**
 * Array-building wrapper for callers that need the full location list.
 * Allocates an array; do NOT use in hot paths processing many regions.
 * Returns { regionX, regionY, locations: [{id, type, orientation, plane, localX, localY}, ...] }
 */
export function collectLocationData(regionX, regionY, data) {
  const locations = [];
  parseLocationData(regionX, regionY, data, (id, type, orientation, plane, localX, localY) => {
    locations.push({ id, type, orientation, plane, localX, localY });
  });
  return { regionX, regionY, locations };
}
