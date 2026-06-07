import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS identity kit (player appearance) definition.
 */
export function parseKitDef(id, data) {
  const s = new Stream(data);
  const def = { id };

  while (s.remaining() > 0) {
    const opcode = s.readUnsignedByte();
    if (opcode === 0) break;

    switch (opcode) {
      case 1: def.bodyPartId = s.readUnsignedByte(); break;
      case 2: {
        const count = s.readUnsignedByte();
        def.models = [];
        for (let i = 0; i < count; i++) {
          def.models.push(s.readUnsignedShort());
        }
        break;
      }
      case 3: def.nonSelectable = true; break;
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
      case 60: case 61: case 62: case 63: case 64:
      case 65: case 66: case 67: case 68: case 69: {
        if (!def.chatheadModels) def.chatheadModels = {};
        def.chatheadModels[opcode - 60] = s.readUnsignedShort();
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
