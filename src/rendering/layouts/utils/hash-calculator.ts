import { computeHash } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";

export async function computeDepsHash(
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  adapter: RuntimeAdapter,
): Promise<string> {
  const hashPromises: Promise<string>[] = [];

  const layoutCode = layoutBundle?.compiledCode ?? "";
  if (layoutBundle) {
    hashPromises.push(computeHash(String(layoutCode)));
  }

  for (const item of nestedLayouts) {
    if (!item) continue;

    const componentPath = item.componentPath;
    if (componentPath) {
      hashPromises.push(adapter.fs.readFile(componentPath).then(computeHash));
      continue;
    }

    const compiledCode = item.bundle?.compiledCode;
    if (compiledCode) {
      hashPromises.push(computeHash(String(compiledCode)));
    }
  }

  const depParts = await Promise.all(hashPromises);
  return depParts.join(":");
}
