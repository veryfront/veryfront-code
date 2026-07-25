/** Gateway billing mode attached by Veryfront Cloud usage envelopes. */
export type GatewayBillingMode = "direct" | "deferred";

/** Provenance of the cost values attached to runtime usage. */
export type RuntimeUsageCostSource = "gateway" | "missing" | "partial";

/** Completeness of the usage captured for a runtime response. */
export type RuntimeUsageCaptureStatus = "complete" | "partial" | "missing";

/**
 * Canonical provider-neutral usage reported by text-generation runtimes.
 *
 * Token counters are non-negative safe integers. Cost and credit counters are
 * non-negative finite numbers. Use {@link sanitizeRuntimeUsage} or
 * {@link mergeRuntimeUsage} when values originate outside the process.
 * Normalized usage is a data-only record and may have a null prototype so an
 * absent field cannot resolve through a polluted global prototype. Use
 * `Object.hasOwn(record, field)` instead of instance methods such as
 * `record.hasOwnProperty(field)`.
 */
export interface RuntimeUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningTokens?: number;
  billableInputTokens?: number;
  billableOutputTokens?: number;
  costUsd?: number;
  providerCostUsd?: number;
  providerInputCostUsd?: number;
  providerOutputCostUsd?: number;
  veryfrontChargeUsd?: number;
  veryfrontInputChargeUsd?: number;
  veryfrontOutputChargeUsd?: number;
  veryfrontBilledUsd?: number;
  costCredits?: number;
  costSource?: RuntimeUsageCostSource;
  billingMode?: GatewayBillingMode;
  usageCaptureStatus?: RuntimeUsageCaptureStatus;
}

const RUNTIME_USAGE_NUMERIC_FIELDS = [
  ["inputTokens", "token"],
  ["outputTokens", "token"],
  ["totalTokens", "total"],
  ["cacheCreationInputTokens", "token"],
  ["cacheReadInputTokens", "token"],
  ["reasoningTokens", "token"],
  ["billableInputTokens", "token"],
  ["billableOutputTokens", "token"],
  ["costUsd", "cost"],
  ["providerCostUsd", "cost"],
  ["providerInputCostUsd", "cost"],
  ["providerOutputCostUsd", "cost"],
  ["veryfrontChargeUsd", "cost"],
  ["veryfrontInputChargeUsd", "cost"],
  ["veryfrontOutputChargeUsd", "cost"],
  ["veryfrontBilledUsd", "cost"],
  ["costCredits", "cost"],
] as const satisfies readonly (
  readonly [keyof RuntimeUsage, "token" | "total" | "cost"]
)[];

const RUNTIME_USAGE_FIELDS = [
  ...RUNTIME_USAGE_NUMERIC_FIELDS.map(([field]) => field),
  "costSource",
  "billingMode",
  "usageCaptureStatus",
] as const satisfies readonly (keyof RuntimeUsage)[];

/** Read a non-negative safe-integer token counter. */
export function readRuntimeTokenCount(value: unknown): number | undefined {
  return typeof value === "number" &&
      Number.isFinite(value) &&
      Number.isSafeInteger(value) &&
      value >= 0
    ? value
    : undefined;
}

/**
 * Add two optional token counters without returning an unsafe integer.
 *
 * An absent pair remains absent; an overflowing pair is rejected.
 */
export function sumRuntimeTokenCounts(
  first: number | undefined,
  second: number | undefined,
): number | undefined {
  if (first === undefined && second === undefined) {
    return undefined;
  }
  return readRuntimeTokenCount((first ?? 0) + (second ?? 0));
}

