import { CACHE_DURATIONS } from "./constants.ts";
import type { CacheStrategy } from "./types.ts";

const CACHE_PRESETS = Object.freeze(
  {
    "no-cache": "no-cache, no-store, must-revalidate",
    "no-store": "no-store",
    short: `public, max-age=${CACHE_DURATIONS.SHORT}`,
    medium: `public, max-age=${CACHE_DURATIONS.MEDIUM}`,
    long: `public, max-age=${CACHE_DURATIONS.LONG}`,
    immutable: `public, max-age=${CACHE_DURATIONS.LONG}, immutable`,
    // "none" prevents all caching - used in development to avoid nonce mismatches
    none: "no-cache, no-store, must-revalidate",
  } satisfies Record<Extract<CacheStrategy, string>, string>,
);

const CACHE_OPTION_KEYS = new Set([
  "maxAge",
  "public",
  "immutable",
  "mustRevalidate",
  "staleWhileRevalidate",
]);

interface NormalizedCacheOptions {
  maxAge: number;
  public?: boolean;
  immutable?: boolean;
  mustRevalidate?: boolean;
  staleWhileRevalidate?: number;
}

function invalidCacheStrategy(): never {
  throw new TypeError("Invalid cache strategy");
}

function isDeltaSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function snapshotCacheOptions(strategy: unknown): NormalizedCacheOptions {
  if (typeof strategy !== "object" || strategy === null) return invalidCacheStrategy();

  const values: Record<string, unknown> = Object.create(null);
  try {
    if (Array.isArray(strategy)) return invalidCacheStrategy();
    const prototype = Object.getPrototypeOf(strategy);
    if (prototype !== Object.prototype && prototype !== null) return invalidCacheStrategy();

    for (const key of Reflect.ownKeys(strategy)) {
      if (typeof key !== "string" || !CACHE_OPTION_KEYS.has(key)) {
        return invalidCacheStrategy();
      }
      const descriptor = Object.getOwnPropertyDescriptor(strategy, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return invalidCacheStrategy();
      }
      values[key] = descriptor.value;
    }
  } catch {
    return invalidCacheStrategy();
  }

  if (!isDeltaSeconds(values.maxAge)) return invalidCacheStrategy();
  for (const key of ["public", "immutable", "mustRevalidate"] as const) {
    if (values[key] !== undefined && typeof values[key] !== "boolean") {
      return invalidCacheStrategy();
    }
  }
  if (
    values.staleWhileRevalidate !== undefined &&
    !isDeltaSeconds(values.staleWhileRevalidate)
  ) {
    return invalidCacheStrategy();
  }

  return Object.freeze({
    maxAge: values.maxAge,
    public: values.public as boolean | undefined,
    immutable: values.immutable as boolean | undefined,
    mustRevalidate: values.mustRevalidate as boolean | undefined,
    staleWhileRevalidate: values.staleWhileRevalidate as number | undefined,
  });
}

export function buildCacheControl(strategy: CacheStrategy): string {
  if (typeof strategy === "string") {
    if (!Object.hasOwn(CACHE_PRESETS, strategy)) return invalidCacheStrategy();
    return CACHE_PRESETS[strategy as keyof typeof CACHE_PRESETS];
  }

  const options = snapshotCacheOptions(strategy);

  const parts: string[] = [
    options.public !== false ? "public" : "private",
    `max-age=${options.maxAge}`,
  ];

  if (options.immutable) {
    parts.push("immutable");
  }

  if (options.mustRevalidate) {
    parts.push("must-revalidate");
  }

  if (options.staleWhileRevalidate !== undefined) {
    parts.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
  }

  return parts.join(", ");
}
