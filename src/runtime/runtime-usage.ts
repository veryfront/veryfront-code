import type { RuntimeGenerateUsage } from "#veryfront/agent/runtime/runtime-tool-types.ts";
import {
  mergeRuntimeUsage,
  readRuntimeTokenCount,
  type RuntimeUsage,
  sanitizeRuntimeUsage,
} from "#veryfront/provider/runtime-usage.ts";

type UsageRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UsageRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwnDataProperty(
  value: UsageRecord,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, "value")) {
    throw new TypeError(
      "Runtime usage must use inspectable data properties",
    );
  }
  return descriptor.value;
}

function readNestedToken(
  section: unknown,
  field: string,
): number | undefined {
  return isRecord(section) ? readRuntimeTokenCount(readOwnDataProperty(section, field)) : undefined;
}

function detailedUsageCandidate(
  usage: UsageRecord,
  inputTokens: unknown,
  outputTokens: unknown,
): RuntimeUsage {
  const inputTokenDetails = readOwnDataProperty(usage, "inputTokenDetails");
  const outputTokenDetails = readOwnDataProperty(usage, "outputTokenDetails");

  return {
    inputTokens: readNestedToken(inputTokens, "total"),
    outputTokens: readNestedToken(outputTokens, "total"),
    totalTokens: readRuntimeTokenCount(
      readOwnDataProperty(usage, "totalTokens"),
    ),
    cacheCreationInputTokens: readNestedToken(inputTokenDetails, "cacheWriteTokens") ??
      readNestedToken(inputTokens, "cacheWrite") ??
      readNestedToken(inputTokens, "cacheCreation"),
    cacheReadInputTokens: readNestedToken(inputTokenDetails, "cacheReadTokens") ??
      readNestedToken(inputTokens, "cacheRead") ??
      readNestedToken(inputTokens, "cached"),
    reasoningTokens: readNestedToken(outputTokenDetails, "reasoningTokens") ??
      readNestedToken(outputTokens, "reasoning"),
  };
}

/**
 * Normalize direct or streamed provider usage into the framework contract.
 *
 * Current AI SDK runtimes expose token details as nested objects, while
 * Veryfront runtimes expose the canonical flat contract. Both paths share the
 * same numeric and billing sanitizer.
 */
export function normalizeRuntimeUsage(
  value: unknown,
): RuntimeGenerateUsage | undefined {
  try {
    if (!isRecord(value)) return undefined;

    const inputTokens = readOwnDataProperty(value, "inputTokens");
    const outputTokens = readOwnDataProperty(value, "outputTokens");
    const flatUsage = sanitizeRuntimeUsage(value);
    const detailedUsage = sanitizeRuntimeUsage(
      detailedUsageCandidate(value, inputTokens, outputTokens),
    );
    const usage = mergeRuntimeUsage(flatUsage, detailedUsage);

    const cacheReadInputTokens = usage === undefined ? undefined : readRuntimeTokenCount(
      readOwnDataProperty(usage as UsageRecord, "cacheReadInputTokens"),
    );
    const cachedInputTokens = cacheReadInputTokens ??
      readRuntimeTokenCount(
        readOwnDataProperty(value, "cachedInputTokens"),
      );
    if (!usage && cachedInputTokens === undefined) return undefined;

    const normalized = (usage ?? Object.create(null)) as RuntimeGenerateUsage;
    if (cachedInputTokens !== undefined) {
      Object.defineProperty(normalized, "cachedInputTokens", {
        configurable: true,
        enumerable: true,
        value: cachedInputTokens,
        writable: true,
      });
    }
    return normalized;
  } catch {
    return undefined;
  }
}

/**
 * Omit a redundant total from live finish events.
 *
 * Buffered generation re-normalizes the event and restores the overflow-safe
 * total. Keeping the live event compact preserves the established stream
 * contract while using the canonical usage vocabulary.
 */
export function projectRuntimeStreamUsage(
  usage: RuntimeGenerateUsage,
): RuntimeGenerateUsage {
  const normalized = normalizeRuntimeUsage(usage);
  if (!normalized) {
    return Object.create(null) as RuntimeGenerateUsage;
  }

  const inputTokens = readRuntimeTokenCount(
    readOwnDataProperty(normalized as UsageRecord, "inputTokens"),
  );
  const outputTokens = readRuntimeTokenCount(
    readOwnDataProperty(normalized as UsageRecord, "outputTokens"),
  );
  const totalTokens = readRuntimeTokenCount(
    readOwnDataProperty(normalized as UsageRecord, "totalTokens"),
  );
  const componentTotal = readRuntimeTokenCount(
    (inputTokens ?? 0) + (outputTokens ?? 0),
  );
  if (
    totalTokens === undefined ||
    componentTotal === undefined ||
    totalTokens !== componentTotal
  ) {
    return normalized;
  }

  delete normalized.totalTokens;
  return normalized;
}
