import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS object (location/loc) definition from a raw data Buffer.
 *
 * Port of net.runelite.cache.definitions.loaders.ObjectLoader + EntityOpsLoader.
 * Strict opcode-by-opcode parity with the canonical RuneLite source — no phantom
 * opcodes guessed without provenance. Unknown opcodes log once + continue (forward-
 * compat). post(def) computes wallOrDoor + supportsItems defaults.
 *
 * Critical fidelity points:
 * - Opcodes 5/7 handle models with NO type byte (ushort/int model id only).
 *   Opcodes 6/7 read 32-bit INT model IDs (newer objects with model id > 65535).
 * - Opcode 70/71/72 read short (signed 16-bit) per RuneLite — our previous code
 *   read these as ushort which lost the sign for negative offsets.
 * - Opcode 78 reads optional ambientSoundRetain byte when rev220SoundData is true
 *   (modern OSRS is post-rev220, so we always read it).
 * - Opcode 89 sets randomizeAnimStart = TRUE (previous code had = false).
 * - Opcode 90 = deferAnimChange (previous code mislabeled as bestSize).
 * - Opcode 91 reads 1 byte (soundDistanceFadeCurve), NOT a 5-byte transform block.
 * - Opcodes 100/101/102 handle EntityOps sub-op / conditional / conditional-sub.
 */
