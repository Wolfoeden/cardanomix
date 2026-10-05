import { randomUUID } from "node:crypto";
import type { ImageStorage } from "../server/marketplace/storage";
/** Only attached to the local development server and test contexts. */
export class MemoryImageStorage implements ImageStorage {
  readonly uploads = new Map<string, Uint8Array>();
  readonly images = new Map<string, Uint8Array>();
  readonly tokens = new Map<string, string>();
  async signUpload(path: string) {
    const token = randomUUID();
    this.tokens.set(token, path);
    return `/__dev/storage/upload/${token}`;
  }
  async download(path: string) {
    const bytes = this.uploads.get(path);
    if (!bytes) throw new Error("Upload fehlt");
    return bytes;
  }
  async put(path: string, bytes: Uint8Array) {
    this.images.set(path, bytes);
  }
  async urls(paths: string[]) {
    return paths.map(
      (path) => `/__dev/storage/image/${encodeURIComponent(path)}`,
    );
  }
  async remove(bucket: "uploads" | "images", paths: string[]) {
    for (const path of paths)
      (bucket === "uploads" ? this.uploads : this.images).delete(path);
  }
}
