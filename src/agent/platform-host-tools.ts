import type { HostToolSet } from "#veryfront/tool";
import {
  hasTrustedHostToolProvenance,
  markTrustedHostToolProvenance,
} from "#veryfront/tool/host-tool-provenance.ts";
import { forEachPrivateArray } from "#veryfront/security/private-array.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import { normalizeConversationPlatformToolName } from "./platform-tool-names.ts";

const entries = Object.entries;
const hasOwn = Object.hasOwn;
const includes = String.prototype.includes;
const apply = Reflect.apply;

/** Keep platform host tools available beside colliding project tools. */
export function withPlatformHostToolAliases(
  platformTools: HostToolSet,
  localTools: HostToolSet = {},
): HostToolSet {
  const tools = { ...platformTools, ...localTools };
  const set = (name: string, definition: HostToolSet[string]) => {
    defineOwnDataProperty(tools, name, definition, {
      enumerable: true,
      configurable: true,
      writable: true,
    });
  };
  forEachPrivateArray(entries(platformTools), (entry) => {
    const name = entry[0];
    const definition = entry[1];
    const legacyName = normalizeConversationPlatformToolName(name);
    if (legacyName !== name) {
      if (hasTrustedHostToolProvenance(definition) && !hasOwn(localTools, legacyName)) {
        set(legacyName, markTrustedHostToolProvenance({ ...definition, id: legacyName }));
      }
      return;
    }
    if (apply(includes, name, ["__"])) return;
    if (!hasOwn(localTools, name)) set(name, markTrustedHostToolProvenance(definition));
    const canonicalName = `veryfront__${name}`;
    set(canonicalName, markTrustedHostToolProvenance({ ...definition, id: canonicalName }));
  });
  return tools;
}
