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
const IntrinsicMap = Map;
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicObjectAssign = Object.assign;
const NativeUint8Array = Uint8Array;
const MapPrototypeClear = Map.prototype.clear;
const MapPrototypeDelete = Map.prototype.delete;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeHas = Map.prototype.has;
const MapPrototypeKeys = Map.prototype.keys;
const MapPrototypeSet = Map.prototype.set;
const MapIteratorPrototypeNext = Object.getPrototypeOf(new Map().keys()).next as (
  this: Iterator<string>,
) => IteratorResult<string>;
const ArrayPrototypePush = Array.prototype.push;
const NumberPrototypeToString = Number.prototype.toString;
const StringPrototypePadStart = String.prototype.padStart;
const SHA256_DIGEST_BYTES = 32;

/** Upper bound on retained content, in UTF-16 code units (about 64 MiB). */
const DEFAULT_MAX_CONTENT_UNITS = 32 * 1024 * 1024;
/** Bound on remembered sources, so the hint map cannot grow without limit. */
const DEFAULT_MAX_SOURCES = 512;

export interface SourceListingFile {
  path: string;
  content?: string;
  checksum?: string | null;
  size?: number;
}

export interface SourceContentStoreLimits {
  maxContentUnits?: number;
  maxSources?: number;
}

let maxContentUnits = DEFAULT_MAX_CONTENT_UNITS;
let maxSources = DEFAULT_MAX_SOURCES;
/** Least recently used first; `Map` iteration order is insertion order. */
const contentsByChecksum = new IntrinsicMap<string, string>();
let storedContentUnits = 0;
const verifiedSources = new IntrinsicMap<string, true>();

function mapGet<V>(map: Map<string, V>, key: string): V | undefined {
  return IntrinsicReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapHas(map: Map<string, unknown>, key: string): boolean {
  return IntrinsicReflectApply(MapPrototypeHas, map, [key]) as boolean;
}

function mapSet<V>(map: Map<string, V>, key: string, value: V): void {
  IntrinsicReflectApply(MapPrototypeSet, map, [key, value]);
}

function mapDelete(map: Map<string, unknown>, key: string): void {
  IntrinsicReflectApply(MapPrototypeDelete, map, [key]);
}

function oldestKey(map: Map<string, unknown>): string | undefined {
  const keys = IntrinsicReflectApply(MapPrototypeKeys, map, []) as Iterator<string>;
  const first = IntrinsicReflectApply(MapIteratorPrototypeNext, keys, []) as IteratorResult<
    string
  >;
  return first.done ? undefined : first.value;
}

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

/** Mark `checksum` most recently used. */
function touch(checksum: string, content: string): void {
  mapDelete(contentsByChecksum, checksum);
  mapSet(contentsByChecksum, checksum, content);
}

function store(checksum: string, content: string): void {
  if (content.length > maxContentUnits) return;
  const previous = mapGet(contentsByChecksum, checksum);
  if (previous !== undefined) {
    touch(checksum, previous);
    return;
  }
  mapSet(contentsByChecksum, checksum, content);
  storedContentUnits += content.length;
  while (storedContentUnits > maxContentUnits) {
    const oldest = oldestKey(contentsByChecksum)!;
    storedContentUnits -= mapGet(contentsByChecksum, oldest)!.length;
    mapDelete(contentsByChecksum, oldest);
  }
}

function rememberSource(sourceKey: string): void {
  mapDelete(verifiedSources, sourceKey);
  mapSet(verifiedSources, sourceKey, true);
  if (verifiedSources.size > maxSources) {
    mapDelete(verifiedSources, oldestKey(verifiedSources)!);
  }
}

/**
 * Store every content in `files` that hashes to its reported checksum. The
 * source is remembered as reusable only when every file verified and is still
 * held afterwards, so a metadata-only listing is attempted only where the
 * store can complete it.
 */
export async function admitVerifiedSourceContents(
  sourceKey: string,
  files: readonly SourceListingFile[],
): Promise<void> {
  let complete = files.length > 0;
  for (let index = 0; index < files.length; index++) {
    const { content, checksum } = files[index]!;
    if (
      typeof content === "string" && typeof checksum === "string" &&
      await sha256Hex(content) === checksum
    ) {
      store(checksum, content);
    } else {
      complete = false;
    }
  }
  for (let index = 0; complete && index < files.length; index++) {
    complete = mapHas(contentsByChecksum, files[index]!.checksum as string);
  }
  if (complete) rememberSource(sourceKey);
  else forgetVerifiedSource(sourceKey);
}

/** Whether a complete listing of this source was verified in this process. */
export function hasVerifiedSourceContents(sourceKey: string): boolean {
  return mapHas(verifiedSources, sourceKey);
}

/** Stop attempting metadata-only listings for this source until it verifies again. */
export function forgetVerifiedSource(sourceKey: string): void {
  mapDelete(verifiedSources, sourceKey);
}

/**
 * Attach verified contents to a metadata-only listing. Returns undefined when
 * any listed file has no checksum or no verified content, so the caller lists
 * contents from the API instead of serving a partial snapshot. `size` follows
 * the complete listing, which reports the content length.
 */
export function assembleSourceListing<T extends SourceListingFile>(
  sourceKey: string,
  metadata: readonly T[],
): Array<T & { content: string; size: number }> | undefined {
  const assembled: Array<T & { content: string; size: number }> = [];
  for (let index = 0; index < metadata.length; index++) {
    const file = metadata[index]!;
    const checksum = file.checksum;
    const content = typeof checksum === "string" ? mapGet(contentsByChecksum, checksum) : undefined;
    if (typeof checksum !== "string" || content === undefined) {
      forgetVerifiedSource(sourceKey);
      return undefined;
    }
    touch(checksum, content);
    IntrinsicReflectApply(ArrayPrototypePush, assembled, [
      IntrinsicObjectAssign({}, file, { content, size: content.length }),
    ]);
  }
  return assembled;
}

/**
 * Drop every stored content and restore the default limits. Tests use this to
 * isolate process-wide state and may pass lower limits to exercise eviction.
 */
export function resetSourceContentStore(limits: SourceContentStoreLimits = {}): void {
  IntrinsicReflectApply(MapPrototypeClear, contentsByChecksum, []);
  IntrinsicReflectApply(MapPrototypeClear, verifiedSources, []);
  storedContentUnits = 0;
  maxContentUnits = limits.maxContentUnits ?? DEFAULT_MAX_CONTENT_UNITS;
  maxSources = limits.maxSources ?? DEFAULT_MAX_SOURCES;
}
