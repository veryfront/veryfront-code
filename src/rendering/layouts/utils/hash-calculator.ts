import { computeHash, rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";

export async function computeDepsHash(
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  adapter: RuntimeAdapter,
): Promise<string> {
  let depsHash = "";
  try {
    const depParts: string[] = [];

    if (layoutBundle) {
      const code = String(layoutBundle.compiledCode || "");
      depParts.push(await computeHash(code));
    }

    for (const item of nestedLayouts) {
      if (!item) continue;
      if (item.componentPath) {
        try {
          const src = await adapter.fs.readFile(item.componentPath);
          depParts.push(await computeHash(src));
        } catch (e) {
          logger.debug("[layout] reading tsx layout for dep hash failed", e as Error);
        }
      } else if (item.bundle?.compiledCode) {
        depParts.push(await computeHash(String(item.bundle.compiledCode)));
      }
    }

    depsHash = depParts.join(":");
  } catch (e) {
    logger.debug("[layout] dep hash computation failed", e as Error);
  }

  return depsHash;
}
