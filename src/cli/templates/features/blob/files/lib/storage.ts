/****
 * S3-compatible blob storage client
 *
 * Supports AWS S3, MinIO, Cloudflare R2, and other S3-compatible services
 */

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

function toArrayBuffer(data: ArrayBuffer | Uint8Array | string): ArrayBuffer {
  if (typeof data === "string") return new TextEncoder().encode(data).buffer;
  if (data instanceof Uint8Array) return data.buffer;
  return data;
}

export function uploadBlob(
  data: ArrayBuffer | Uint8Array | string,
  options: UploadOptions = {},
): Promise<BlobRef> {
  const id = crypto.randomUUID();
  const buffer = toArrayBuffer(data);

  const ref: BlobRef = {
    id,
    filename: options.filename ?? `file-${id}`,
    size: buffer.byteLength,
    mimeType: options.mimeType ?? "application/octet-stream",
    createdAt: Date.now(),
    url: `/api/upload/${id}`,
  };

  blobs.set(id, { data: buffer, ref });
  console.log(`[Storage] Uploaded blob ${id} (${ref.size} bytes)`);

  return Promise.resolve(ref);
}

export function getBlob(id: string): Promise<ArrayBuffer | null> {
  return Promise.resolve(blobs.get(id)?.data ?? null);
}

export function getBlobRef(id: string): Promise<BlobRef | null> {
  return Promise.resolve(blobs.get(id)?.ref ?? null);
}

export function deleteBlob(id: string): Promise<boolean> {
  const existed = blobs.delete(id);
  if (existed) console.log(`[Storage] Deleted blob ${id}`);
  return Promise.resolve(existed);
}

export function listBlobs(): Promise<BlobRef[]> {
  const refs = Array.from(blobs.values(), (b) => b.ref).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  return Promise.resolve(refs);
}

export function getBlobText(id: string): Promise<string | null> {
  const data = blobs.get(id)?.data;
  if (!data) return Promise.resolve(null);
  return Promise.resolve(new TextDecoder().decode(data));
}
