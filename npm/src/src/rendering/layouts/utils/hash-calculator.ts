import { computeHash, rendererLogger as logger } from "../../../utils/index.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { LayoutItem, MdxBundle } from "../../../types/index.js";

export async function computeDepsHash(
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  adapter: RuntimeAdapter,
): Promise<string> {
  try {
    const hashPromises: Promise<string>[] = [];

    if (layoutBundle) {
      hashPromises.push(computeHash(String(layoutBundle.compiledCode ?? "")));
    }

    for (const item of nestedLayouts) {
      if (!item) continue;

      if (item.componentPath) {
        hashPromises.push(
          adapter.fs
            .readFile(item.componentPath)
            .then((src) => computeHash(src))
            .catch((e) => {
              logger.debug("[layout] reading tsx layout for dep hash failed", e as Error);
              return "";
            }),
        );
        continue;
      }

      const compiledCode = item.bundle?.compiledCode;
      if (compiledCode) {
        hashPromises.push(computeHash(String(compiledCode)));
      }
    }

    const depParts = await Promise.all(hashPromises);
    return depParts.filter(Boolean).join(":");
  } catch (e) {
    logger.debug("[layout] dep hash computation failed", e as Error);
    return "";
  }
}
