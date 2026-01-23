import { computeHash, rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";

export async function computeDepsHash(
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  adapter: RuntimeAdapter,
): Promise<string> {
  try {
    // Parallelize all hash computations for better performance
    const hashPromises: Promise<string>[] = [];

    // Hash the main layout bundle
    if (layoutBundle) {
      const code = String(layoutBundle.compiledCode || "");
      hashPromises.push(computeHash(code));
    }

    // Hash all nested layouts in parallel
    for (const item of nestedLayouts) {
      if (!item) continue;
      if (item.componentPath) {
        hashPromises.push(
          adapter.fs.readFile(item.componentPath)
            .then((src) => computeHash(src))
            .catch((e) => {
              logger.debug("[layout] reading tsx layout for dep hash failed", e as Error);
              return "";
            }),
        );
      } else if (item.bundle?.compiledCode) {
        hashPromises.push(computeHash(String(item.bundle.compiledCode)));
      }
    }

    const depParts = await Promise.all(hashPromises);
    return depParts.filter(Boolean).join(":");
  } catch (e) {
    logger.debug("[layout] dep hash computation failed", e as Error);
    return "";
  }
}
