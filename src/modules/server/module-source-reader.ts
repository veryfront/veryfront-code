import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import { MAX_SERVABLE_MODULE_SOURCE_BYTES } from "./module-limits.ts";

interface StatCapableTextSource {
  stat(path: string): Promise<{
    isFile: boolean;
    size: number;
  }>;
}

/**
 * Read one module source under both a pre-read stat boundary and a post-read
 * UTF-8 boundary.
 *
 * The stat check refuses an oversized file before its bytes are allocated;
 * the second check covers size drift between the two calls and adapters whose
 * reported size does not match the bytes actually returned.
 */
export async function readBoundedModuleSource(
  fs: StatCapableTextSource,
  path: string,
  readText: (path: string) => Promise<string>,
  maxBytes = MAX_SERVABLE_MODULE_SOURCE_BYTES,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Module source maxBytes must be a positive safe integer");
  }

  const stat = await fs.stat(path);
  if (!stat.isFile) {
    throw new TypeError("Module source target must be a regular file");
  }
  if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
    throw new RangeError("Module source stat size must be a non-negative safe integer");
  }
  if (stat.size > maxBytes) {
    throw new RangeError(`Module source exceeds ${maxBytes} bytes`);
  }

  const source = await readText(path);
  if (
    typeof source !== "string" ||
    utf8ByteLength(source, maxBytes) > maxBytes
  ) {
    throw new RangeError(`Module source exceeds ${maxBytes} UTF-8 bytes`);
  }
  return source;
}
