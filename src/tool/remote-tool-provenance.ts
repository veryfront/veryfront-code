const REMOTE_TOOL_PROVENANCE = Symbol("veryfront.remote-tool-provenance");
const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

/** Mark a runtime tool as materialized from a trusted remote tool source. */
export function markRemoteToolProvenance<T extends object>(
  tool: T,
  canonicalToolName: string,
): T {
  objectDefineProperty(tool, REMOTE_TOOL_PROVENANCE, {
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

  const canonicalToolName = objectGetOwnPropertyDescriptor(value, REMOTE_TOOL_PROVENANCE)?.value;
  return typeof canonicalToolName === "string" && canonicalToolName.length > 0
    ? canonicalToolName
    : undefined;
}
