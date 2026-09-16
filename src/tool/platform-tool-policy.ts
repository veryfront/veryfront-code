import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import {
  isIntegrationToolAllowedBySourcePolicy,
  parseIntegrationToolIdentity,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import { hasTrustedHostToolProvenance } from "./host-tool-provenance.ts";
import { hasTrustedPlatformSource } from "./platform-source-provenance.ts";
import type { RemoteToolSource, ToolExecutionContext } from "./types.ts";

const hasOwn = Object.hasOwn;

/** Platform names bypass connector restrictions only with host-owned provenance. */
export function isToolAllowedBySourcePolicy(
  name: string,
  policy: SourceIntegrationPolicyManifest,
  provenance?: object,
): boolean {
  return isIntegrationToolAllowedBySourcePolicy(name, policy) ||
    (parseIntegrationToolIdentity(name)?.integration === "veryfront" &&
      provenance !== undefined &&
      (hasTrustedHostToolProvenance(provenance) || hasTrustedPlatformSource(provenance)));
}

/** Apply source restrictions using the first remote source that owns each tool. */
export async function filterRemoteToolsBySourcePolicy(
  names: string[],
  sources: readonly RemoteToolSource[],
  policy: SourceIntegrationPolicyManifest,
  context?: ToolExecutionContext,
): Promise<string[]> {
  const allowed: string[] = [];
  const catalogs = createPrivateMap<
    RemoteToolSource,
    ReturnType<typeof createPrivateSet<string>>
  >();
  for (let nameIndex = 0; nameIndex < names.length; nameIndex++) {
    if (!hasOwn(names, nameIndex)) continue;
    const name = names[nameIndex]!;
    if (isIntegrationToolAllowedBySourcePolicy(name, policy)) {
      allowed[allowed.length] = name;
      continue;
    }
    for (let index = 0; index < sources.length; index++) {
      if (!hasOwn(sources, index)) continue;
      const source = sources[index]!;
      let catalog = catalogs.get(source);
      if (!catalog) {
        catalog = createPrivateSet<string>();
        const definitions = await source.listTools(context);
        for (let index = 0; index < definitions.length; index++) {
          if (hasOwn(definitions, index)) catalog.add(definitions[index]!.name);
        }
        catalogs.set(source, catalog);
      }
      if (!catalog.has(name)) continue;
      if (isToolAllowedBySourcePolicy(name, policy, source)) allowed[allowed.length] = name;
      break;
    }
  }
  return allowed;
}