/** Read a non-negative finite cost or credit value. */
export function readRuntimeCost(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Read a trusted gateway billing mode from provider metadata. */
export function readGatewayBillingMode(value: unknown): GatewayBillingMode | undefined {
  return value === "direct" || value === "deferred" ? value : undefined;
}

function readRuntimeUsageCostSource(value: unknown): RuntimeUsageCostSource | undefined {
  return value === "gateway" || value === "missing" || value === "partial" ? value : undefined;
}

function readRuntimeUsageCaptureStatus(
  value: unknown,
): RuntimeUsageCaptureStatus | undefined {
  return value === "complete" || value === "partial" || value === "missing" ? value : undefined;
}

function latestValidValue<T>(
  next: unknown,
  current: unknown,
  read: (value: unknown) => T | undefined,
): T | undefined {
  return read(next) ?? read(current);
}

function defineRuntimeUsageDataProperty(
  usage: RuntimeUsage,
  field: keyof RuntimeUsage,
  value: RuntimeUsage[keyof RuntimeUsage],
): void {
  Object.defineProperty(usage, field, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * Snapshot usage fields without consulting prototypes or invoking accessors.
 *
 * Runtime usage crosses provider and gateway trust boundaries. Even though the
 * public merge signature is typed, callers can still supply values originating
 * from decoded JavaScript objects at runtime. If reflection itself fails (for
 * example, for a revoked or malformed proxy), the whole operand is treated as
 * empty instead of retaining a partial snapshot.
 */
function snapshotRuntimeUsageDataProperties(
  usage: RuntimeUsage,
): RuntimeUsage {
  const snapshot = Object.create(null) as RuntimeUsage;
  try {
    if (
      typeof usage !== "object" ||
      usage === null ||
      Array.isArray(usage)
    ) {
      return snapshot;
    }

    for (const field of RUNTIME_USAGE_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(usage, field);
      if (descriptor && Object.hasOwn(descriptor, "value")) {
        defineRuntimeUsageDataProperty(snapshot, field, descriptor.value);
      }
    }
    return snapshot;
  } catch {
    return Object.create(null) as RuntimeUsage;
  }
}

/**
 * Merge two usage snapshots using the latest valid value for each counter.
 *
 * A deferred billing mode remains deferred across internal gateway turns.
 * When input/output counters are present, `totalTokens` is the greater of the
 * valid reported total and their overflow-safe sum. This preserves
 * provider-reported reasoning tokens without allowing an undercount.
 *
 * Only own data properties participate. Inherited properties and accessors are
 * ignored without invoking their getters. The returned canonical record has a
 * null prototype so reads of absent fields cannot fall through to a polluted
 * global object prototype; its enumerable JSON shape remains unchanged.
 */
export function mergeRuntimeUsage(
  current: RuntimeUsage | undefined,
  next: RuntimeUsage | undefined,
): RuntimeUsage | undefined {
  if (!current && !next) return undefined;

  const previous = snapshotRuntimeUsageDataProperties(current ?? {});
  const incoming = snapshotRuntimeUsageDataProperties(next ?? {});
  const normalizedNumbers = Object.create(null) as RuntimeUsage;

  for (const [field, kind] of RUNTIME_USAGE_NUMERIC_FIELDS) {
    if (kind === "total") continue;
    const read = kind === "token" ? readRuntimeTokenCount : readRuntimeCost;
    const value = latestValidValue(
      incoming[field],
      previous[field],
      read,
    );
    if (value !== undefined) {
      normalizedNumbers[field] = value;
    }
  }

  const reportedTotal = latestValidValue(
    incoming.totalTokens,
    previous.totalTokens,
    readRuntimeTokenCount,
  );
  const hasInputOrOutput = normalizedNumbers.inputTokens !== undefined ||
    normalizedNumbers.outputTokens !== undefined;
  const recomputedTotal = sumRuntimeTokenCounts(
    normalizedNumbers.inputTokens,
    normalizedNumbers.outputTokens,
  );
  const totalTokens = hasInputOrOutput && recomputedTotal === undefined
    ? undefined
    : reportedTotal !== undefined && recomputedTotal !== undefined
    ? Math.max(reportedTotal, recomputedTotal)
    : reportedTotal ?? recomputedTotal;
  if (totalTokens !== undefined) {
    normalizedNumbers.totalTokens = totalTokens;
  }

  // Preserve the established serialized field order of the legacy provider
  // facade while keeping validation driven by one numeric-field vocabulary.
  const merged = Object.create(null) as RuntimeUsage;
  for (const [field] of RUNTIME_USAGE_NUMERIC_FIELDS) {
    const value = normalizedNumbers[field];
    if (value !== undefined) {
      defineRuntimeUsageDataProperty(merged, field, value);
    }
  }

  const costSource = latestValidValue(
    incoming.costSource,
    previous.costSource,
    readRuntimeUsageCostSource,
  );
  if (costSource !== undefined) {
    defineRuntimeUsageDataProperty(merged, "costSource", costSource);
  }

  const incomingBillingMode = incoming.billingMode;
  const previousBillingMode = previous.billingMode;
  const billingMode = incomingBillingMode === "deferred" ||
      previousBillingMode === "deferred"
    ? "deferred"
    : readGatewayBillingMode(incomingBillingMode) ??
      readGatewayBillingMode(previousBillingMode);
  if (billingMode !== undefined) {
    defineRuntimeUsageDataProperty(merged, "billingMode", billingMode);
  }

  const usageCaptureStatus = latestValidValue(
    incoming.usageCaptureStatus,
    previous.usageCaptureStatus,
    readRuntimeUsageCaptureStatus,
  );
  if (usageCaptureStatus !== undefined) {
    defineRuntimeUsageDataProperty(merged, "usageCaptureStatus", usageCaptureStatus);
  }

  return merged;
}

/**
 * Validate and normalize one externally sourced usage snapshot.
 *
 * Returns `undefined` when the input is absent or contains no valid own data
 * fields. Inherited properties and accessors are ignored without invoking
 * their getters.
 */
export function sanitizeRuntimeUsage(
  usage: unknown,
): RuntimeUsage | undefined {
  try {
    if (
      typeof usage !== "object" ||
      usage === null ||
      Array.isArray(usage)
    ) {
      return undefined;
    }

    const sanitized = mergeRuntimeUsage(
      undefined,
      usage as RuntimeUsage,
    );
    return sanitized && Object.keys(sanitized).length > 0 ? sanitized : undefined;
  } catch {
    return undefined;
  }
}
