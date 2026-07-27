const REMOTE_TOOL_PROVENANCE = Symbol("veryfront.remote-tool-provenance");

type RemoteToolProvenance = {
  [REMOTE_TOOL_PROVENANCE]?: string;
};

/** Mark a runtime tool as materialized from a trusted remote tool source. */
export function markRemoteToolProvenance<T extends object>(
  tool: T,
  canonicalToolName: string,
): T {
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

  const canonicalToolName = (value as RemoteToolProvenance)[REMOTE_TOOL_PROVENANCE];
  return typeof canonicalToolName === "string" && canonicalToolName.length > 0
    ? canonicalToolName
    : undefined;
}
