import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS varbit definition.
 * Archive 14 in index 2. Matches RuneLite's VarbitDefinition.
 */
export function parseVarbitDef(id, data) {
  const s = new Stream(data);
  const def = { id };

  while (s.remaining() > 0) {
    const opcode = s.readUnsignedByte();
    if (opcode === 0) break;

    switch (opcode) {
      case 1:
        def.index = s.readUnsignedShort();
        def.leastSignificantBit = s.readUnsignedByte();
        def.mostSignificantBit = s.readUnsignedByte();
        break;
      default:
        if (!def._unknownOpcodes) def._unknownOpcodes = [];
        def._unknownOpcodes.push(opcode);
        def._incomplete = true;
        return def;
    }
  }
  return def;
}
