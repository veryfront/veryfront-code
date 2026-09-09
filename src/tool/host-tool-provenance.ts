import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

const trustedHostTools = createPrivateWeakStore<object, true>();
const objectValues = Object.values;

/** @internal Mark a host tool definition or materialized tool as framework-owned. */
export function markTrustedHostToolProvenance<T extends object>(tool: T): T {
  trustedHostTools.set(tool, true);
  return tool;
}

/** @internal Mark every tool in a host-owned tool set as framework-owned. */
export function markTrustedHostToolSet<T extends Record<string, object>>(tools: T): T {
  const values = objectValues(tools);
  for (let index = 0; index < values.length; index++) {
    const tool = values[index];
    if (tool !== undefined) markTrustedHostToolProvenance(tool);
  }
  return tools;
}

/** @internal Return whether a tool carries unforgeable framework provenance. */
export function hasTrustedHostToolProvenance(tool: unknown): boolean {
  return typeof tool === "object" && tool !== null && trustedHostTools.get(tool) === true;
}

/** @internal Copy trusted framework provenance across a host-owned wrapper. */
export function inheritTrustedHostToolProvenance<T extends object>(source: unknown, target: T): T {
  return hasTrustedHostToolProvenance(source) ? markTrustedHostToolProvenance(target) : target;
}
