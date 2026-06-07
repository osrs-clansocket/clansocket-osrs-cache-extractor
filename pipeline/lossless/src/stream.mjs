/**
 * Binary reader wrapping a Buffer with a position cursor.
 * All reads are big-endian, matching the RuneScape protocol.
 *
 * Every read that touches buf[pos] directly (rather than via buf.readInt*BE
 * which already throw on OOB) guards with _requireBytes(n) — this prevents
 * silent undefined-return on EOF that masks malformed-input bugs as infinite
 * loops in parsers (see parseLocationData's outer `while(true)` reading until
 * a `0` terminator). Throwing here means parsers' try/catch sees the bug.
 */
export class Stream {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }

  get length() {
    return this.buf.length;
  }

  remaining() {
    return this.buf.length - this.pos;
  }

  skip(n) {
    this.pos += n;
  }

  _requireBytes(n) {
    if (this.pos + n > this.buf.length) {
      throw new Error(`Stream EOF: need ${n} byte(s) at pos ${this.pos}, length=${this.buf.length}`);
    }
  }

  peek() {
    this._requireBytes(1);
    return this.buf[this.pos];
  }

  // --- Byte ---

  readByte() {
    return this.buf.readInt8(this.pos++);
  }

  readUnsignedByte() {
    this._requireBytes(1);
    return this.buf[this.pos++];
  }

  readBytes(len) {
    this._requireBytes(len);
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  readSignedByte() {
    return this.readByte();
  }

  // --- Short (16-bit) ---

  readShort() {
    const v = this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }

  readUnsignedShort() {
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }

  // --- Int (32-bit) ---

  readInt() {
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  readUnsignedInt() {
    const v = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  // --- 24-bit ---

  read24BitInt() {
    this._requireBytes(3);
    return (
      ((this.buf[this.pos++] & 0xFF) << 16) |
      ((this.buf[this.pos++] & 0xFF) << 8) |
      (this.buf[this.pos++] & 0xFF)
    );
  }

  // --- Smart values ---

  readShortSmart() {
    this._requireBytes(1);
    const peek = this.buf[this.pos] & 0xFF;
    if (peek < 128) {
      return this.readUnsignedByte() - 64;
    }
    return this.readUnsignedShort() - 49152;
  }

  readUnsignedShortSmart() {
    this._requireBytes(1);
    const peek = this.buf[this.pos] & 0xFF;
    if (peek < 128) {
      return this.readUnsignedByte();
    }
    return this.readUnsignedShort() - 32768;
  }

  // RuneLite InputStream#readUnsignedShortSmartMinusOne — same smart-byte
  // discrimination as readUnsignedShortSmart but returns value - 1 in the byte
  // path and value - 0x8001 in the short path. Used by NPC opcode 102 head
  // icons where -1 (sentinel) means "no icon at this slot".
  readUnsignedShortSmartMinusOne() {
    this._requireBytes(1);
    const peek = this.buf[this.pos] & 0xFF;
    if (peek < 128) {
      return this.readUnsignedByte() - 1;
    }
    return this.readUnsignedShort() - 0x8001;
  }

  readBigSmart() {
    this._requireBytes(1);
    if (this.buf[this.pos] < 0 || (this.buf[this.pos] & 0xFF) >= 128) {
      return this.readInt() & 0x7FFFFFFF;
    }
    const v = this.readUnsignedShort();
    return v === 32767 ? -1 : v;
  }

  readBigSmart2() {
    this._requireBytes(1);
    if ((this.buf[this.pos] & 0xFF) >= 128) {
      return (this.readInt() & 0x7FFFFFFF);
    }
    const v = this.readUnsignedShort();
    return v === 0xFFFF ? -1 : v;
  }

  /**
   * RuneLite's readUnsignedIntSmartShortCompat —
   * accumulates until a non-max smart value is read.
   */
  readUnsignedIntSmartShortCompat() {
    let total = 0;
    let cur = this.readUnsignedShortSmart();
    while (cur === 32767) {
      total += 32767;
      cur = this.readUnsignedShortSmart();
    }
    return total + cur;
  }

  readVarInt() {
    let value = 0;
    let b;
    do {
      b = this.readUnsignedByte();
      value = (value << 7) | (b & 0x7F);
    } while ((b & 0x80) !== 0);
    return value;
  }

  // --- String ---

  readString() {
    const start = this.pos;
    while (this.pos < this.buf.length && this.buf[this.pos] !== 0) this.pos++;
    if (this.pos >= this.buf.length) {
      throw new Error(`Stream EOF in readString starting at ${start}`);
    }
    const result = this.buf.toString('latin1', start, this.pos);
    this.pos++; // consume NUL
    return result;
  }

  readStringOrNull() {
    this._requireBytes(1);
    if (this.buf[this.pos] === 0) {
      this.pos++;
      return null;
    }
    return this.readString();
  }

  // Version-tagged string (byte 0 before NUL-terminated string)
  readVersionedString() {
    const marker = this.readUnsignedByte();
    if (marker !== 0) {
      throw new Error(`Expected string version marker 0, got ${marker}`);
    }
    return this.readString();
  }

  // --- Utility ---

  readArray(len) {
    const arr = new Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = this.readUnsignedByte();
    }
    return arr;
  }

  readShortArray(len) {
    const arr = new Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = this.readUnsignedShort();
    }
    return arr;
  }

  readIntArray(len) {
    const arr = new Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = this.readInt();
    }
    return arr;
  }
}
