import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS texture definition.
 *
 * Dispatches between two coexisting formats based on data length:
 *
 *   data.length === 7  →  rev233 single-fileId STATIC texture
 *      fileId          ushort  — the source sprite
 *      missingColor    ushort  — fallback colour when sprite unavailable
 *      field1778       byte    — boolean toggle
 *      animationDirection byte
 *      animationSpeed     byte
 *
 *   data.length !== 7  →  LEGACY multi-fileId ANIMATED texture
 *      field1777         ushort  — first sprite of the frame chain
 *      field1778         byte    — boolean toggle
 *      count             byte    — number of frame sprites in the chain
 *      fileIds[count]    ushort each
 *      field1780[count-1] byte each (only if count > 1)
 *      field1781[count-1] byte each (only if count > 1)
 *      field1786[count]   int each
 *      animationDirection byte
 *      animationSpeed     byte
 *      total size = 8*count + 4 bytes (for count >= 1)
 *
 * Static textures are walls, terrain tiles, item icons. Animated textures are
 * water surfaces, lava, magic portals, animated walls — they cycle through N
 * frame sprites at `animationSpeed` ticks per frame. Both populate `def.fileIds`
 * as an array so the downstream sprite resolver iterates them uniformly.
 */
export function parseTextureDef(id, data) {
  if (data.length === 7) return parseRev233(id, data);
  return parseLegacy(id, data);
}

function parseRev233(id, data) {
  const s = new Stream(data);
  return {
    id,
    fileIds: [s.readUnsignedShort()],
    missingColor: s.readUnsignedShort(),
    field1778: s.readUnsignedByte() === 1,
    animationDirection: s.readUnsignedByte(),
    animationSpeed: s.readUnsignedByte(),
  };
}

function parseLegacy(id, data) {
  const s = new Stream(data);
  const def = { id };

  def.field1777 = s.readUnsignedShort();
  def.field1778 = s.readUnsignedByte() !== 0;

  const count = s.readUnsignedByte();
  def.fileIds = new Array(count);
  for (let i = 0; i < count; i++) {
    def.fileIds[i] = s.readUnsignedShort();
  }

  if (count > 1) {
    def.field1780 = new Array(count - 1);
    for (let i = 0; i < count - 1; i++) def.field1780[i] = s.readUnsignedByte();

    def.field1781 = new Array(count - 1);
    for (let i = 0; i < count - 1; i++) def.field1781[i] = s.readUnsignedByte();
  }

  def.field1786 = new Array(count);
  for (let i = 0; i < count; i++) def.field1786[i] = s.readInt();

  def.animationDirection = s.readUnsignedByte();
  def.animationSpeed = s.readUnsignedByte();

  return def;
}
