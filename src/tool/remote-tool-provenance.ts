const REMOTE_TOOL_PROVENANCE = Symbol("veryfront.remote-tool-provenance");

/** Mark a runtime tool as materialized from a trusted remote tool source. */
export function markRemoteToolProvenance<T extends object>(
  tool: T,
  canonicalToolName: string,
): T {
  if (typeof canonicalToolName !== "string" || canonicalToolName.length === 0) {
    throw new TypeError("Canonical remote tool name must be a non-empty string");
  }
  Object.defineProperty(tool, REMOTE_TOOL_PROVENANCE, {
    value: canonicalToolName,
    enumerable: true,
  });
  return tool;
}

/** Return the canonical remote tool name carried by trusted provenance. */
export function getRemoteToolProvenance(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, REMOTE_TOOL_PROVENANCE);
  } catch {
    return undefined;
  }
  if (!descriptor || !("value" in descriptor)) return undefined;
  const canonicalToolName = descriptor.value;
  return typeof canonicalToolName === "string" && canonicalToolName.length > 0
    ? canonicalToolName
    : undefined;
}
