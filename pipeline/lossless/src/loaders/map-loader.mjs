import { Stream } from '../stream.mjs';

/**
 * Streams OSRS map terrain data for one region. Each region is 4 planes × 64×64
 * tiles. The sink fires once per tile that contains at least one attribute;
 * fully empty tiles are skipped (no allocation, no sink call).
 *
 * Sink signature:
 *   sink(plane, x, y, height, overlay, overlayShape, overlayRotation, flags, underlay)
 *   Any of height/overlay/overlayShape/overlayRotation/flags/underlay may be
 *   undefined when the source bytes did not encode that attribute for the tile.
 *
 * Single-pass format (matches RuneLite MapLoader):
 *   while true:
 *     attr = readUnsignedShort()        (2 bytes)
 *     0:     end tile
 *     1:     height = readUnsignedByte()  (1 byte); end tile
 *     2–49:  overlayId = readShort()      (2 bytes signed)
 *            overlayShape = (attr-2) >> 2
 *            overlayRotation = (attr-2) & 3
 *     50–81: flags = attr - 49
 *     82+:   underlay = attr - 81
 */
export function parseMapData(regionX, regionY, data, sink) {
  const s = new Stream(data);

  for (let plane = 0; plane < 4; plane++) {
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        let height, overlay, overlayShape, overlayRotation, flags, underlay;
        let hasData = false;
        while (true) {
          const attr = s.readUnsignedShort();
          if (attr === 0) break;
          hasData = true;
          if (attr === 1) {
            height = s.readUnsignedByte();
            break;
          }
          if (attr <= 49) {
            overlay = s.readShort();
            overlayShape = (attr - 2) >> 2;
            overlayRotation = (attr - 2) & 3;
          } else if (attr <= 81) {
            flags = attr - 49;
          } else {
            underlay = attr - 81;
          }
        }
        if (hasData) sink(plane, x, y, height, overlay, overlayShape, overlayRotation, flags, underlay);
      }
    }
  }
}

/**
 * Tree-building wrapper for callers that need the full 4×64×64 tile structure
 * (e.g. client-side converters that iterate by [plane][x][y]). Allocates the
 * tree; do NOT use in hot paths processing many regions back-to-back.
 * Returns { regionX, regionY, tiles: [plane][x][y] } where every cell is an
 * object (possibly empty {} for tiles with no attributes).
 */
export function collectMapData(regionX, regionY, data) {
  const tiles = new Array(4);
  for (let p = 0; p < 4; p++) {
    tiles[p] = new Array(64);
    for (let x = 0; x < 64; x++) {
      tiles[p][x] = new Array(64);
      for (let y = 0; y < 64; y++) tiles[p][x][y] = {};
    }
  }

  parseMapData(regionX, regionY, data, (plane, x, y, height, overlay, overlayShape, overlayRotation, flags, underlay) => {
    const tile = tiles[plane][x][y];
    if (height !== undefined) tile.height = height;
    if (overlay !== undefined) {
      tile.overlay = overlay;
      tile.overlayShape = overlayShape;
      tile.overlayRotation = overlayRotation;
    }
    if (flags !== undefined) tile.flags = flags;
    if (underlay !== undefined) tile.underlay = underlay;
  });

  return { regionX, regionY, tiles };
}
