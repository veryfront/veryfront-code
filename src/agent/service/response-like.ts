/** Check whether a value behaves like a Response. */
export function isResponseLike(value: unknown): value is Response {
  if (value instanceof Response) {
    return true;
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("status" in value) || typeof value.status !== "number") {
    return false;
  }

  if (!("headers" in value) || typeof value.headers !== "object" || value.headers === null) {
    return false;
  }

  if ("bodyUsed" in value && typeof value.bodyUsed === "boolean") {
    return true;
  }

  return (
    "text" in value &&
    typeof value.text === "function" &&
    "json" in value &&
    typeof value.json === "function"
  );
}
