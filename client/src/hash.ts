import { sha256 as nobleSha256 } from "@noble/hashes/sha256";

export const sha256 = (bytes: Uint8Array): Uint8Array => nobleSha256(bytes);
