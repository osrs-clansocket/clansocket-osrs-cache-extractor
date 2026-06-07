import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS underlay (floor underlay) definition.
 */
export function parseUnderlayDef(id, data) {
  const s = new Stream(data);
  const def = { id };

  while (s.remaining() > 0) {
    const opcode = s.readUnsignedByte();
    if (opcode === 0) break;

    switch (opcode) {
      case 1: def.color = s.read24BitInt(); break;
      default:
        if (!def._unknownOpcodes) def._unknownOpcodes = [];
        def._unknownOpcodes.push(opcode);
        def._incomplete = true;
        return def;
    }
  }
  return def;
}
