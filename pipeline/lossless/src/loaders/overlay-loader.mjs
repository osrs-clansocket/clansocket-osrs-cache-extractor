import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS overlay (floor overlay) definition.
 */
export function parseOverlayDef(id, data) {
  const s = new Stream(data);
  const def = { id };

  while (s.remaining() > 0) {
    const opcode = s.readUnsignedByte();
    if (opcode === 0) break;

    switch (opcode) {
      case 1: def.rgbColor = s.read24BitInt(); break;
      case 2: def.texture = s.readUnsignedByte(); break;
      case 5: def.hideUnderlay = false; break;
      case 7: def.secondaryRgbColor = s.read24BitInt(); break;
      case 8: break; // unused
      case 9: def.hue = s.readUnsignedShort(); break;
      case 10: def.saturation = s.readUnsignedByte(); break;
      case 11: def.lightness = s.readUnsignedByte(); break;
      case 12: def.otherHue = s.readUnsignedShort(); break;
      case 13: def.otherSaturation = s.readUnsignedByte(); break;
      case 14: def.otherLightness = s.readUnsignedByte(); break;
      default:
        if (!def._unknownOpcodes) def._unknownOpcodes = [];
        def._unknownOpcodes.push(opcode);
        def._incomplete = true;
        return def;
    }
  }
  return def;
}
