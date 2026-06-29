function createEvalRunIdSuffix(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Create a timestamp-sortable eval run id with a collision-resistant suffix. */
export function createEvalRunId(
  now = new Date(),
  createSuffix: () => string = createEvalRunIdSuffix,
): string {
  const timestamp = now.toISOString().replace(/[-:.]/g, "").replace("T", "_").replace("Z", "");
  return `evalrun_${timestamp}_${createSuffix()}`;
}
