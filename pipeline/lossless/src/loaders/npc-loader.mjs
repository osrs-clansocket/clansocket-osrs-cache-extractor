import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS NPC definition from a raw data Buffer.
 *
 * Port of net.runelite.cache.definitions.loaders.NpcLoader + EntityOpsLoader.
 * Strict opcode-by-opcode parity with the canonical RuneLite source — no phantom
 * "unknown N" opcodes guessed without provenance. Unknown opcodes log once + continue
 * (forward-compat), mirroring RuneLite. post(def) sets footprintSize default.
 *
 * Critical fidelity points:
 * - Opcodes 61/62 read 32-bit INT model IDs (newer NPCs with model id > 65535).
 *   Old 1/60 still read 16-bit ushorts for legacy NPCs.
 * - Opcode 102 (head icons) uses per-bit slot check + readUnsignedShortSmartMinusOne
 *   (not popcount + linear read). Wrong indexing breaks multi-icon NPCs.
 * - Opcode 111 has revision-dependent semantic: post-rev233 → renderPriority=2,
 *   pre-rev220 → isFollower+lowPriorityFollowerOps. We default to rev233 behavior
 *   since OSRS 2024+ is post-rev233.
 * - Opcodes 251/252/253 handle EntityOps sub-op / conditional / conditional-sub.
 *   Identical structure to item-loader 200/201/202.
 */
export function parseNpcDef(id, data) {
  const s = new Stream(data);
  const def = { id };

  // EOF-tolerant catch: some npc defs in the live cache truncate mid-
  // opcode-payload. RuneLite handles via caller try/catch; we recover the
  // partial def-so-far instead of losing it entirely.
  try {
    while (s.remaining() > 0) {
      const opcode = s.readUnsignedByte();
      if (opcode === 0) break;
      decodeOpcode(opcode, def, s);
    }
  } catch (e) {
    if (!(e instanceof RangeError) && !(e.message && e.message.startsWith('Stream EOF'))) {
      throw e;
    }
  }

  post(def);
  return def;
}

