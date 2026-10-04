/**
 * Minimaler CBOR-Decoder (RFC 8949) für COSE-Strukturen aus Wallet-Signaturen.
 * Maps werden zu `Map`, Byte-Strings zu `Uint8Array`, Tags zu `{ tag, value }`.
 * Bewusst ohne native Abhängigkeiten, damit die Netlify Function schlank bleibt.
 */

export interface CborTag {
  tag: number;
  value: unknown;
}

const MAX_DEPTH = 16;
const MAX_ITEMS = 1024;

export class CborError extends Error {}

export function decodeCbor(input: Uint8Array): unknown {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let offset = 0;

  function need(length: number) {
    if (offset + length > input.length) throw new CborError("CBOR endet unerwartet");
  }

  function readArgument(info: number): number {
    if (info < 24) return info;
    if (info === 24) {
      need(1);
      return input[offset++];
    }
    if (info === 25) {
      need(2);
      const value = view.getUint16(offset);
      offset += 2;
      return value;
    }
    if (info === 26) {
      need(4);
      const value = view.getUint32(offset);
      offset += 4;
      return value;
    }
    if (info === 27) {
      need(8);
      const value = view.getBigUint64(offset);
      offset += 8;
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new CborError("Zahl zu groß");
      return Number(value);
    }
    throw new CborError("Ungültige Längenangabe");
  }

  function readBytes(length: number): Uint8Array {
    need(length);
    const bytes = input.slice(offset, offset + length);
    offset += length;
    return bytes;
  }

  function readChunks(major: number): Uint8Array {
    const chunks: Uint8Array[] = [];
    for (;;) {
      need(1);
      if (input[offset] === 0xff) {
        offset++;
        break;
      }
      const initial = input[offset++];
      if (initial >> 5 !== major || (initial & 0x1f) === 31) throw new CborError("Ungültiger Teilstring");
      chunks.push(readBytes(readArgument(initial & 0x1f)));
    }
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let position = 0;
    for (const chunk of chunks) {
      out.set(chunk, position);
      position += chunk.length;
    }
    return out;
  }

  function item(depth: number): unknown {
    if (depth > MAX_DEPTH) throw new CborError("CBOR zu tief verschachtelt");
    need(1);
    const initial = input[offset++];
    const major = initial >> 5;
    const info = initial & 0x1f;
    const indefinite = info === 31;

    switch (major) {
      case 0:
        return readArgument(info);
      case 1:
        return -1 - readArgument(info);
      case 2:
        return indefinite ? readChunks(2) : readBytes(readArgument(info));
      case 3:
        return new TextDecoder("utf-8", { fatal: true }).decode(indefinite ? readChunks(3) : readBytes(readArgument(info)));
      case 4: {
        const values: unknown[] = [];
        if (indefinite) {
          for (;;) {
            need(1);
            if (input[offset] === 0xff) {
              offset++;
              break;
            }
            if (values.length >= MAX_ITEMS) throw new CborError("Zu viele Einträge");
            values.push(item(depth + 1));
          }
        } else {
          const length = readArgument(info);
          if (length > MAX_ITEMS) throw new CborError("Zu viele Einträge");
          for (let i = 0; i < length; i++) values.push(item(depth + 1));
        }
        return values;
      }
      case 5: {
        const map = new Map<unknown, unknown>();
        const readPair = () => {
          const key = item(depth + 1);
          map.set(key, item(depth + 1));
        };
        if (indefinite) {
          for (;;) {
            need(1);
            if (input[offset] === 0xff) {
              offset++;
              break;
            }
            if (map.size >= MAX_ITEMS) throw new CborError("Zu viele Einträge");
            readPair();
          }
        } else {
          const length = readArgument(info);
          if (length > MAX_ITEMS) throw new CborError("Zu viele Einträge");
          for (let i = 0; i < length; i++) readPair();
        }
        return map;
      }
      case 6: {
        const tag = readArgument(info);
        return { tag, value: item(depth + 1) } satisfies CborTag;
      }
      default: {
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        if (info === 25) {
          need(2);
          const value = view.getFloat16 ? view.getFloat16(offset) : Number.NaN;
          offset += 2;
          return value;
        }
        if (info === 26) {
          need(4);
          const value = view.getFloat32(offset);
          offset += 4;
          return value;
        }
        if (info === 27) {
          need(8);
          const value = view.getFloat64(offset);
          offset += 8;
          return value;
        }
        throw new CborError("Nicht unterstützter CBOR-Wert");
      }
    }
  }

  const result = item(0);
  if (offset !== input.length) throw new CborError("Überzählige Bytes nach CBOR-Wert");
  return result;
}
