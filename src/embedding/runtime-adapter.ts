import type { EmbeddingRuntime } from "#veryfront/provider/types.ts";
import { awaitAbortable, throwIfAborted } from "#veryfront/utils/abort.ts";

export interface EmbedRuntimeOptions {
  model: EmbeddingRuntime;
  value: string;
  abortSignal?: AbortSignal;
}

export interface EmbedManyRuntimeOptions {
  model: EmbeddingRuntime;
  values: string[];
  abortSignal?: AbortSignal;
}

function assertEmbeddingCount(expected: number, embeddings: number[][]): void {
  if (embeddings.length === expected) return;

  const label = expected === 1 ? "embedding" : "embeddings";
  throw new Error(
    `Embedding runtime expected ${expected} ${label} but received ${embeddings.length}`,
  );
}

/** Invoke an embedding runtime for one value with cancellation and count checks. */
export async function embed(options: EmbedRuntimeOptions) {
  throwIfAborted(options.abortSignal);
  const result = await awaitAbortable(
    options.model.doEmbed({
      values: [options.value],
      abortSignal: options.abortSignal,
    }),
    options.abortSignal,
  );
  assertEmbeddingCount(1, result.embeddings);
  return {
    embedding: result.embeddings[0]!,
    embeddings: result.embeddings,
    usage: result.usage,
    rawResponse: result.rawResponse,
    warnings: result.warnings ?? [],
  };
}

/** Invoke an embedding runtime for many values with cancellation and count checks. */
export async function embedMany(options: EmbedManyRuntimeOptions) {
  throwIfAborted(options.abortSignal);
  const result = await awaitAbortable(
    options.model.doEmbed({
      values: options.values,
      abortSignal: options.abortSignal,
    }),
    options.abortSignal,
  );
  assertEmbeddingCount(options.values.length, result.embeddings);
  return {
    embeddings: result.embeddings,
    usage: result.usage,
    rawResponse: result.rawResponse,
    warnings: result.warnings ?? [],
  };
}
