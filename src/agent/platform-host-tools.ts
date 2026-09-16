import type { HostToolSet } from "#veryfront/tool";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";

/** Keep platform host tools available beside colliding project tools. */
export function withPlatformHostToolAliases(
  platformTools: HostToolSet,
  localTools: HostToolSet = {},
): HostToolSet {
  const tools = { ...platformTools, ...localTools };
  for (const [name, definition] of Object.entries(platformTools)) {
    if (name.includes("__")) continue;
    if (!Object.hasOwn(localTools, name)) tools[name] = markTrustedHostToolProvenance(definition);
    const canonicalName = `veryfront__${name}`;
    tools[canonicalName] = markTrustedHostToolProvenance({ ...definition, id: canonicalName });
  }
  return tools;
}
