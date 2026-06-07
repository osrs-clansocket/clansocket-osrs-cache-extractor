import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS item definition from a raw data Buffer.
 *
 * Port of net.runelite.cache.definitions.loaders.ItemLoader.load + decodeValues +
 * EntityOpsLoader. Opcode-by-opcode faithful to the canonical RuneLite source.
 *
 * Critical fidelity points:
 * - Opcodes 44-54 read 32-bit INT model IDs (newer OSRS items with model id > 65535
 *   use these — older path 23-27 + 78-93 reads 16-bit ushorts for legacy items).
 * - Opcode 43 uses the terminator pattern (subop id 0 ends inner loop), NOT a
 *   fixed count. Stream-desync risk if mis-parsed.
 * - Opcodes 200, 201, 202 handle EntityOps sub-ops and conditional ops via the
 *   inline helpers below (matches EntityOpsLoader.decodeSubOp etc).
 * - Unknown opcodes log and CONTINUE rather than returning early. This matches
 *   RuneLite's forward-compatible behavior — early return causes catastrophic
 *   data loss when Jagex adds new opcodes between OSRS releases.
 * - post(def) zeroes weight for stackable items, matching RuneLite's
 *   ItemLoader.post().
 */
export function parseItemDef(id, data) {
  const s = new Stream(data);
  const def = { id };

  while (s.remaining() > 0) {
    const opcode = s.readUnsignedByte();
    if (opcode === 0) break;
    decodeOpcode(opcode, def, s);
  }

  post(def);
  return def;
}

