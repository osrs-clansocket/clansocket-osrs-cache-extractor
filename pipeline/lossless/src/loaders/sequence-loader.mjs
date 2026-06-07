import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS sequence (animation) definition.
 * Matches RuneLite's SequenceDefinition (rev 224+).
 */
export function parseSequenceDef(id, data) {
  const s = new Stream(data);
  const def = { id };
  let inSkeletalEvents = false;

  while (s.remaining() > 0) {
    // After opcode 14 (skeletalId), records enter "skeletal event mode" where
    // each event is a fixed 7-byte payload. Continue until terminator 0.
    if (inSkeletalEvents) {
      const eventOp = s.readUnsignedByte();
      if (eventOp === 0) break;
      if (s.remaining() < 7) {
        // Not enough bytes for a full event — stop cleanly without truncation flag.
        break;
      }
      if (!def.skeletalEvents) def.skeletalEvents = [];
      def.skeletalEvents.push({
        op: eventOp,
        a: s.readUnsignedByte(),
        b: s.readUnsignedShort(),
        c: s.readUnsignedInt(),
      });
      continue;
    }
    const opcode = s.readUnsignedByte();
    if (opcode === 0) break;

    if (s.remaining() < minBytes(opcode)) {
      def._truncated = true;
      return def;
    }

    switch (opcode) {
      case 1: {
        const count = s.readUnsignedShort();
        if (s.remaining() < count * 6) { def._truncated = true; return def; }
        def.frameDurations = [];
        def.frameIDs = [];
        for (let i = 0; i < count; i++) {
          def.frameDurations.push(s.readUnsignedShort());
        }
        for (let i = 0; i < count; i++) {
          def.frameIDs.push(s.readUnsignedShort());
        }
        for (let i = 0; i < count; i++) {
          def.frameIDs[i] += s.readUnsignedShort() << 16;
        }
        break;
      }
      case 2: def.frameStep = s.readUnsignedShort(); break;
      case 3: {
        const count = s.readUnsignedByte();
        if (s.remaining() < count) { def._truncated = true; return def; }
        def.interleaveLeave = [];
        for (let i = 0; i < count; i++) {
          def.interleaveLeave.push(s.readUnsignedByte());
        }
        break;
      }
      case 4: def.stretches = true; break;
      case 5: def.forcedPriority = s.readUnsignedByte(); break;
      case 6: def.leftHandItem = s.readUnsignedShort(); break;
      case 7: def.rightHandItem = s.readUnsignedShort(); break;
      case 8: def.maxLoops = s.readUnsignedByte(); break;
      case 9: def.precedenceAnimating = s.readUnsignedByte(); break;
      case 10: def.priority = s.readUnsignedByte(); break;
      case 11: def.replyMode = s.readUnsignedByte(); break;
      case 12: {
        const count = s.readUnsignedByte();
        if (s.remaining() < count * 4) { def._truncated = true; return def; }
        def.chatFrameIds = [];
        for (let i = 0; i < count; i++) {
          def.chatFrameIds.push(s.readUnsignedShort());
        }
        for (let i = 0; i < count; i++) {
          def.chatFrameIds[i] += s.readUnsignedShort() << 16;
        }
        break;
      }
      case 13: {
        const count = s.readUnsignedByte();
        if (s.remaining() < count * 4) { def._truncated = true; return def; }
        def.soundEffects = [];
        for (let i = 0; i < count; i++) {
          def.soundEffects.push(readSoundEffect(s));
        }
        break;
      }
      case 14: {
        def.skeletalId = s.readInt();
        inSkeletalEvents = true;
        break;
      }
      case 15: {
        const startPos = s.pos;
        const count = s.readUnsignedShort();
        if (count > 256 || s.remaining() < count * 6) {
          // Misread count — treat as 7-byte event instead
          s.pos = startPos;
          if (s.remaining() < 7) { def._truncated = true; return def; }
          if (!def.skeletalEvents) def.skeletalEvents = [];
          def.skeletalEvents.push({ op: 15, a: s.readUnsignedByte(), b: s.readUnsignedShort(), c: s.readUnsignedInt() });
          inSkeletalEvents = true;
          break;
        }
        def.skeletalSounds = {};
        for (let i = 0; i < count; i++) {
          const frame = s.readUnsignedShort();
          def.skeletalSounds[frame] = readSoundEffect(s);
        }
        break;
      }
      case 16: def.unknown16 = s.readUnsignedByte(); break;
      case 17: {
        const count = s.readUnsignedByte();
        if (s.remaining() < count) { def._truncated = true; return def; }
        def.skeletalMasks = [];
        for (let i = 0; i < count; i++) {
          def.skeletalMasks.push(s.readUnsignedByte());
        }
        break;
      }
      case 18: case 19: case 20: {
        const startPos = s.pos;
        const count = s.readUnsignedShort();
        if (count > 256 || s.remaining() < count * 6) {
          s.pos = startPos;
          if (s.remaining() < 7) { def._truncated = true; return def; }
          if (!def.skeletalEvents) def.skeletalEvents = [];
          def.skeletalEvents.push({ op: opcode, a: s.readUnsignedByte(), b: s.readUnsignedShort(), c: s.readUnsignedInt() });
          inSkeletalEvents = true;
          break;
        }
        const fieldName = opcode === 18 ? 'soundEffectsV2' : opcode === 19 ? 'skeletalSoundsV2' : 'skeletalSoundsV3';
        def[fieldName] = {};
        for (let i = 0; i < count; i++) {
          const frame = s.readUnsignedShort();
          def[fieldName][frame] = readSoundEffect(s);
        }
        break;
      }
      case 21:
        def.unknown21a = s.readUnsignedShort();
        def.unknown21b = s.readUnsignedShort();
        break;
      case 22: def.unknown22 = s.readUnsignedShort(); break;
      case 23: def.unknown23 = s.readUnsignedShort(); break;
      case 24: def.unknown24 = s.readUnsignedShort(); break;
      case 25: {
        // NEW Leagues format: 7-byte payload (skeletal frame event)
        if (s.remaining() < 7) { def._truncated = true; return def; }
        if (!def.unknownLeagues) def.unknownLeagues = {};
        if (!def.unknownLeagues[25]) def.unknownLeagues[25] = [];
        def.unknownLeagues[25].push({
          a: s.readUnsignedByte(),
          b: s.readUnsignedShort(),
          c: s.readUnsignedInt(),
        });
        inSkeletalEvents = true;
        break;
      }
      case 26: def.unknown26 = s.readUnsignedShort(); break;
      case 27: def.unknown27 = s.readUnsignedByte(); break;
      case 28: def.unknown28 = s.readUnsignedByte(); break;
      case 29: def.unknown29 = s.readUnsignedByte(); break;
      case 34: def.unknown34 = s.readUnsignedByte(); break;
      case 35: def.unknown35 = s.readUnsignedByte(); break;
      case 36: def.unknown36 = s.readUnsignedShort(); break;
      case 37: def.unknown37 = s.readUnsignedByte(); break;
      case 38: case 39: {
        const startPos = s.pos;
        const count = s.readUnsignedShort();
        if (count > 256 || s.remaining() < count * 6) {
          s.pos = startPos;
          if (s.remaining() < 7) { def._truncated = true; return def; }
          if (!def.skeletalEvents) def.skeletalEvents = [];
          def.skeletalEvents.push({ op: opcode, a: s.readUnsignedByte(), b: s.readUnsignedShort(), c: s.readUnsignedInt() });
          inSkeletalEvents = true;
          break;
        }
        const fieldName = opcode === 38 ? 'unknown38' : 'unknown39';
        def[fieldName] = {};
        for (let i = 0; i < count; i++) {
          const frame = s.readUnsignedShort();
          def[fieldName][frame] = readSoundEffect(s);
        }
        break;
      }
      case 100: {
        if (s.remaining() < 4) { def._truncated = true; return def; }
        def.unknown100 = s.readUnsignedInt();
        break;
      }
      // ─── New Leagues opcodes (7-byte payload each) ───
      case 30: case 31: case 32: case 33:
      case 40: case 41: case 42: case 43: case 44: {
        if (s.remaining() < 7) { def._truncated = true; return def; }
        const a = s.readUnsignedByte();
        const b = s.readUnsignedShort();
        const c = s.readUnsignedInt();
        if (!def.unknownLeagues) def.unknownLeagues = {};
        def.unknownLeagues[opcode] = { a, b, c };
        inSkeletalEvents = true;
        break;
      }
      default:
        // Unknown opcode — likely a NEW Leagues skeletal/animation event.
        // The new format uses 7-byte payload events. Try to consume one and continue.
        if (s.remaining() >= 7) {
          if (!def.skeletalEvents) def.skeletalEvents = [];
          def.skeletalEvents.push({
            op: opcode,
            a: s.readUnsignedByte(),
            b: s.readUnsignedShort(),
            c: s.readUnsignedInt(),
          });
          inSkeletalEvents = true;
          break;
        }
        if (!def._unknownOpcodes) def._unknownOpcodes = [];
        def._unknownOpcodes.push(opcode);
        def._incomplete = true;
        return def;
    }
  }
  return def;
}

/** Minimum bytes needed after reading the opcode byte */
function minBytes(opcode) {
  switch (opcode) {
    case 1: case 12: case 13: case 15: case 18: case 19: case 20:
    case 38: case 39: case 100: return 2;
    case 2: case 6: case 7: case 22: case 23: case 24: case 26:
    case 36: return 2;
    case 3: case 17: return 1;
    case 14: return 4;
    case 16: return 1;
    case 21: return 4;
    case 4: return 0;
    case 5: case 8: case 9: case 10: case 11: case 25: case 27:
    case 28: case 29: case 34: case 35: case 37: return 1;
    default: return 0;
  }
}

function readSoundEffect(s) {
  // NEW Leagues format: 4 bytes (dropped retain field)
  const id = s.readUnsignedShort();
  const loops = s.readUnsignedByte();
  const location = s.readUnsignedByte();
  return { id: id === 65535 ? -1 : id, loops, location };
}
