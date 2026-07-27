/** Bound identity work and per-project accounting keys at public JS boundaries. */
export const MAX_DATA_PROJECT_ID_LENGTH = 1024;

/**
 * Validate one trusted project identity without coercion.
 *
 * JavaScript callers can bypass TypeScript declarations. Coercing numbers,
 * objects, or symbols would let admission and hashed circuit identities apply
 * different equivalence rules, so every data entry point uses this exact
 * string value.
 */
export function requireDataProjectId(
  value: unknown,
  label = "Data projectId",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_DATA_PROJECT_ID_LENGTH
  ) {
    throw new TypeError(
      `${label} must be a non-empty string no longer than ${MAX_DATA_PROJECT_ID_LENGTH} characters`,
    );
  }
  return value;
}
