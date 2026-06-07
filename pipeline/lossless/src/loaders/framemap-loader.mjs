import { Stream } from '../stream.mjs';

/**
 * Parses an OSRS framemap (animation skeleton) definition.
 * Used by animation frames to know which bones/transforms to modify.
 *
 * RS2 Skeleton format (all fields are unsigned bytes):
 *   count (1 byte)
 *   types[count] (1 byte each) — transform type per bone
 *   labelCounts[count] (1 byte each) — number of labels per bone
 *   labels[count][labelCounts[i]] (1 byte each) — label indices
 */
export function parseFramemap(id, data) {
  const s = new Stream(data);

  if (s.remaining() < 1) {
    return { id, transformCount: 0, types: [], labels: [] };
  }

  const count = s.readUnsignedByte();

  if (count === 0 || s.remaining() < count) {
    return { id, transformCount: count, types: [], labels: [] };
  }

  // Read transform types (1 byte each)
  const types = new Array(count);
  for (let i = 0; i < count; i++) {
    types[i] = s.remaining() > 0 ? s.readUnsignedByte() : 0;
  }

  // Read label counts (1 byte each)
  const labelCounts = new Array(count);
  for (let i = 0; i < count; i++) {
    labelCounts[i] = s.remaining() > 0 ? s.readUnsignedByte() : 0;
  }

  // Read labels
  const labels = new Array(count);
  for (let i = 0; i < count; i++) {
    labels[i] = [];
    for (let j = 0; j < labelCounts[i]; j++) {
      if (s.remaining() < 1) break;
      labels[i].push(s.readUnsignedByte());
    }
  }

  return { id, transformCount: count, types, labels };
}
