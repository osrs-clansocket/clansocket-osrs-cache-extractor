import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS spot animation (graphic) definition.
 */
export function parseGraphicEffectDef(id, data) {
  const s = new Stream(data);
  const def = { id };

  while (s.remaining() > 0) {
    const opcode = s.readUnsignedByte();
    if (opcode === 0) break;

    switch (opcode) {
      // Opcode 1: legacy 16-bit modelId. Pre-rev220 caches still use this. Kept
      // for backwards compatibility — modern OSRS no longer emits it but old
      // dumps may.
      case 1: def.modelId = s.readUnsignedShort(); break;
      case 2: {
        def.animationId = s.readUnsignedShort();
        if (def.animationId === 65535) def.animationId = -1;
        break;
      }
      // Opcode 3: modern OSRS 32-bit modelId. Replaced opcode 1 in some cache
      // revision; payload is a 4-byte int storing the model id. Earlier versions
      // of this loader read 2 ushorts here (unknown3_a always 0, unknown3_b
      // carrying the lower 16 bits of the int), which was the same 4 bytes
      // viewed wrong and silently dropped the model id into a field nothing
      // downstream reads. Verified against modern OSRS cache where 2000+
      // spotanims hit this opcode and produce valid model ids in the 2-50k
      // range when decoded as int32.
      case 3: def.modelId = s.readInt(); break;
      case 4: def.widthScale = s.readUnsignedShort(); break;
      case 5: def.heightScale = s.readUnsignedShort(); break;
      case 6: def.orientation = s.readUnsignedShort(); break;
      case 7: def.ambient = s.readUnsignedByte(); break;
      case 8: def.contrast = s.readUnsignedByte(); break;
      case 40: {
        const count = s.readUnsignedByte();
        def.colorFind = [];
        def.colorReplace = [];
        for (let i = 0; i < count; i++) {
          def.colorFind.push(s.readUnsignedShort());
          def.colorReplace.push(s.readUnsignedShort());
        }
        break;
      }
      case 41: {
        const count = s.readUnsignedByte();
        def.textureFind = [];
        def.textureReplace = [];
        for (let i = 0; i < count; i++) {
          def.textureFind.push(s.readUnsignedShort());
          def.textureReplace.push(s.readUnsignedShort());
        }
        break;
      }
      default:
        if (!def._unknownOpcodes) def._unknownOpcodes = [];
        def._unknownOpcodes.push(opcode);
        def._incomplete = true;
        return def;
    }
  }
  return def;
}
