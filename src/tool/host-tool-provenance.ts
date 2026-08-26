const trustedHostTools = new WeakSet<object>();

/** @internal Mark a host tool definition or materialized tool as framework-owned. */
export function markTrustedHostToolProvenance<T extends object>(tool: T): T {
  trustedHostTools.add(tool);
  return tool;
}

/** @internal Mark every tool in a host-owned tool set as framework-owned. */
export function markTrustedHostToolSet<T extends Record<string, object>>(tools: T): T {
  for (const tool of Object.values(tools)) {
    markTrustedHostToolProvenance(tool);
  }
  return tools;
}

/** @internal Return whether a tool carries unforgeable framework provenance. */
export function hasTrustedHostToolProvenance(tool: unknown): boolean {
  return typeof tool === "object" && tool !== null && trustedHostTools.has(tool);
}

/** @internal Copy trusted framework provenance across a host-owned wrapper. */
export function inheritTrustedHostToolProvenance<T extends object>(source: unknown, target: T): T {
  return hasTrustedHostToolProvenance(source) ? markTrustedHostToolProvenance(target) : target;
}