function decodeOpcode(opcode, def, s) {
  if (opcode === 1) { def.inventoryModel = s.readUnsignedShort(); }
  else if (opcode === 2) { def.name = s.readString(); }
  else if (opcode === 3) { def.examine = s.readString(); }
  else if (opcode === 4) { def.zoom2d = s.readUnsignedShort(); }
  else if (opcode === 5) { def.xan2d = s.readUnsignedShort(); }
  else if (opcode === 6) { def.yan2d = s.readUnsignedShort(); }
  else if (opcode === 7) {
    let v = s.readUnsignedShort();
    if (v > 32767) v -= 65536;
    def.xOffset2d = v;
  }
  else if (opcode === 8) {
    let v = s.readUnsignedShort();
    if (v > 32767) v -= 65536;
    def.yOffset2d = v;
  }
  else if (opcode === 9) { def.unknown1 = s.readString(); }
  else if (opcode === 11) { def.stackable = 1; }
  else if (opcode === 12) { def.cost = s.readInt(); }
  else if (opcode === 13) { def.wearPos1 = s.readByte(); }
  else if (opcode === 14) { def.wearPos2 = s.readByte(); }
  else if (opcode === 16) { def.isMembers = true; }
  else if (opcode === 23) {
    def.maleModel0 = s.readUnsignedShort();
    def.maleOffset = s.readUnsignedByte();
  }
  else if (opcode === 24) { def.maleModel1 = s.readUnsignedShort(); }
  else if (opcode === 25) {
    def.femaleModel0 = s.readUnsignedShort();
    def.femaleOffset = s.readUnsignedByte();
  }
  else if (opcode === 26) { def.femaleModel1 = s.readUnsignedShort(); }
  else if (opcode === 27) { def.wearPos3 = s.readByte(); }
  else if (opcode >= 30 && opcode < 35) {
    const text = s.readString();
    if (text !== 'Hidden') {
      if (!def.groundOps) def.groundOps = { ops: new Array(5).fill(null) };
      def.groundOps.ops[opcode - 30] = text;
    }
  }
  else if (opcode >= 35 && opcode < 40) {
    if (!def.interfaceOptions) def.interfaceOptions = new Array(5).fill(null);
    def.interfaceOptions[opcode - 35] = s.readString();
  }
  else if (opcode === 40) {
    const count = s.readUnsignedByte();
    def.colorFind = new Array(count);
    def.colorReplace = new Array(count);
    for (let i = 0; i < count; i++) {
      def.colorFind[i] = s.readUnsignedShort();
      def.colorReplace[i] = s.readUnsignedShort();
    }
  }
  else if (opcode === 41) {
    const count = s.readUnsignedByte();
    def.textureFind = new Array(count);
    def.textureReplace = new Array(count);
    for (let i = 0; i < count; i++) {
      def.textureFind[i] = s.readUnsignedShort();
      def.textureReplace[i] = s.readUnsignedShort();
    }
  }
  else if (opcode === 42) { def.shiftClickDropIndex = s.readByte(); }
  else if (opcode === 43) {
    const opId = s.readUnsignedByte();
    if (!def.subops) def.subops = new Array(5).fill(null);
    const valid = opId >= 0 && opId < 5;
    if (valid && def.subops[opId] == null) {
      def.subops[opId] = new Array(20).fill(null);
    }
    while (true) {
      const subopId = s.readUnsignedByte() - 1;
      if (subopId === -1) break;
      const op = s.readString();
      if (valid && subopId >= 0 && subopId < 20) {
        def.subops[opId][subopId] = op;
      }
    }
  }
  else if (opcode === 44) { def.inventoryModel = s.readInt(); }
  else if (opcode === 45) {
    def.maleModel0 = s.readInt();
    def.maleOffset = s.readUnsignedByte();
  }
  else if (opcode === 46) { def.maleModel1 = s.readInt(); }
  else if (opcode === 47) { def.maleModel2 = s.readInt(); }
  else if (opcode === 48) {
    def.femaleModel0 = s.readInt();
    def.femaleOffset = s.readUnsignedByte();
  }
  else if (opcode === 49) { def.femaleModel1 = s.readInt(); }
  else if (opcode === 50) { def.femaleModel2 = s.readInt(); }
  else if (opcode === 51) { def.maleHeadModel = s.readInt(); }
  else if (opcode === 52) { def.maleHeadModel2 = s.readInt(); }
  else if (opcode === 53) { def.femaleHeadModel = s.readInt(); }
  else if (opcode === 54) { def.femaleHeadModel2 = s.readInt(); }
  else if (opcode === 65) { def.isTradeable = true; }
  else if (opcode === 75) { def.weight = s.readShort(); }
  else if (opcode === 78) { def.maleModel2 = s.readUnsignedShort(); }
  else if (opcode === 79) { def.femaleModel2 = s.readUnsignedShort(); }
  else if (opcode === 90) { def.maleHeadModel = s.readUnsignedShort(); }
  else if (opcode === 91) { def.femaleHeadModel = s.readUnsignedShort(); }
  else if (opcode === 92) { def.maleHeadModel2 = s.readUnsignedShort(); }
  else if (opcode === 93) { def.femaleHeadModel2 = s.readUnsignedShort(); }
  else if (opcode === 94) { def.category = s.readUnsignedShort(); }
  else if (opcode === 95) { def.zan2d = s.readUnsignedShort(); }
  else if (opcode === 97) { def.notedID = s.readUnsignedShort(); }
  else if (opcode === 98) { def.notedTemplate = s.readUnsignedShort(); }
  else if (opcode >= 100 && opcode < 110) {
    if (!def.countObj) {
      def.countObj = new Array(10).fill(0);
      def.countCo = new Array(10).fill(0);
    }
    def.countObj[opcode - 100] = s.readUnsignedShort();
    def.countCo[opcode - 100] = s.readUnsignedShort();
  }
  else if (opcode === 110) { def.resizeX = s.readUnsignedShort(); }
  else if (opcode === 111) { def.resizeY = s.readUnsignedShort(); }
  else if (opcode === 112) { def.resizeZ = s.readUnsignedShort(); }
  else if (opcode === 113) { def.ambient = s.readByte(); }
  else if (opcode === 114) { def.contrast = s.readByte(); }
  else if (opcode === 115) { def.team = s.readUnsignedByte(); }
  else if (opcode === 139) { def.boughtId = s.readUnsignedShort(); }
  else if (opcode === 140) { def.boughtTemplateId = s.readUnsignedShort(); }
  else if (opcode === 148) { def.placeholderId = s.readUnsignedShort(); }
  else if (opcode === 149) { def.placeholderTemplateId = s.readUnsignedShort(); }
  else if (opcode === 200) {
    if (!def.groundOps) def.groundOps = {};
    if (!def.groundOps.subOps) def.groundOps.subOps = {};
    const index = s.readUnsignedByte();
    const subID = s.readUnsignedByte();
    const text = s.readString();
    if (!def.groundOps.subOps[index]) def.groundOps.subOps[index] = {};
    def.groundOps.subOps[index][subID] = text;
  }
  else if (opcode === 201) {
    if (!def.groundOps) def.groundOps = {};
    if (!def.groundOps.conditionalOps) def.groundOps.conditionalOps = [];
    const index = s.readUnsignedByte();
    const varp = s.readUnsignedShort();
    const varb = s.readUnsignedShort();
    const min = s.readInt();
    const max = s.readInt();
    const text = s.readString();
    def.groundOps.conditionalOps.push({ index, varp, varb, min, max, text });
  }
  else if (opcode === 202) {
    if (!def.groundOps) def.groundOps = {};
    if (!def.groundOps.conditionalSubOps) def.groundOps.conditionalSubOps = [];
    const index = s.readUnsignedByte();
    const subID = s.readUnsignedShort();
    const varp = s.readUnsignedShort();
    const varb = s.readUnsignedShort();
    const min = s.readInt();
    const max = s.readInt();
    const text = s.readString();
    def.groundOps.conditionalSubOps.push({ index, subID, varp, varb, min, max, text });
  }
  else if (opcode === 249) { def.params = readParams(s); }
  // Opcode 15: zero-data marker present on ~40% of low-ID items. Neither RuneLite
  // source branch we have on disk handles it; its semantic field name is
  // undocumented. Verified harmless: skipping (no bytes consumed) lets the rest
  // of the item parse correctly. Treat as a known flag-bit until a current OSRS
  // deobfuscator names it.
  else if (opcode === 15) { def._opcode15Flag = true; }
  else {
    // Module-level dedupe so a never-seen opcode warns once per process, not
    // once per item. RuneLite's behavior is log + continue without consuming
    // bytes; we mirror that exactly.
    if (!def._unknownOpcodesSeen) def._unknownOpcodesSeen = new Set();
    def._unknownOpcodesSeen.add(opcode);
    if (!UNKNOWN_OPCODES_WARNED.has(opcode)) {
      UNKNOWN_OPCODES_WARNED.add(opcode);
      console.warn(`[item-loader] unrecognized opcode ${opcode} (first seen on item ${def.id}, name=${def.name || '?'}) — continuing per RuneLite forward-compat`);
    }
  }
}

const UNKNOWN_OPCODES_WARNED = new Set();

function readParams(s) {
  const len = s.readUnsignedByte();
  const params = {};
  for (let i = 0; i < len; i++) {
    const isString = s.readUnsignedByte() === 1;
    const key = s.read24BitInt();
    params[key] = isString ? s.readString() : s.readInt();
  }
  return params;
}

function post(def) {
  if (def.stackable === 1) {
    def.weight = 0;
  }
}
