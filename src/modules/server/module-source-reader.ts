import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import { MAX_SERVABLE_MODULE_SOURCE_BYTES } from "./module-limits.ts";

interface StatCapableTextSource {
  stat(path: string): Promise<{
    isFile: boolean;
    size: number;
  }>;
}

/**
 * Read one module source with both a pre-read stat boundary and a post-read
 * UTF-8 boundary. The second check closes size drift and inaccurate-adapter
 * metadata gaps.
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
  if (
    !stat.isFile ||
    !Number.isSafeInteger(stat.size) ||
    stat.size < 0 ||
    stat.size > maxBytes
  ) {
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
