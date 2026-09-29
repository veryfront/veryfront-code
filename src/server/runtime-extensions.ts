import { createBuiltinExtensions } from "#veryfront/extensions/builtin-extensions.ts";
import { createDeferredResolvedExtension } from "#veryfront/extensions/deferred-extension.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import type { ExtensionFactory, ResolvedExtension } from "#veryfront/extensions/types.ts";
import { getHostEnv } from "#veryfront/platform/compat/process/env.ts";

/** Select process-owned extensions before server bootstrap orchestration. */
export function createServerBuiltinExtensions(): ResolvedExtension[] {
  const extensions = createBuiltinExtensions();
  // Hosted workflows borrow the process-owned Redis runtime. Project config
  // cannot activate extensions on this shared server; local projects opt in.
  if (getHostEnv("PROXY_MODE") === "1" && getHostEnv("REDIS_URL")) {
    extensions.push(createDeferredResolvedExtension({
      name: "ext-redis",
      source: "builtin",
      origin: "hosted server Redis runtime",
      load: async () => {
        const module = await importFirstPartyExtensionModule<{ default: ExtensionFactory }>(
          "ext-redis",
          "@veryfront/ext-redis",
        );
        return module.default();
      },
    }));
  }
  return extensions;
}
