import type { Span } from "#veryfront/observability/tracing/api-shim.ts";
import { endSpan, setSpanAttributes, type SpanOptions, startSpan } from "../tracing/index.ts";
import type { BatchOptions, InstrumentOptions } from "./types.ts";

/** Instrument an async operation. */
export function instrument<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  spanName: string,
  options?: InstrumentOptions,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const span = createSpan(spanName, args, options);
    const startTime = performance.now();

    try {
      const result = await fn(...args);
      recordDuration(span, startTime);
      endSpan(span);
      return result;
    } catch (error) {
      endSpan(span, error);
      throw error;
    }
  };
}

/** Instrument a synchronous operation. */
export function instrumentSync<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
  spanName: string,
  options?: InstrumentOptions,
): (...args: TArgs) => TResult {
  return (...args: TArgs): TResult => {
    const span = createSpan(spanName, args, options);
    const startTime = performance.now();

    try {
      const result = fn(...args);
      recordDuration(span, startTime);
      endSpan(span);
      return result;
    } catch (error) {
      endSpan(span, error);
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
    throw new RangeError("instrumentBatch batchSize must be a positive integer");
  }
  const totalBatches = Math.ceil(items.length / batchSize);

  const batchSpan = startSpan(operationName, {
    kind: "internal",
    attributes: {
      "batch.total_items": items.length,
      "batch.size": batchSize,
      "batch.total_batches": totalBatches,
      ...(options?.attributes ?? {}),
    },
  });

  try {
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, items.length);
      const batch = items.slice(start, end);

      const batchItemSpan = startSpan(`${operationName}.batch`, {
        kind: "internal",
        attributes: {
          "batch.index": batchIndex,
          "batch.items": batch.length,
        },
      });

      try {
        await Promise.all(batch.map((item, index) => processor(item, start + index)));
        endSpan(batchItemSpan);
      } catch (error) {
        endSpan(batchItemSpan, error);
        throw error;
      }
    }

    endSpan(batchSpan);
  } catch (error) {
    endSpan(batchSpan, error);
    throw error;
  }
}

function createSpan(spanName: string, args: unknown[], options?: InstrumentOptions): Span | null {
  let attributes: SpanOptions["attributes"] = {};
  try {
    attributes = options?.attributes?.(args) ?? {};
  } catch (_) {
    /* expected: instrumentation metadata must not block the wrapped operation */
  }

  const spanOptions: SpanOptions = {
    kind: options?.kind ?? "internal",
    attributes,
  };

  return startSpan(spanName, spanOptions);
}

function recordDuration(span: Span | null, startTime: number): void {
  setSpanAttributes(span, { duration_ms: Math.floor(performance.now() - startTime) });
}
