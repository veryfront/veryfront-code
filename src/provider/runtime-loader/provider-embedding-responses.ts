import { readRecord } from "./provider-records.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

/** Check whether a value is an array of numbers. */
export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number");
}

export function extractOpenAIEmbeddings(payload: unknown): number[][] {
  const record = readRecord(payload);
  const data = record?.data;
  if (!Array.isArray(data)) {
    throw INVALID_ARGUMENT.create({
      detail: "Invalid OpenAI embedding response: data array missing",
    });
  }

  const embeddings: number[][] = [];

  for (const item of data) {
    const itemRecord = readRecord(item);
    const embedding = itemRecord?.embedding;
    if (!isNumberArray(embedding)) {
      throw INVALID_ARGUMENT.create({
        detail: "Invalid OpenAI embedding response: embedding vector missing",
      });
    }
    embeddings.push(embedding);
  }

  return embeddings;
}

export function extractOpenAIUsageTokens(payload: unknown): number | undefined {
  const record = readRecord(payload);
  const usage = readRecord(record?.usage);
  const totalTokens = usage?.total_tokens;
  return typeof totalTokens === "number" ? totalTokens : undefined;
}

export function extractGoogleEmbedding(payload: unknown): number[] {
  const record = readRecord(payload);
  const embeddings = record?.embeddings;

  if (Array.isArray(embeddings) && embeddings.length > 0) {
    const firstEmbedding = readRecord(embeddings[0]);
    const values = firstEmbedding?.values;
    if (isNumberArray(values)) {
      return values;
    }
  }

  const embedding = readRecord(record?.embedding);
  const values = embedding?.values;
  if (isNumberArray(values)) {
    return values;
  }

  throw INVALID_ARGUMENT.create({
    detail: "Invalid Google embedding response: embedding vector missing",
  });
}

export function extractGoogleUsageTokens(payload: unknown): number | undefined {
  const record = readRecord(payload);
  const usageMetadata = readRecord(record?.usageMetadata);
  const promptTokenCount = usageMetadata?.promptTokenCount;
  return typeof promptTokenCount === "number" ? promptTokenCount : undefined;
}
