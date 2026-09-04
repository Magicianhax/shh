import { CHUNK_MAX } from "./constants";

export type Chunk = { offset: number; data: Uint8Array };

/** Split `bytes` into `<= size` slices carrying their absolute offset. */
export function chunk(bytes: Uint8Array, size = CHUNK_MAX): Chunk[] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const out: Chunk[] = [];
  for (let off = 0; off < bytes.length; off += size) {
    out.push({ offset: off, data: bytes.subarray(off, off + size) });
  }
  return out;
}
