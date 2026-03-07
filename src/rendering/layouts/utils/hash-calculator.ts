import { computeHash, rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";

const logger = rendererLogger.component("layout");

export async function computeDepsHash(
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  adapter: RuntimeAdapter,
): Promise<string> {
  try {
    const hashPromises: Promise<string>[] = [];

    const layoutCode = layoutBundle?.compiledCode ?? "";
    if (layoutBundle) {
      hashPromises.push(computeHash(String(layoutCode)));
    }

    for (const item of nestedLayouts) {
      if (!item) continue;

      const componentPath = item.componentPath;
      if (componentPath) {
        hashPromises.push(
          (async () => {
            try {
              const src = await adapter.fs.readFile(componentPath);
              return await computeHash(src);
            } catch (e) {
              logger.debug("reading tsx layout for dep hash failed", e as Error);
              return "";
            }
          })(),
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
    logger.debug("dep hash computation failed", e as Error);
    return "";
  }
}
