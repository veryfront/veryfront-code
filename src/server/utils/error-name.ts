const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9.]{0,127}$/;

/** Return a bounded error class name without reading messages or stacks. */
export function getSafeErrorName(error: unknown): string {
  try {
    if (error instanceof Error) {
      const name: unknown = error.name;
      if (typeof name === "string" && SAFE_ERROR_NAME.test(name)) return name;
    }
  } catch {
    // Hostile errors use the generic name below.
  }
  return "Error";
}
