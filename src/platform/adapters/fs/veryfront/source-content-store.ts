/**
 * Process-wide, content-addressed store of source file contents.
 *
 * Hosted requests select one adapter per credential, and the API answers every
 * listing on that credential's own authority: which files a caller may see
 * (for example server-function sources) depends on the caller. A listing must
 * therefore never be shared across credentials. File contents are different:
 * the API reports each file's SHA-256 checksum, and the bytes behind a checksum
 * are the same for every caller. A fresh credential can list metadata only,
 * which keeps its file set, versions and deletions exactly as the API reports
 * them for that credential, and take contents from bytes this process already
 * received and verified against the same checksum.
 */

const subtleDigest = crypto.subtle.digest.bind(crypto.subtle);
const encodeText = TextEncoder.prototype.encode;
const textEncoder = new TextEncoder();
const IntrinsicReflectApply = Reflect.apply;
const NativeUint8Array = Uint8Array;
const NumberPrototypeToString = Number.prototype.toString;
const StringPrototypePadStart = String.prototype.padStart;
const SHA256_DIGEST_BYTES = 32;

/** Upper bound on retained content, in UTF-16 code units (about 64 MiB). */
const MAX_STORED_CONTENT_UNITS = 32 * 1024 * 1024;
/** Bound on remembered sources, so the hint map cannot grow without limit. */
const MAX_REMEMBERED_SOURCES = 512;

export interface SourceListingFile {
  path: string;
  content?: string;
  checksum?: string;
}

/** Least recently used first; `Map` iteration order is insertion order. */
const contentsByChecksum = new Map<string, string>();
let storedContentUnits = 0;
const verifiedSources = new Map<string, true>();

async function sha256Hex(content: string): Promise<string> {
  const bytes = IntrinsicReflectApply(encodeText, textEncoder, [content]) as ReturnType<
    typeof encodeText
  >;
  const digest = new NativeUint8Array(await subtleDigest("SHA-256", bytes));
  let hex = "";
  for (let index = 0; index < SHA256_DIGEST_BYTES; index++) {
    const encoded = IntrinsicReflectApply(NumberPrototypeToString, digest[index]!, [16]) as string;
    hex += IntrinsicReflectApply(StringPrototypePadStart, encoded, [2, "0"]) as string;
  }
  return hex;
}

function touch(checksum: string, content: string): void {
  contentsByChecksum.delete(checksum);
  contentsByChecksum.set(checksum, content);
}

function store(checksum: string, content: string): void {
  if (content.length > MAX_STORED_CONTENT_UNITS) return;
  const previous = contentsByChecksum.get(checksum);
  if (previous !== undefined) {
    touch(checksum, previous);
    return;
  }
  contentsByChecksum.set(checksum, content);
  storedContentUnits += content.length;
  for (const [oldest, oldestContent] of contentsByChecksum) {
    if (storedContentUnits <= MAX_STORED_CONTENT_UNITS) break;
    contentsByChecksum.delete(oldest);
    storedContentUnits -= oldestContent.length;
  }
}

function rememberSource(sourceKey: string): void {
  verifiedSources.delete(sourceKey);
  verifiedSources.set(sourceKey, true);
  if (verifiedSources.size <= MAX_REMEMBERED_SOURCES) return;
  for (const oldest of verifiedSources.keys()) {
    verifiedSources.delete(oldest);
    break;
  }
}

/**
 * Store every content in `files` that hashes to its reported checksum. The
 * source is remembered as reusable only when every file verified, so a later
 * metadata-only listing is attempted only where it can usually be completed.
 */
export async function admitVerifiedSourceContents(
  sourceKey: string,
  files: readonly SourceListingFile[],
): Promise<void> {
  let complete = files.length > 0;
  for (const file of files) {
    const { content, checksum } = file;
    if (typeof content !== "string" || typeof checksum !== "string") {
      complete = false;
      continue;
    }
    if (await sha256Hex(content) !== checksum) {
      complete = false;
      continue;
    }
    store(checksum, content);
  }
  if (complete) rememberSource(sourceKey);
}

/** Whether a complete listing of this source was verified in this process. */
export function hasVerifiedSourceContents(sourceKey: string): boolean {
  return verifiedSources.has(sourceKey);
}

/**
 * Attach verified contents to a metadata-only listing. Returns undefined when
 * any listed file has no checksum or no verified content, so the caller lists
 * contents from the API instead of serving a partial snapshot.
 */
export function assembleSourceListing<T extends SourceListingFile>(
  sourceKey: string,
  metadata: readonly T[],
): Array<T & { content: string }> | undefined {
  const assembled: Array<T & { content: string }> = [];
  for (const file of metadata) {
    const checksum = file.checksum;
    const content = typeof checksum === "string" ? contentsByChecksum.get(checksum) : undefined;
    if (checksum === undefined || content === undefined) {
      verifiedSources.delete(sourceKey);
      return undefined;
    }
    touch(checksum, content);
    assembled.push({ ...file, content });
  }
  return assembled;
}

/** Drop every stored content. Tests use this to isolate process-wide state. */
export function resetSourceContentStore(): void {
  contentsByChecksum.clear();
  verifiedSources.clear();
  storedContentUnits = 0;
}