function decodeOpcode(opcode, def, s) {
  if (opcode === 1) {
    const len = s.readUnsignedByte();
    def.models = new Array(len);
    for (let i = 0; i < len; i++) def.models[i] = s.readUnsignedShort();
  }
  else if (opcode === 2) { def.name = s.readString(); }
  else if (opcode === 12) { def.size = s.readUnsignedByte(); }
  else if (opcode === 13) { def.standingAnimation = s.readUnsignedShort(); }
  else if (opcode === 14) { def.walkingAnimation = s.readUnsignedShort(); }
  else if (opcode === 15) { def.idleRotateLeftAnimation = s.readUnsignedShort(); }
  else if (opcode === 16) { def.idleRotateRightAnimation = s.readUnsignedShort(); }
  else if (opcode === 17) {
    def.walkingAnimation = s.readUnsignedShort();
    def.rotate180Animation = s.readUnsignedShort();
    def.rotateLeftAnimation = s.readUnsignedShort();
    def.rotateRightAnimation = s.readUnsignedShort();
  }
  else if (opcode === 18) { def.category = s.readUnsignedShort(); }
  else if (opcode >= 30 && opcode < 35) {
    const text = s.readString();
    if (text !== 'Hidden') {
      if (!def.ops) def.ops = { ops: new Array(5).fill(null) };
      def.ops.ops[opcode - 30] = text;
    }
  }
  else if (opcode === 40) {
    const len = s.readUnsignedByte();
    def.recolorToFind = new Array(len);
    def.recolorToReplace = new Array(len);
    for (let i = 0; i < len; i++) {
      def.recolorToFind[i] = s.readUnsignedShort();
      def.recolorToReplace[i] = s.readUnsignedShort();
    }
  }
  else if (opcode === 41) {
    const len = s.readUnsignedByte();
    def.retextureToFind = new Array(len);
    def.retextureToReplace = new Array(len);
    for (let i = 0; i < len; i++) {
      def.retextureToFind[i] = s.readUnsignedShort();
      def.retextureToReplace[i] = s.readUnsignedShort();
    }
  }
  else if (opcode === 60) {
    const len = s.readUnsignedByte();
    def.chatheadModels = new Array(len);
    for (let i = 0; i < len; i++) def.chatheadModels[i] = s.readUnsignedShort();
  }
  else if (opcode === 61) {
    const len = s.readUnsignedByte();
    def.models = new Array(len);
    for (let i = 0; i < len; i++) def.models[i] = s.readInt();
  }
  else if (opcode === 62) {
    const len = s.readUnsignedByte();
    def.chatheadModels = new Array(len);
    for (let i = 0; i < len; i++) def.chatheadModels[i] = s.readInt();
  }
  else if (opcode === 74) { (def.stats ||= [0,0,0,0,0,0])[0] = s.readUnsignedShort(); }
  else if (opcode === 75) { (def.stats ||= [0,0,0,0,0,0])[1] = s.readUnsignedShort(); }
  else if (opcode === 76) { (def.stats ||= [0,0,0,0,0,0])[2] = s.readUnsignedShort(); }
  else if (opcode === 77) { (def.stats ||= [0,0,0,0,0,0])[3] = s.readUnsignedShort(); }
  else if (opcode === 78) { (def.stats ||= [0,0,0,0,0,0])[4] = s.readUnsignedShort(); }
  else if (opcode === 79) { (def.stats ||= [0,0,0,0,0,0])[5] = s.readUnsignedShort(); }
  else if (opcode === 93) { def.isMinimapVisible = false; }
  else if (opcode === 95) { def.combatLevel = s.readUnsignedShort(); }
  else if (opcode === 97) { def.widthScale = s.readUnsignedShort(); }
  else if (opcode === 98) { def.heightScale = s.readUnsignedShort(); }
  else if (opcode === 99) { def.renderPriority = 1; }
  else if (opcode === 100) { def.ambient = s.readByte(); }
  else if (opcode === 101) { def.contrast = s.readByte(); }
  else if (opcode === 102) {
    // Per-bit slot-indexed head icons (rev210+ format).
    const bitfield = s.readUnsignedByte();
    let len = 0;
    for (let v = bitfield; v !== 0; v >>= 1) len++;
    def.headIconArchiveIds = new Array(len);
    def.headIconSpriteIndex = new Array(len);
    for (let i = 0; i < len; i++) {
      if ((bitfield & (1 << i)) === 0) {
        def.headIconArchiveIds[i] = -1;
        def.headIconSpriteIndex[i] = -1;
      } else {
        def.headIconArchiveIds[i] = s.readBigSmart2();
        def.headIconSpriteIndex[i] = s.readUnsignedShortSmartMinusOne();
      }
    }
  }
  else if (opcode === 103) { def.rotationSpeed = s.readUnsignedShort(); }
  else if (opcode === 106) {
    def.varbitId = s.readUnsignedShort();
    if (def.varbitId === 65535) def.varbitId = -1;
    def.varpIndex = s.readUnsignedShort();
    if (def.varpIndex === 65535) def.varpIndex = -1;
    const len = s.readUnsignedByte();
    def.configs = new Array(len + 2);
    for (let i = 0; i <= len; i++) {
      const v = s.readUnsignedShort();
      def.configs[i] = v === 65535 ? -1 : v;
    }
    def.configs[len + 1] = -1;
  }
  else if (opcode === 107) { def.isInteractable = false; }
  else if (opcode === 109) { def.rotationFlag = false; }
  else if (opcode === 111) { def.renderPriority = 2; }
  else if (opcode === 114) { def.runAnimation = s.readUnsignedShort(); }
  else if (opcode === 115) {
    def.runAnimation = s.readUnsignedShort();
    def.runRotate180Animation = s.readUnsignedShort();
    def.runRotateLeftAnimation = s.readUnsignedShort();
    def.runRotateRightAnimation = s.readUnsignedShort();
  }
  else if (opcode === 116) { def.crawlAnimation = s.readUnsignedShort(); }
  else if (opcode === 117) {
    def.crawlAnimation = s.readUnsignedShort();
    def.crawlRotate180Animation = s.readUnsignedShort();
    def.crawlRotateLeftAnimation = s.readUnsignedShort();
    def.crawlRotateRightAnimation = s.readUnsignedShort();
  }
  else if (opcode === 118) {
    def.varbitId = s.readUnsignedShort();
    if (def.varbitId === 65535) def.varbitId = -1;
    def.varpIndex = s.readUnsignedShort();
    if (def.varpIndex === 65535) def.varpIndex = -1;
    let varX = s.readUnsignedShort();
    if (varX === 0xFFFF) varX = -1;
    const len = s.readUnsignedByte();
    def.configs = new Array(len + 2);
    for (let i = 0; i <= len; i++) {
      const v = s.readUnsignedShort();
      def.configs[i] = v === 65535 ? -1 : v;
    }
    def.configs[len + 1] = varX;
  }
  else if (opcode === 122) { def.isFollower = true; }
  else if (opcode === 123) { def.lowPriorityFollowerOps = true; }
  else if (opcode === 124) { def.height = s.readUnsignedShort(); }
  else if (opcode === 126) { def.footprintSize = s.readUnsignedShort(); }
  else if (opcode === 129) { def.unknown1 = true; }
  else if (opcode === 130) { def.idleAnimRestart = true; }
  else if (opcode === 145) { def.canHideForOverlap = true; }
  else if (opcode === 146) { def.overlapTintHSL = s.readUnsignedShort(); }
  else if (opcode === 147) { def.zbuf = false; }
  else if (opcode === 249) { def.params = readParams(s); }
  else if (opcode === 251) {
    if (!def.ops) def.ops = {};
    if (!def.ops.subOps) def.ops.subOps = {};
    const index = s.readUnsignedByte();
    const subID = s.readUnsignedByte();
    const text = s.readString();
    if (!def.ops.subOps[index]) def.ops.subOps[index] = {};
    def.ops.subOps[index][subID] = text;
  }
  else if (opcode === 252) {
    if (!def.ops) def.ops = {};
    if (!def.ops.conditionalOps) def.ops.conditionalOps = [];
    const index = s.readUnsignedByte();
    const varp = s.readUnsignedShort();
    const varb = s.readUnsignedShort();
    const min = s.readInt();
    const max = s.readInt();
    const text = s.readString();
    def.ops.conditionalOps.push({ index, varp, varb, min, max, text });
  }
  else if (opcode === 253) {
    if (!def.ops) def.ops = {};
    if (!def.ops.conditionalSubOps) def.ops.conditionalSubOps = [];
    const index = s.readUnsignedByte();
    const subID = s.readUnsignedShort();
    const varp = s.readUnsignedShort();
    const varb = s.readUnsignedShort();
    const min = s.readInt();
    const max = s.readInt();
    const text = s.readString();
    def.ops.conditionalSubOps.push({ index, subID, varp, varb, min, max, text });
  }
  else {
    if (!def._unknownOpcodesSeen) def._unknownOpcodesSeen = new Set();
    def._unknownOpcodesSeen.add(opcode);
    if (!UNKNOWN_OPCODES_WARNED.has(opcode)) {
      UNKNOWN_OPCODES_WARNED.add(opcode);
      console.warn(`[npc-loader] unrecognized opcode ${opcode} (first seen on npc ${def.id}, name=${def.name || '?'}) — continuing per RuneLite forward-compat`);
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
  if (def.footprintSize == null) {
    def.footprintSize = Math.floor(0.4 * (def.size ?? 1) * 128);
  }
}
