export const MAX_EMBEDDING_DIMENSION = 65_536;
/** Maximum UTF-8 payload accepted for one persisted RAG document. */
export const MAX_RAG_DOCUMENT_TEXT_BYTES = 5 * 1024 * 1024;
/** Maximum length accepted for user-controlled RAG document metadata strings. */
export const MAX_RAG_DOCUMENT_METADATA_LENGTH = 4_096;
/** Maximum length accepted for compact RAG document metadata strings. */
export const MAX_RAG_DOCUMENT_COMPACT_METADATA_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateOptionalString(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty: boolean,
): void {
  if (value === undefined) return;
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum
  ) {
    const emptyRequirement = allowEmpty ? "" : " non-empty";
    throw new TypeError(
      `${label} must be a${emptyRequirement} string no longer than ${maximum} characters`,
    );
  }
}

/**
 * Validate caller-supplied metadata before it reaches either RAG persistence
 * backend. TypeScript types are not a runtime trust boundary.
 */
export function validateRagDocumentMetadata(
  value: unknown,
  label: string,
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  validateOptionalString(
    value.title,
    `${label}.title`,
    MAX_RAG_DOCUMENT_METADATA_LENGTH,
    false,
  );
  validateOptionalString(
    value.source,
    `${label}.source`,
    MAX_RAG_DOCUMENT_METADATA_LENGTH,
    true,
  );
  validateOptionalString(
    value.type,
    `${label}.type`,
    MAX_RAG_DOCUMENT_COMPACT_METADATA_LENGTH,
    true,
  );
  validateOptionalString(
    value.mediaType,
    `${label}.mediaType`,
    MAX_RAG_DOCUMENT_COMPACT_METADATA_LENGTH,
    false,
  );
  if (
    value.size !== undefined &&
    (!Number.isSafeInteger(value.size) || Number(value.size) < 0)
  ) {
    throw new RangeError(`${label}.size must be a non-negative safe integer`);
  }
}

/** Validate a provenance precondition before applying a RAG deletion. */
export function validateRagRemoveOptions(
  value: unknown,
  label: string,
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  validateOptionalString(
    value.requiredSourcePrefix,
    `${label}.requiredSourcePrefix`,
    MAX_RAG_DOCUMENT_METADATA_LENGTH,
    false,
  );
}

export function requirePositiveSafeInteger(
  value: number,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(
      `${label} must be a positive safe integer no greater than ${maximum}`,
    );
  }
  return value;
}

export function requireUnitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite number between 0 and 1`);
  }
  return value;
}

export function validateEmbeddingVector(
  value: unknown,
  label: string,
  expectedDimension?: number,
): number[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  if (value.length === 0 || value.length > MAX_EMBEDDING_DIMENSION) {
    throw new RangeError(
      `${label} dimension must be between 1 and ${MAX_EMBEDDING_DIMENSION}`,
    );
  }
  if (expectedDimension !== undefined && value.length !== expectedDimension) {
    throw new RangeError(
      `${label} dimension ${value.length} does not match expected dimension ${expectedDimension}`,
    );
  }
  for (let index = 0; index < value.length; index++) {
    if (!Number.isFinite(value[index])) {
      throw new TypeError(`${label}[${index}] must be a finite number`);
    }
  }
  return value as number[];
}

export function validateEmbeddingBatch(
  value: unknown,
  expectedCount: number,
  label: string,
  expectedDimension?: number,
): { vectors: number[][]; dimension: number | undefined } {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  if (value.length !== expectedCount) {
    throw new RangeError(
      `${label} returned ${value.length} vectors for ${expectedCount} inputs`,
    );
  }

  let dimension = expectedDimension;
  const vectors: number[][] = [];
  for (let index = 0; index < value.length; index++) {
    const vector = validateEmbeddingVector(
      value[index],
      `${label}[${index}]`,
      dimension,
    );
    dimension ??= vector.length;
    vectors.push(vector);
  }
  return { vectors, dimension };
}
