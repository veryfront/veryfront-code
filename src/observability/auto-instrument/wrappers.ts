import type { Span } from "@opentelemetry/api";
import { endSpan, setSpanAttributes, type SpanOptions, startSpan } from "../tracing/index.ts";
import type { BatchOptions, InstrumentOptions } from "./types.ts";

export function instrument<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  spanName: string,
  options?: InstrumentOptions,
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const span = createSpan(spanName, args, options);
    const startTime = performance.now();

    try {
      const result = await fn(...args);
      recordDuration(span, startTime);
      endSpan(span);
      return result as ReturnType<T>;
    } catch (error) {
      endSpan(span, error as Error);
      throw error;
    }
  }) as T;
}

export function instrumentSync<T extends (...args: unknown[]) => unknown>(
  fn: T,
  spanName: string,
  options?: InstrumentOptions,
): T {
  return ((...args: Parameters<T>): ReturnType<T> => {
    const span = createSpan(spanName, args, options);
    const startTime = performance.now();

    try {
      const result = fn(...args);
      recordDuration(span, startTime);
      endSpan(span);
      return result as ReturnType<T>;
    } catch (error) {
      endSpan(span, error as Error);
      throw error;
    }
  }) as T;
}

export async function instrumentBatch<T>(
  operationName: string,
  items: T[],
  processor: (item: T, index: number) => Promise<void>,
  options?: BatchOptions,
): Promise<void> {
  const batchSize = options?.batchSize ?? 10;
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
    await processBatches(items, batchSize, totalBatches, processor, operationName);
    endSpan(batchSpan);
  } catch (error) {
    endSpan(batchSpan, error as Error);
    throw error;
  }
}

function createSpan(spanName: string, args: unknown[], options?: InstrumentOptions): Span | null {
  const spanOptions: SpanOptions = {
    kind: options?.kind ?? "internal",
    attributes: options?.attributes?.(args) ?? {},
  };

  return startSpan(spanName, spanOptions);
}

function recordDuration(span: Span | null, startTime: number): void {
  const duration = performance.now() - startTime;
  setSpanAttributes(span, { duration_ms: Math.floor(duration) });
}

async function processBatches<T>(
  items: T[],
  batchSize: number,
  totalBatches: number,
  processor: (item: T, index: number) => Promise<void>,
  operationName: string,
): Promise<void> {
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    await processSingleBatch(items, batchSize, batchIndex, processor, operationName);
  }
}

async function processSingleBatch<T>(
  items: T[],
  batchSize: number,
  batchIndex: number,
  processor: (item: T, index: number) => Promise<void>,
  operationName: string,
): Promise<void> {
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
    endSpan(batchItemSpan, error as Error);
    throw error;
  }
}