export function parseObjectDef(id, data) {
  const s = new Stream(data);
  const def = { id };

  // EOF-tolerant catch: some object defs in the live cache truncate mid-
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
    if (len > 0) {
      def.modelIds = new Array(len);
      def.modelTypes = new Array(len);
      for (let i = 0; i < len; i++) {
        def.modelIds[i] = s.readUnsignedShort();
        def.modelTypes[i] = s.readUnsignedByte();
      }
    }
  }
  else if (opcode === 2) { def.name = s.readString(); }
  else if (opcode === 5) {
    const len = s.readUnsignedByte();
    if (len > 0) {
      def.modelTypes = null;
      def.modelIds = new Array(len);
      for (let i = 0; i < len; i++) def.modelIds[i] = s.readUnsignedShort();
    }
  }
  else if (opcode === 6) {
    const len = s.readUnsignedByte();
    if (len > 0) {
      def.modelIds = new Array(len);
      def.modelTypes = new Array(len);
      for (let i = 0; i < len; i++) {
        def.modelIds[i] = s.readInt();
        def.modelTypes[i] = s.readUnsignedByte();
      }
    }
  }
  else if (opcode === 7) {
    const len = s.readUnsignedByte();
    if (len > 0) {
      def.modelTypes = null;
      def.modelIds = new Array(len);
      for (let i = 0; i < len; i++) def.modelIds[i] = s.readInt();
    }
  }
  else if (opcode === 14) { def.sizeX = s.readUnsignedByte(); }
  else if (opcode === 15) { def.sizeY = s.readUnsignedByte(); }
  else if (opcode === 17) { def.interactType = 0; def.blocksProjectile = false; }
  else if (opcode === 18) { def.blocksProjectile = false; }
  else if (opcode === 19) { def.wallOrDoor = s.readUnsignedByte(); }
  else if (opcode === 21) { def.contouredGround = 0; }
  else if (opcode === 22) { def.mergeNormals = true; }
  else if (opcode === 23) { def.modelClipped = true; }
  else if (opcode === 24) {
    def.animationID = s.readUnsignedShort();
    if (def.animationID === 0xFFFF) def.animationID = -1;
  }
  else if (opcode === 27) { def.interactType = 1; }
  else if (opcode === 28) { def.decorDisplacement = s.readUnsignedByte(); }
  else if (opcode === 29) { def.ambient = s.readByte(); }
  else if (opcode >= 30 && opcode < 35) {
    const text = s.readString();
    if (text !== 'Hidden') {
      if (!def.ops) def.ops = { ops: new Array(5).fill(null) };
      def.ops.ops[opcode - 30] = text;
    }
  }
  else if (opcode === 39) { def.contrast = s.readByte() * 25; }
  else if (opcode === 40) {
    const len = s.readUnsignedByte();
    def.recolorToFind = new Array(len);
    def.recolorToReplace = new Array(len);
    for (let i = 0; i < len; i++) {
      def.recolorToFind[i] = s.readShort();
      def.recolorToReplace[i] = s.readShort();
    }
  }
  else if (opcode === 41) {
    const len = s.readUnsignedByte();
    def.retextureToFind = new Array(len);
    def.textureToReplace = new Array(len);
    for (let i = 0; i < len; i++) {
      def.retextureToFind[i] = s.readShort();
      def.textureToReplace[i] = s.readShort();
    }
  }
  else if (opcode === 61) { def.category = s.readUnsignedShort(); }
  else if (opcode === 62) { def.isRotated = true; }
  else if (opcode === 64) { def.shadow = false; }
  else if (opcode === 65) { def.modelSizeX = s.readUnsignedShort(); }
  else if (opcode === 66) { def.modelSizeHeight = s.readUnsignedShort(); }
  else if (opcode === 67) { def.modelSizeY = s.readUnsignedShort(); }
  else if (opcode === 68) { def.mapSceneID = s.readUnsignedShort(); }
  else if (opcode === 69) { def.blockingMask = s.readByte(); }
  // Opcodes 70/71/72: signed 16-bit translation offsets per RuneLite ObjectLoader.
  // Reading as unsigned silently turned legitimate negative offsets (e.g. -1 =
  // 0xFFFF) into +65535, lifting 95%+ of offset-bearing objects ~65k units into
  // the air. Verified against modern cache: of ~4000 objects with offsetHeight
  // set, p95 = 65535 unsigned → -1 signed.
  else if (opcode === 70) { def.offsetX = s.readShort(); }
  else if (opcode === 71) { def.offsetHeight = s.readShort(); }
  else if (opcode === 72) { def.offsetY = s.readShort(); }
  else if (opcode === 73) { def.obstructsGround = true; }
  else if (opcode === 74) { def.hollow = true; }
  else if (opcode === 75) { def.supportsItems = s.readUnsignedByte(); }
  else if (opcode === 77) {
    let varbitID = s.readUnsignedShort();
    if (varbitID === 0xFFFF) varbitID = -1;
    def.varbitID = varbitID;
    let varpID = s.readUnsignedShort();
    if (varpID === 0xFFFF) varpID = -1;
    def.varpID = varpID;
    const len = s.readUnsignedByte();
    def.configChangeDest = new Array(len + 2);
    for (let i = 0; i <= len; i++) {
      const v = s.readUnsignedShort();
      def.configChangeDest[i] = v === 0xFFFF ? -1 : v;
    }
    def.configChangeDest[len + 1] = -1;
  }
  else if (opcode === 78) {
    def.ambientSoundId = s.readUnsignedShort();
    def.ambientSoundDistance = s.readUnsignedByte();
    def.ambientSoundRetain = s.readUnsignedByte();
  }
  else if (opcode === 79) {
    def.ambientSoundChangeTicksMin = s.readUnsignedShort();
    def.ambientSoundChangeTicksMax = s.readUnsignedShort();
    def.ambientSoundDistance = s.readUnsignedByte();
    def.ambientSoundRetain = s.readUnsignedByte();
    const len = s.readUnsignedByte();
    def.ambientSoundIds = new Array(len);
    for (let i = 0; i < len; i++) def.ambientSoundIds[i] = s.readUnsignedShort();
  }
  else if (opcode === 81) { def.contouredGround = s.readUnsignedByte() * 256; }
  else if (opcode === 82) { def.mapAreaId = s.readUnsignedShort(); }
  else if (opcode === 89) { def.randomizeAnimStart = true; }
  else if (opcode === 90) { def.deferAnimChange = true; }
  else if (opcode === 91) { def.soundDistanceFadeCurve = s.readUnsignedByte(); }
  else if (opcode === 92) {
    let varbitID = s.readUnsignedShort();
    if (varbitID === 0xFFFF) varbitID = -1;
    def.varbitID = varbitID;
    let varpID = s.readUnsignedShort();
    if (varpID === 0xFFFF) varpID = -1;
    def.varpID = varpID;
    let varX = s.readUnsignedShort();
    if (varX === 0xFFFF) varX = -1;
    const len = s.readUnsignedByte();
    def.configChangeDest = new Array(len + 2);
    for (let i = 0; i <= len; i++) {
      const v = s.readUnsignedShort();
      def.configChangeDest[i] = v === 0xFFFF ? -1 : v;
    }
    def.configChangeDest[len + 1] = varX;
  }
  else if (opcode === 93) {
    def.soundFadeInCurve = s.readUnsignedByte();
    def.soundFadeInDuration = s.readUnsignedShort();
    def.soundFadeOutCurve = s.readUnsignedByte();
    def.soundFadeOutDuration = s.readUnsignedShort();
  }
  else if (opcode === 94) { def.unknown1 = true; }
  else if (opcode === 95) { def.soundVisibility = s.readUnsignedByte(); }
  else if (opcode === 96) { def.raise = s.readUnsignedByte(); }
  else if (opcode === 100) {
    if (!def.ops) def.ops = {};
    if (!def.ops.subOps) def.ops.subOps = {};
    const index = s.readUnsignedByte();
    const subID = s.readUnsignedByte();
    const text = s.readString();
    if (!def.ops.subOps[index]) def.ops.subOps[index] = {};
    def.ops.subOps[index][subID] = text;
  }
  else if (opcode === 101) {
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
  else if (opcode === 102) {
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
  else if (opcode === 249) { def.params = readParams(s); }
  else {
    if (!def._unknownOpcodesSeen) def._unknownOpcodesSeen = new Set();
    def._unknownOpcodesSeen.add(opcode);
    if (!UNKNOWN_OPCODES_WARNED.has(opcode)) {
      UNKNOWN_OPCODES_WARNED.add(opcode);
      console.warn(`[object-loader] unrecognized opcode ${opcode} (first seen on object ${def.id}, name=${def.name || '?'}) — continuing per RuneLite forward-compat`);
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
  if (def.wallOrDoor == null) {
    def.wallOrDoor = 0;
    const hasModels = def.modelIds && def.modelIds.length > 0;
    if (hasModels && (def.modelTypes == null || def.modelTypes[0] === 10)) {
      def.wallOrDoor = 1;
    }
    if (def.ops && def.ops.ops && def.ops.ops.some(o => o != null)) {
      def.wallOrDoor = 1;
    }
  }
  if (def.supportsItems == null) {
    def.supportsItems = (def.interactType != null && def.interactType !== 0) ? 1 : 0;
  }
}
