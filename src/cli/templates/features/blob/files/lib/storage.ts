/**
 * S3-compatible blob storage client
 *
 * Supports AWS S3, MinIO, Cloudflare R2, and other S3-compatible services
 */

// Helper for Cross-Platform environment access
function _getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") {
    // @ts-ignore - Deno global
    return Deno.env.get(key);
  } // @ts-ignore - process global
  else if (typeof process !== "undefined" && process.env) {
    // @ts-ignore - process global
    return process.env[key];
  }
  return undefined;
}

export interface BlobRef {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: number;
  url?: string;
}

export interface UploadOptions {
  filename?: string;
  mimeType?: string;
  metadata?: Record<string, string>;
}

// In-memory storage for development
// In production, replace with actual S3 client
const blobs = new Map<string, { data: ArrayBuffer; ref: BlobRef }>();

export function uploadBlob(
  data: ArrayBuffer | Uint8Array | string,
  options: UploadOptions = {},
): Promise<BlobRef> {
  const id = crypto.randomUUID();
  const buffer: ArrayBuffer = typeof data === "string"
    ? new TextEncoder().encode(data).buffer as ArrayBuffer
    : data instanceof Uint8Array
    ? data.buffer as ArrayBuffer
    : data;

  const ref: BlobRef = {
    id,
    filename: options.filename || `file-${id}`,
    size: buffer.byteLength,
    mimeType: options.mimeType || "application/octet-stream",
    createdAt: Date.now(),
    url: `/api/upload/${id}`,
  };

  blobs.set(id, { data: buffer, ref });
  console.log(`[Storage] Uploaded blob ${id} (${ref.size} bytes)`);

  return Promise.resolve(ref);
}

export function getBlob(id: string): Promise<ArrayBuffer | null> {
  const blob = blobs.get(id);
  return Promise.resolve(blob ? blob.data : null);
}

export function getBlobRef(id: string): Promise<BlobRef | null> {
  const blob = blobs.get(id);
  return Promise.resolve(blob ? blob.ref : null);
}

export function deleteBlob(id: string): Promise<boolean> {
  const existed = blobs.delete(id);
  if (existed) {
    console.log(`[Storage] Deleted blob ${id}`);
  }
  return Promise.resolve(existed);
}

export function listBlobs(): Promise<BlobRef[]> {
  return Promise.resolve(
    Array.from(blobs.values())
      .map((b) => b.ref)
      .sort((a, b) => b.createdAt - a.createdAt),
  );
}

export function getBlobText(id: string): Promise<string | null> {
  const blob = blobs.get(id);
  if (!blob) return Promise.resolve(null);
  return Promise.resolve(new TextDecoder().decode(blob.data));
}
