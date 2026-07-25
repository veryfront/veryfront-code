export const MAX_EMBEDDING_DIMENSION = 65_536;

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
