import type { Span } from "#veryfront/observability/tracing/api-shim.ts";
import { endSpan, setSpanAttributes, type SpanOptions, startSpan } from "../tracing/index.ts";
import type { BatchOptions, InstrumentOptions } from "./types.ts";

const MAX_BATCH_CONCURRENCY = 1_000;

/** Instrument an async operation with bounded automatic telemetry. */
export function instrument<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  spanName: string,
  options?: InstrumentOptions,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const span = createOperationSpan(spanName, options);
    const startTime = readMonotonicTime();

    try {
      const result = await fn(...args);
      recordDuration(span, startTime);
      finishSpan(span);
      return result;
    } catch (error) {
      finishSpan(span, error);
      throw error;
    }
  };
}

/** Instrument a synchronous operation with bounded automatic telemetry. */
export function instrumentSync<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
  spanName: string,
  options?: InstrumentOptions,
): (...args: TArgs) => TResult {
  return (...args: TArgs): TResult => {
    const span = createOperationSpan(spanName, options);
    const startTime = readMonotonicTime();

    try {
      const result = fn(...args);
      recordDuration(span, startTime);
      finishSpan(span);
      return result;
    } catch (error) {
      finishSpan(span, error);
      throw error;
    }
  };
}

/** Instrument a batch operation. */
export async function instrumentBatch<T>(
  operationName: string,
  items: T[],
  processor: (item: T, index: number) => Promise<void>,
  options?: BatchOptions,
): Promise<void> {
  const batchSize = options?.batchSize ?? 10;
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new TypeError("batchSize must be a positive safe integer");
  }
  if (batchSize > MAX_BATCH_CONCURRENCY) {
    throw new TypeError(`batchSize must be at most ${MAX_BATCH_CONCURRENCY}`);
  }
  const stableItems = items.slice();
  const totalBatches = Math.ceil(stableItems.length / batchSize);

  const batchSpan = tryStartSpan(operationName, {
    kind: "internal",
    attributes: {
      "batch.total_items": stableItems.length,
      "batch.size": batchSize,
      "batch.total_batches": totalBatches,
    },
  });

  try {
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, stableItems.length);
      const batch = stableItems.slice(start, end);

      const batchItemSpan = tryStartSpan(`${operationName}.batch`, {
        kind: "internal",
        attributes: {
          "batch.index": batchIndex,
          "batch.items": batch.length,
        },
      });

      try {
        await Promise.all(batch.map((item, index) => processor(item, start + index)));
        finishSpan(batchItemSpan);
      } catch (error) {
        finishSpan(batchItemSpan, error);
        throw error;
      }
    }

    finishSpan(batchSpan);
  } catch (error) {
    finishSpan(batchSpan, error);
    throw error;
  }
}

function createOperationSpan(
  spanName: string,
  options?: InstrumentOptions,
): Span | null {
  try {
    return startSpan(spanName, {
      kind: options?.kind ?? "internal",
    });
  } catch {
    return null;
  }
}

function tryStartSpan(spanName: string, options: SpanOptions): Span | null {
  try {
    return startSpan(spanName, options);
  } catch {
    return null;
  }
}

function finishSpan(span: Span | null, error?: unknown): void {
  try {
    endSpan(span, error);
  } catch {
    // Automatic telemetry must not affect the wrapped operation.
  }
}

function readMonotonicTime(): number | undefined {
  try {
    const value = performance.now();
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function recordDuration(span: Span | null, startTime: number | undefined): void {
  if (startTime === undefined) return;
  const endTime = readMonotonicTime();
  if (endTime === undefined) return;

  try {
    setSpanAttributes(span, {
      duration_ms: Math.max(0, Math.floor(endTime - startTime)),
    });
  } catch {
    // Automatic telemetry must not affect the wrapped operation.
  }
}
