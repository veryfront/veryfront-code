/** Check whether a value is an array of numbers. */
export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}
