import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";
import { PLATFORM_ERROR } from "#veryfront/errors/error-registry/deploy.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import type { KVStoreAdapter } from "../../base.ts";
import type { KVListKey, KVNamespace } from "./types.ts";

const MAX_KV_KEY_BYTES = 512;
const MAX_KV_VALUE_BYTES = 25 * 1024 * 1024;

function validateKey(key: string): void {
  if (
    key.length === 0 || key === "." || key === ".." ||
    new TextEncoder().encode(key).byteLength > MAX_KV_KEY_BYTES
  ) {
    throw INVALID_ARGUMENT.create({ message: "Cloudflare KV key is invalid" });
  }
}

async function runKVOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    throw PLATFORM_ERROR.create({ message: "Cloudflare KV operation failed" });
  }
}

export async function* iterateCloudflareKVKeys(
  namespace: KVNamespace,
  prefix = "",
): AsyncIterable<KVListKey> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  while (true) {
    const page = await runKVOperation(() =>
      namespace.list({ prefix, ...(cursor ? { cursor } : {}) })
    );
    yield* page.keys;

    if (page.list_complete === true) return;
    if (page.list_complete !== false) {
      throw CONFIG_INVALID.create({
        message: "Cloudflare KV returned an invalid pagination completion state",
      });
    }

    const nextCursor = page.cursor;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw CONFIG_INVALID.create({
        message: "Cloudflare KV returned an invalid pagination cursor",
      });
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

export class CloudflareKVStoreAdapter implements KVStoreAdapter {
  constructor(private readonly namespace: KVNamespace) {}

  async get(key: string): Promise<string | null> {
    validateKey(key);
    const value = await runKVOperation(() => this.namespace.get(key));
    if (value === null || typeof value === "string") return value;

    throw CONFIG_INVALID.create({
      message: "Cloudflare KV returned a non-text value for a text read",
    });
  }

  async set(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    validateKey(key);
    const expirationTtl = options?.expirationTtl;
    if (
      expirationTtl !== undefined &&
      (!Number.isSafeInteger(expirationTtl) || expirationTtl < 60)
    ) {
      throw INVALID_ARGUMENT.create({
        message: "Cloudflare KV expiration TTL must be an integer of at least 60 seconds",
      });
    }

    if (new TextEncoder().encode(value).byteLength > MAX_KV_VALUE_BYTES) {
      throw INVALID_ARGUMENT.create({ message: "Cloudflare KV value exceeds the size limit" });
    }

    await runKVOperation(() =>
      this.namespace.put(
        key,
        value,
        expirationTtl === undefined ? undefined : { expirationTtl },
      )
    );
  }

  delete(key: string): Promise<void> {
    validateKey(key);
    return runKVOperation(() => this.namespace.delete(key));
  }

  async *list(prefix = ""): AsyncIterable<string> {
    if (new TextEncoder().encode(prefix).byteLength > MAX_KV_KEY_BYTES) {
      throw INVALID_ARGUMENT.create({
        message: "Cloudflare KV prefix exceeds the key length limit",
      });
    }
    for await (const key of iterateCloudflareKVKeys(this.namespace, prefix)) {
      yield key.name;
    }
  }
}
